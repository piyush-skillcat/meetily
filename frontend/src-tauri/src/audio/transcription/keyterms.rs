// audio/transcription/keyterms.rs
//
// Vocabulary ("keyterms") that streaming speech-to-text is told to listen for:
// names, companies and jargon that generic models misspell. Three sources,
// merged in priority order:
//   1. meeting — "People & topic" typed on the recording screen
//   2. notes   — terms harvested from the live notes pad
//   3. glossary — the persistent list in Settings → Transcription
// Every change bumps a version so providers can reconnect with the new list.

use log::info;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

/// Deepgram accepts up to 100 keyterms per stream.
pub const MAX_KEYTERMS: usize = 100;
/// Harvested note terms are capped so they never crowd out people and glossary.
const MAX_NOTE_TERMS: usize = 40;
const MAX_TERM_CHARS: usize = 50;
/// Keeps the listen URL comfortably short.
const MAX_TOTAL_CHARS: usize = 2_000;

const STORE_FILE: &str = "transcription_terms.json";
const GLOSSARY_KEY: &str = "glossary";

#[derive(Default)]
struct Registry {
    meeting: Vec<String>,
    notes: Vec<String>,
    glossary: Vec<String>,
    merged: Vec<String>,
    version: u64,
}

static REGISTRY: Mutex<Option<Registry>> = Mutex::new(None);

fn update(apply: impl FnOnce(&mut Registry)) {
    let mut guard = REGISTRY.lock().unwrap_or_else(|e| e.into_inner());
    let registry = guard.get_or_insert_with(Registry::default);
    apply(registry);
    let merged = merge(&[&registry.meeting, &registry.notes, &registry.glossary]);
    if merged != registry.merged {
        registry.merged = merged;
        registry.version += 1;
        info!("📚 Transcription keyterms updated (v{}): {} terms", registry.version, registry.merged.len());
    }
}

/// Current merged keyterms and their version.
pub fn current() -> (u64, Vec<String>) {
    let guard = REGISTRY.lock().unwrap_or_else(|e| e.into_inner());
    guard.as_ref().map_or((0, Vec::new()), |r| (r.version, r.merged.clone()))
}

pub fn set_meeting_terms(text: &str) {
    let terms = parse_list(text);
    update(|r| r.meeting = terms);
}

pub fn set_notes_terms(notes_markdown: &str) {
    let terms = harvest_from_notes(notes_markdown);
    update(|r| r.notes = terms);
}

pub fn set_glossary(text: &str) {
    let terms = parse_list(text);
    update(|r| r.glossary = terms);
}

/// Load the saved glossary into the registry (called when a recording starts).
pub fn load_glossary<R: Runtime>(app: &AppHandle<R>) {
    set_glossary(&read_glossary(app));
}

fn read_glossary<R: Runtime>(app: &AppHandle<R>) -> String {
    app.store(STORE_FILE)
        .ok()
        .and_then(|store| store.get(GLOSSARY_KEY))
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

/// Merge sources in priority order: case-insensitive dedup, per-term and
/// total length caps, at most MAX_KEYTERMS.
fn merge(sources: &[&Vec<String>]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    let mut total = 0;
    for term in sources.iter().flat_map(|s| s.iter()) {
        if out.len() >= MAX_KEYTERMS {
            break;
        }
        let term = term.trim();
        if term.is_empty() || term.chars().count() > MAX_TERM_CHARS {
            continue;
        }
        if total + term.len() > MAX_TOTAL_CHARS {
            break;
        }
        if seen.insert(term.to_lowercase()) {
            total += term.len();
            out.push(term.to_string());
        }
    }
    out
}

/// Split a comma-, semicolon- or newline-separated list.
pub fn parse_list(text: &str) -> Vec<String> {
    text.split(|c| c == ',' || c == ';' || c == '\n')
        .map(|t| t.trim().trim_matches(|c: char| c == '-' || c == '*' || c == '•').trim())
        .filter(|t| !t.is_empty())
        .map(str::to_string)
        .collect()
}

/// Words that are capitalised for grammar, not because they are names.
const STOPWORDS: &[&str] = &[
    "i", "i'm", "i've", "i'll", "i'd", "ok", "okay", "todo", "fyi", "asap", "eod", "am", "pm",
    "the", "a", "an", "and", "or", "but", "we", "you", "they", "he", "she", "it", "this", "that",
    "next", "action", "items", "notes", "q", "re", "eta", "tbd", "n/a",
];

/// Term occurrences: lowercase key → (count, first position, original spelling).
#[derive(Default)]
struct Harvest {
    counts: HashMap<String, (usize, usize, String)>,
    next_position: usize,
}

impl Harvest {
    fn record(&mut self, words: &[String]) {
        // "The Acme Board" → "Acme Board"
        let start = words.iter().position(|w| !STOPWORDS.contains(&w.to_lowercase().as_str()));
        let Some(start) = start else { return };
        let term = words[start..].join(" ");
        if term.chars().count() < 2 {
            return;
        }
        let position = self.next_position;
        self.next_position += 1;
        self.counts.entry(term.to_lowercase()).or_insert((0, position, term)).0 += 1;
    }
}

/// A run of capitalised words being collected, e.g. "Priya Sharma".
#[derive(Default)]
struct Run {
    words: Vec<String>,
    /// Began at a sentence start, where a capital may just be grammar.
    tentative: bool,
}

impl Run {
    fn flush(&mut self, harvest: &mut Harvest) {
        // A lone sentence-initial capital ("Ship the beta") is not evidence of a name;
        // one followed by another capital ("Priya Sharma wants…") is.
        if !self.words.is_empty() && !(self.tentative && self.words.len() == 1) {
            harvest.record(&self.words);
        }
        self.words.clear();
        self.tentative = false;
    }
}

/// Pull likely proper nouns and jargon out of free-form notes:
/// - runs of capitalised words ("Priya Sharma", "Acme Corp"); a sentence-initial
///   capital counts only when another capitalised word follows it
/// - acronyms and codes ("SOC2", "OKR", "Q4")
/// - inner capitals ("SkillCat", "iPhone")
/// Ordered by frequency, then first appearance.
pub fn harvest_from_notes(markdown: &str) -> Vec<String> {
    let mut harvest = Harvest::default();

    for line in markdown.lines() {
        // Markdown structure is noise for term detection.
        let line = line.trim_start_matches(|c: char| {
            matches!(c, '#' | '>' | '-' | '*' | '+' | ' ' | '.' | ')') || c.is_ascii_digit()
        });
        let line = line.replace(['[', ']', '(', ')', '`', '_', '*', '"'], " ");
        let mut sentence_start = true;
        let mut run = Run::default();

        for raw in line.split_whitespace() {
            let ends_sentence = raw.ends_with(['.', '!', '?', ':']);
            let breaks_run = ends_sentence || raw.ends_with([',', ';']);
            let word = raw.trim_matches(|c: char| !c.is_alphanumeric() && c != '\'' && c != '-' && c != '&');
            if word.is_empty() {
                run.flush(&mut harvest);
                sentence_start = sentence_start || ends_sentence;
                continue;
            }

            let is_acronym = word.len() >= 2
                && word.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '-')
                && word.chars().any(|c| c.is_ascii_uppercase());
            let has_inner_capital = word.chars().skip(1).any(|c| c.is_uppercase())
                && word.chars().any(|c| c.is_lowercase());
            let is_capitalised = word.chars().next().map_or(false, |c| c.is_uppercase());

            if is_acronym || has_inner_capital {
                run.flush(&mut harvest);
                harvest.record(&[word.to_string()]);
            } else if is_capitalised && run.words.len() < 3 {
                if run.words.is_empty() {
                    run.tentative = sentence_start;
                }
                run.words.push(word.to_string());
            } else {
                run.flush(&mut harvest);
            }

            if breaks_run {
                run.flush(&mut harvest);
            }
            sentence_start = ends_sentence;
        }
        run.flush(&mut harvest);
    }

    let mut terms: Vec<(usize, usize, String)> = harvest.counts.into_values().collect();
    terms.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    terms.into_iter().take(MAX_NOTE_TERMS).map(|(_, _, t)| t).collect()
}

