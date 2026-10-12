//! Meeting detection (Linux): notice when another application starts capturing
//! the microphone (Zoom, Meet in a browser, Teams, Slack, Discord…) and prompt
//! the user to start recording — Granola's "a meeting just started" nudge,
//! without any calendar integration.
//!
//! Signal source: `pactl list source-outputs` (PipeWire/PulseAudio). Each entry
//! is an app-owned capture stream. Our own capture streams are filtered out.

#![cfg(target_os = "linux")]

use log::{debug, info, warn};
use serde::Serialize;
use std::collections::HashSet;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub const MEETING_DETECTED_EVENT: &str = "meeting-detected";
const POLL_INTERVAL: Duration = Duration::from_secs(4);
const PROMPT_COOLDOWN: Duration = Duration::from_secs(90);

#[derive(Debug, Clone, Serialize)]
pub struct MeetingDetectedEvent {
    pub app: String,
    pub media: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct CaptureStream {
    index: u32,
    app_name: String,
    media_name: Option<String>,
    binary: Option<String>,
}

fn parse_source_outputs(text: &str) -> Vec<CaptureStream> {
    let mut out = Vec::new();
    let mut cur: Option<CaptureStream> = None;
    for line in text.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("Source Output #") {
            if let Some(c) = cur.take() {
                out.push(c);
            }
            cur = rest.trim().parse::<u32>().ok().map(|index| CaptureStream {
                index,
                app_name: String::new(),
                media_name: None,
                binary: None,
            });
            continue;
        }
        let Some(c) = cur.as_mut() else { continue };
        let prop = |key: &str| -> Option<String> {
            t.strip_prefix(key)
                .map(|v| v.trim().trim_start_matches('=').trim().trim_matches('"').to_string())
                .filter(|v| !v.is_empty())
        };
        if let Some(v) = prop("application.name") {
            c.app_name = v;
        } else if let Some(v) = prop("media.name") {
            c.media_name = Some(v);
        } else if let Some(v) = prop("application.process.binary") {
            c.binary = Some(v);
        }
    }
    if let Some(c) = cur.take() {
        out.push(c);
    }
    out
}

fn is_own_stream(s: &CaptureStream) -> bool {
    let own_bin = std::env::current_exe()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
        .unwrap_or_else(|| "meetily".to_string());
    let bin = s.binary.as_deref().unwrap_or("");
    let name = s.app_name.to_lowercase();
    bin == own_bin
        || bin.contains("meetily")
        || name.contains("meetily")
        || name.contains(&own_bin.to_lowercase())
}

fn friendly_app_name(s: &CaptureStream) -> String {
    let name = if s.app_name.is_empty() {
        s.binary.clone().unwrap_or_else(|| "an app".to_string())
    } else {
        s.app_name.clone()
    };
    // Browsers: surface the site when PipeWire gives it in media.name
    let lower = name.to_lowercase();
    if lower.contains("chrom") || lower.contains("firefox") || lower.contains("brave") || lower.contains("edge") {
        if let Some(m) = &s.media_name {
            let ml = m.to_lowercase();
            if ml.contains("meet") {
                return "Google Meet".to_string();
            }
            if ml.contains("teams") {
                return "Microsoft Teams".to_string();
            }
            if ml.contains("zoom") {
                return "Zoom".to_string();
            }
        }
    }
    if lower.contains("zoom") {
        return "Zoom".to_string();
    }
    name
}

async fn list_capture_streams() -> Vec<CaptureStream> {
    let output = tokio::process::Command::new("pactl")
        .args(["list", "source-outputs"])
        .output()
        .await;
    match output {
        Ok(o) if o.status.success() => parse_source_outputs(&String::from_utf8_lossy(&o.stdout)),
        Ok(o) => {
            debug!("pactl failed: {}", String::from_utf8_lossy(&o.stderr));
            Vec::new()
        }
        Err(e) => {
            debug!("pactl not available: {}", e);
            Vec::new()
        }
    }
}

/// Spawn the background poller. Emits `meeting-detected` when a new foreign
/// microphone capture appears while Meetily is not recording.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Seed with whatever is already capturing so we only react to new streams.
        let mut seen: HashSet<u32> = list_capture_streams().await.into_iter().map(|s| s.index).collect();
        let mut last_prompt: Option<Instant> = None;
        info!("Meeting detector started ({} existing capture streams)", seen.len());

        loop {
            tokio::time::sleep(POLL_INTERVAL).await;

            let streams = list_capture_streams().await;
            let current: HashSet<u32> = streams.iter().map(|s| s.index).collect();
            let fresh: Vec<&CaptureStream> = streams
                .iter()
                .filter(|s| !seen.contains(&s.index) && !is_own_stream(s))
                .collect();
            seen = current;

            if fresh.is_empty() {
                continue;
            }
            if crate::audio::recording_commands::is_recording().await {
                continue;
            }
            if let Some(t) = last_prompt {
                if t.elapsed() < PROMPT_COOLDOWN {
                    continue;
                }
            }

            let s = fresh[0];
            let app_name = friendly_app_name(s);
            info!("Meeting detected: {} started capturing the microphone", app_name);
            last_prompt = Some(Instant::now());

            let payload = MeetingDetectedEvent { app: app_name.clone(), media: s.media_name.clone() };
            if let Err(e) = app.emit(MEETING_DETECTED_EVENT, &payload) {
                warn!("Failed to emit meeting-detected: {}", e);
            }

            // System notification so it's visible even when Meetily is in the background.
            use tauri_plugin_notification::NotificationExt;
            let _ = app
                .notification()
                .builder()
                .title(format!("{} is using your microphone", app_name))
                .body("Looks like a meeting started. Open Meetily to start taking notes.")
                .show();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pactl_output() {
        let text = r#"Source Output #12
	Driver: PipeWire
	Properties:
		application.name = "Chromium"
		media.name = "Chromium input"
		application.process.binary = "chrome"
Source Output #13
	Properties:
		application.name = "ALSA plug-in [meetily]"
		application.process.binary = "meetily"
"#;
        let s = parse_source_outputs(text);
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].index, 12);
        assert_eq!(s[0].app_name, "Chromium");
        assert_eq!(s[0].media_name.as_deref(), Some("Chromium input"));
        assert!(is_own_stream(&s[1]));
        assert!(!is_own_stream(&s[0]));
    }

    #[test]
    fn friendly_names() {
        let s = CaptureStream { index: 1, app_name: "Chromium".into(), media_name: Some("Google Meet".into()), binary: None };
        assert_eq!(friendly_app_name(&s), "Google Meet");
        let z = CaptureStream { index: 2, app_name: "ZOOM VoiceEngine".into(), media_name: None, binary: None };
        assert_eq!(friendly_app_name(&z), "Zoom");
    }
}
