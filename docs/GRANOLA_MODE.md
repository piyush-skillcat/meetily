# SkillCat Notesify — Granola-style workflow

The app is branded **SkillCat Notesify** and styled with the SkillCat design system: warm-sand light theme and near-black dark theme (follows the system, switchable in Settings → Appearance or from the sidebar), Fira Sans for text, IBM Plex Mono for timestamps, one orange accent. Tokens live in `frontend/src/styles/skillcat-tokens.css`; the Tailwind config remaps the old gray/blue utilities onto them so every screen follows the theme.

This branch turns Meetily into a notes-first meeting assistant modelled on Granola:
you jot rough notes during the call, and afterwards the AI rewrites them into a
complete document using the transcript, keeping your structure and filling in
what you missed.

## What changed

### Recording screen
- **My notes** pad (left) next to the live transcript (right). Anything you type
  is saved locally as you go and attached to the meeting when it is saved.
- Live transcript shows **You** (your mic) and **Them** (system audio) labels.

### Meeting page
- **Enhanced notes** tab: the AI-written document (editable, saved like before).
- **My notes** tab: your original notes, still editable after the meeting.
- **Ask** tab: chat about the meeting (transcript + notes + enhanced notes as
  context). Replies stream in. Suggested prompts: summarize, action items,
  follow-up email, open questions.
- **Enhance notes** button: streams the rewritten notes token by token. Runs
  automatically after a recording when *Auto summary* is on (now the default).
- **Template** picker with Granola-like defaults (Auto, 1:1, Customer call,
  Interview, Brainstorm, Lecture/Talk, plus the existing ones) and a
  **Manage templates…** editor: name, description, ordered sections, each with an
  instruction for the AI. Your choice is remembered as the default.
- The meeting title is generated from the enhanced notes.

### Transcription
- **Who said what**: mic and system audio are run through separate voice
  detection, so every segment is tagged `mic` (You) or `system` (Them). A
  crosstalk gate drops mic windows that are just speaker bleed (headphones
  still give the cleanest split).
- **Cloud speech-to-text** (Settings → Transcription): OpenAI
  (`gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, `whisper-1`) and Groq
  (`whisper-large-v3`, `whisper-large-v3-turbo`). Speech segments are uploaded as
  they are detected; four uploads run in parallel for low live latency. This is
  the most accurate option; Parakeet (local, English) and local Whisper remain.
- Local Whisper tuning: real thread count, temperature 0 with fallback, beam
  search on capable CPUs (hardware tier now measures RAM and finds Fedora's
  Vulkan library), and short valid replies are no longer dropped by the old
  length heuristic.
- Voice detection bridges pauses up to 700 ms so recognizers see whole phrases.

### Meeting detection (Linux)
When another app (Zoom, a browser on Meet/Teams, Slack, Discord…) opens the
microphone, Meetily shows a toast and a system notification: "Looks like a
meeting started. Start recording?" with a one-click Start. It watches PipeWire
capture streams (`pactl list source-outputs`) every few seconds and ignores
its own streams. No calendar access needed. Turn it off by setting
`localStorage["meetily:meeting-detection"] = "off"` (a settings switch is a
good follow-up).

### Linux system audio (PipeWire / PulseAudio)
cpal is ALSA-only, so Meetily now generates an ALSA PCM called
`meetily_system_monitor` that reads the default output's monitor, writes it to
`~/.config/Meetily/asound-system-monitor.conf`, and points `ALSA_CONFIG_PATH` at
it on startup. The default "system audio" device on Linux is that monitor. It is
refreshed each time devices are listed, so it follows your current output
(speakers, headphones, Bluetooth). Requires `alsa-plugins-pipewire` (or
`alsa-plugins-pulseaudio`).

### Fixes found by driving the real app
- Linux monitor PCMs were listed as `"<pcm> (System Audio)"` but opened by the
  bare name, so the system stream silently failed; both forms now match.
- A monitor PCM saved as the *microphone* preference is ignored (everything
  would otherwise be labelled "You").
- Loudness normalization no longer boosts room noise: make-up gain is capped at
  +18 dB and gated below -50 dBFS, and near-silent VAD segments are dropped.
  This stops Whisper's random-language hallucinations on silence.

## Backend reference
| Area | Files |
|---|---|
| Per-source VAD + speaker tag | `src-tauri/src/audio/pipeline.rs`, `audio/transcription/worker.rs` |
| Cloud STT | `audio/transcription/cloud_provider.rs`, `audio/transcription/engine.rs` |
| Streaming LLM | `summary/llm_client.rs` (`generate_stream`), `summary/provider_config.rs` |
| Enhance notes | `summary/enhance.rs` (`api_enhance_notes`, event `enhance-stream`) |
| Chat | `summary/chat.rs` (`api_send_meeting_chat`, event `chat-stream`) |
| Notes | `database/repositories/notes.rs`, `summary/notes_commands.rs` |
| Templates | `summary/template_commands.rs` (`api_get_template_full`, `api_save_template`, `api_delete_template`), `src-tauri/templates/*.json` |
| Linux monitor PCM | `audio/devices/platform/linux.rs` |

## Frontend reference
| Area | Files |
|---|---|
| Notes editor | `src/components/Notes/NotesPad.tsx`, `src/lib/notesDraft.ts`, `src/hooks/useMeetingNotes.ts` |
| Recording layout | `src/app/page.tsx`, `src/app/_components/LiveNotesPanel.tsx` |
| Meeting page | `src/app/meeting-details/page-content.tsx`, `src/components/MeetingDetails/SummaryPanel.tsx` |
| Enhance stream | `src/hooks/meeting-details/useEnhanceNotes.ts` |
| Ask | `src/components/MeetingDetails/AskPanel.tsx` |
| Templates | `src/components/Templates/TemplateManagerDialog.tsx`, `src/hooks/meeting-details/useTemplates.ts` |
| Speaker labels | `src/components/VirtualizedTranscriptView.tsx`, `src/types/index.ts` |

## Running on Fedora
```bash
cd frontend
./dev-gpu.sh          # builds llama-helper, then tauri dev
```
`frontend/src-tauri/.cargo/config.toml` sets `WHISPER_DONT_GENERATE_BINDINGS=1`
because bindgen 0.69 cannot parse whisper.cpp headers with clang 22.

Recommended setup for best results: Settings → Transcription → OpenAI
(`gpt-4o-transcribe`) or Groq (`whisper-large-v3`); Settings → AI Model → Claude
or OpenAI for enhancement and chat. Wear headphones so your mic does not pick up
the other side.