// ============================================================================
// TAURI COMMANDS
// ============================================================================

#[tauri::command]
pub async fn api_get_transcription_glossary<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    Ok(read_glossary(&app))
}

#[tauri::command]
pub async fn api_save_transcription_glossary<R: Runtime>(app: AppHandle<R>, glossary: String) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| format!("Failed to open glossary store: {}", e))?;
    store.set(GLOSSARY_KEY, serde_json::Value::String(glossary.clone()));
    store.save().map_err(|e| format!("Failed to save glossary: {}", e))?;
    set_glossary(&glossary);
    Ok(())
}

/// Called by the recording screen as the "People & topic" field and the live
/// notes change (debounced). Empty strings clear that source.
#[tauri::command]
pub async fn api_set_meeting_keyterms(people_and_topic: String, notes_markdown: String) -> Result<(), String> {
    set_meeting_terms(&people_and_topic);
    set_notes_terms(&notes_markdown);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_list_splits_and_cleans() {
        assert_eq!(
            parse_list("Priya Sharma, Acme Corp;\n- SOC2\n\n  • Notesify "),
            vec!["Priya Sharma", "Acme Corp", "SOC2", "Notesify"]
        );
    }

    #[test]
    fn merge_dedups_in_priority_order_and_caps() {
        let meeting = vec!["Priya".to_string(), "Acme".to_string()];
        let notes = vec!["priya".to_string(), "OKR".to_string()];
        let glossary: Vec<String> = (0..200).map(|i| format!("term{}", i)).collect();
        let merged = merge(&[&meeting, &notes, &glossary]);
        assert_eq!(&merged[..3], &["Priya", "Acme", "OKR"]);
        assert_eq!(merged.len(), MAX_KEYTERMS);
    }

    #[test]
    fn merge_skips_overlong_terms() {
        let long = vec!["x".repeat(MAX_TERM_CHARS + 1), "ok".to_string()];
        assert_eq!(merge(&[&long]), vec!["ok"]);
    }

    #[test]
    fn harvest_finds_names_acronyms_and_brands() {
        let notes = "# Sync with Acme\n\
                     - Priya Sharma wants the SOC2 report by Q4\n\
                     - Ship SkillCat Notesify beta; ask Priya about pricing\n\
                     Next steps: I will email Rahul.";
        let terms = harvest_from_notes(notes);
        for expected in ["Priya", "Priya Sharma", "SOC2", "Q4", "SkillCat", "Notesify", "Acme", "Rahul"] {
            assert!(terms.iter().any(|t| t == expected), "missing {expected}: {terms:?}");
        }
        // Sentence-initial words and pronouns are not terms.
        for unexpected in ["Ship", "Next", "I", "Sync"] {
            assert!(!terms.iter().any(|t| t == unexpected), "unexpected {unexpected}: {terms:?}");
        }
    }

    #[test]
    fn harvest_ranks_repeated_terms_first() {
        let terms = harvest_from_notes("call with Zoltan. ask Zoltan. then Bora joins.");
        assert_eq!(terms.first().map(String::as_str), Some("Zoltan"));
    }

    #[test]
    fn harvest_of_empty_notes_is_empty() {
        assert!(harvest_from_notes("").is_empty());
        assert!(harvest_from_notes("just lowercase words here").is_empty());
    }
}
