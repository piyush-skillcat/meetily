/**
 * Local draft storage for notes typed during a recording, before the meeting
 * row exists in SQLite. Once the meeting is saved, the draft is moved into the
 * `meeting_notes` table and cleared here.
 */

const LIVE_DRAFT_KEY = 'meetily:notes-draft:live';

export interface NotesDraft {
  markdown: string;
  /** BlockNote document JSON (stringified) */
  json?: string;
  updatedAt: number;
}

function read(key: string): NotesDraft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NotesDraft;
    if (typeof parsed?.markdown !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function write(key: string, draft: NotesDraft | null) {
  try {
    if (!draft || (!draft.markdown.trim() && !draft.json)) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(draft));
    }
  } catch (e) {
    console.warn('Failed to persist notes draft', e);
  }
}

/** "People & topic" for the meeting being recorded; cleared with the draft once the meeting is saved. */
const LIVE_PEOPLE_KEY = 'meetily:people-draft:live';

function writePeople(text: string) {
  try {
    if (text.trim()) localStorage.setItem(LIVE_PEOPLE_KEY, text);
    else localStorage.removeItem(LIVE_PEOPLE_KEY);
  } catch {}
}

export const notesDraft = {
  readLive: () => read(LIVE_DRAFT_KEY),
  writeLive: (markdown: string, json?: string) =>
    write(LIVE_DRAFT_KEY, { markdown, json, updatedAt: Date.now() }),
  /** Clears the notes only (the "Clear notes" button). */
  clearLiveNotes: () => write(LIVE_DRAFT_KEY, null),
  /** Clears the whole live draft (notes and people) once the meeting is saved. */
  clearLive: () => {
    write(LIVE_DRAFT_KEY, null);
    writePeople('');
  },
  readPeople: (): string => {
    try {
      return localStorage.getItem(LIVE_PEOPLE_KEY) ?? '';
    } catch {
      return '';
    }
  },
  writePeople,
};
