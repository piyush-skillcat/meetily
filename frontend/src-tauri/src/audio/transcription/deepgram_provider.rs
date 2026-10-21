// audio/transcription/deepgram_provider.rs
//
// Deepgram live (streaming) speech-to-text over WebSocket.
//
// The pipeline already splits audio into per-lane speech segments (mic = You,
// system = Them). We keep one persistent Deepgram connection per lane so each
// side of the call is recognised as its own continuous stream, then for every
// segment: stream its PCM, send `Finalize`, and collect results until the
// response marked `from_finalize`. Only speech is sent (billing follows audio
// sent); `KeepAlive` holds the connection open through the gaps.

use super::provider::{TranscriptResult, TranscriptionError, TranscriptionProvider};
use async_trait::async_trait;
use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use log::{info, warn};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;
type WsSink = SplitSink<Ws, Message>;
type WsStream = SplitStream<Ws>;

const ENDPOINT: &str = "wss://api.deepgram.com/v1/listen";
pub const DEFAULT_MODEL: &str = "nova-3";
const SAMPLE_RATE: u32 = 16_000;
/// Audio is streamed in 100 ms frames, as Deepgram recommends for live input.
const FRAME_SAMPLES: usize = SAMPLE_RATE as usize / 10;
/// Deepgram closes a stream after ~10 s without audio or KeepAlive.
const KEEPALIVE_EVERY: Duration = Duration::from_secs(4);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const FINALIZE_TIMEOUT: Duration = Duration::from_secs(15);
/// Deepgram accepts up to 100 keyterms per request.
const MAX_KEYTERMS: usize = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Lane {
    Mic,
    System,
}

impl Lane {
    fn from_str(lane: &str) -> Self {
        if lane == "system" { Lane::System } else { Lane::Mic }
    }

    fn name(self) -> &'static str {
        match self {
            Lane::Mic => "mic",
            Lane::System => "system",
        }
    }
}

/// One open Deepgram stream. The sink is shared with the KeepAlive task.
struct LaneConn {
    sink: Arc<Mutex<WsSink>>,
    stream: WsStream,
    language: String,
    keepalive: tokio::task::JoinHandle<()>,
}

impl Drop for LaneConn {
    fn drop(&mut self) {
        self.keepalive.abort();
        let Ok(runtime) = tokio::runtime::Handle::try_current() else { return };
        let sink = self.sink.clone();
        runtime.spawn(async move {
            let mut sink = sink.lock().await;
            let _ = sink.send(Message::Text(r#"{"type":"CloseStream"}"#.into())).await;
            let _ = sink.close().await;
        });
    }
}

pub struct DeepgramProvider {
    api_key: String,
    model: String,
    keyterms: Vec<String>,
    mic: Mutex<Option<LaneConn>>,
    system: Mutex<Option<LaneConn>>,
}

impl DeepgramProvider {
    pub fn new(api_key: String, model: String, keyterms: Vec<String>) -> Self {
        let model = if model.trim().is_empty() { DEFAULT_MODEL.to_string() } else { model };
        Self {
            api_key,
            model,
            keyterms,
            mic: Mutex::new(None),
            system: Mutex::new(None),
        }
    }

    fn slot(&self, lane: Lane) -> &Mutex<Option<LaneConn>> {
        match lane {
            Lane::Mic => &self.mic,
            Lane::System => &self.system,
        }
    }

    async fn connect(&self, lane: Lane, language: &str) -> Result<LaneConn, TranscriptionError> {
        let url = build_listen_url(&self.model, language, &self.keyterms)?;
        let mut request = url
            .as_str()
            .into_client_request()
            .map_err(|e| TranscriptionError::EngineFailed(format!("Deepgram request: {}", e)))?;
        let auth = HeaderValue::from_str(&format!("Token {}", self.api_key))
            .map_err(|_| TranscriptionError::EngineFailed("Deepgram API key contains invalid characters".into()))?;
        request.headers_mut().insert("Authorization", auth);

        let (ws, _response) = tokio::time::timeout(CONNECT_TIMEOUT, connect_async(request))
            .await
            .map_err(|_| TranscriptionError::EngineFailed("Deepgram connection timed out".into()))?
            .map_err(|e| TranscriptionError::EngineFailed(format!("Deepgram connection failed: {}", e)))?;

        info!("☁️ Deepgram {} lane connected (model {}, language {})", lane.name(), self.model, language);

        let (sink, stream) = ws.split();
        let sink = Arc::new(Mutex::new(sink));
        let keepalive_sink = sink.clone();
        let keepalive = tokio::spawn(async move {
            let mut tick = tokio::time::interval(KEEPALIVE_EVERY);
            tick.tick().await;
            loop {
                tick.tick().await;
                let mut sink = keepalive_sink.lock().await;
                if sink.send(Message::Text(r#"{"type":"KeepAlive"}"#.into())).await.is_err() {
                    break;
                }
            }
        });

        Ok(LaneConn { sink, stream, language: language.to_string(), keepalive })
    }

    async fn transcribe_on_lane(
        &self,
        lane: Lane,
        audio: Vec<f32>,
        language: Option<String>,
    ) -> Result<TranscriptResult, TranscriptionError> {
        if audio.is_empty() {
            return Ok(empty_result());
        }
        let language = deepgram_language(language.as_deref());

        // Segments of one lane are sent in order over one stream; the two lanes
        // run independently.
        let mut slot = self.slot(lane).lock().await;
        let mut last_err = None;
        for attempt in 0..2 {
            if slot.as_ref().map_or(true, |c| c.language != language) {
                *slot = None;
                *slot = Some(self.connect(lane, &language).await?);
            }
            let conn = slot.as_mut().expect("connection just established");
            match run_segment(conn, &audio).await {
                Ok(result) => return Ok(result),
                Err(e) => {
                    warn!("Deepgram {} lane segment failed (attempt {}): {}", lane.name(), attempt + 1, e);
                    // Drop the stream: a half-read stream would misattribute
                    // late results to the next segment.
                    *slot = None;
                    last_err = Some(e);
                }
            }
        }
        Err(last_err.unwrap_or_else(|| TranscriptionError::EngineFailed("Deepgram transcription failed".into())))
    }
}

/// Stream one speech segment, flush it with `Finalize`, and collect the final
/// transcript up to the `from_finalize` response.
async fn run_segment(conn: &mut LaneConn, audio: &[f32]) -> Result<TranscriptResult, TranscriptionError> {
    {
        let mut sink = conn.sink.lock().await;
        for frame in audio.chunks(FRAME_SAMPLES) {
            sink.send(Message::Binary(pcm16_le(frame)))
                .await
                .map_err(|e| TranscriptionError::EngineFailed(format!("Deepgram send failed: {}", e)))?;
        }
        sink.send(Message::Text(r#"{"type":"Finalize"}"#.into()))
            .await
            .map_err(|e| TranscriptionError::EngineFailed(format!("Deepgram finalize failed: {}", e)))?;
    }

    let mut parts: Vec<String> = Vec::new();
    let collect = async {
        while let Some(message) = conn.stream.next().await {
            let message = message
                .map_err(|e| TranscriptionError::EngineFailed(format!("Deepgram stream error: {}", e)))?;
            match message {
                Message::Text(text) => {
                    let value: serde_json::Value = match serde_json::from_str(&text) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };
                    match value.get("type").and_then(|t| t.as_str()) {
                        Some("Results") => {
                            if let Some(piece) = final_transcript(&value) {
                                parts.push(piece);
                            }
                            if value.get("from_finalize").and_then(|v| v.as_bool()) == Some(true) {
                                return Ok(());
                            }
                        }
                        Some("Error") => {
                            return Err(TranscriptionError::EngineFailed(format!("Deepgram error: {}", text)));
                        }
                        _ => {}
                    }
                }
                Message::Close(frame) => {
                    return Err(TranscriptionError::EngineFailed(format!(
                        "Deepgram closed the stream: {}",
                        frame.map(|f| f.reason.to_string()).unwrap_or_default()
                    )));
                }
                _ => {}
            }
        }
        Err(TranscriptionError::EngineFailed("Deepgram stream ended".into()))
    };

    match tokio::time::timeout(FINALIZE_TIMEOUT, collect).await {
        Ok(Ok(())) => Ok(TranscriptResult { text: parts.join(" "), confidence: None, is_partial: false }),
        Ok(Err(e)) => Err(e),
        Err(_) => Err(TranscriptionError::EngineFailed("Deepgram did not finalize in time".into())),
    }
}

/// Text of a final `Results` message, if it carries any.
fn final_transcript(value: &serde_json::Value) -> Option<String> {
    if value.get("is_final").and_then(|v| v.as_bool()) != Some(true) {
        return None;
    }
    let text = value
        .pointer("/channel/alternatives/0/transcript")
        .and_then(|t| t.as_str())?
        .trim();
    (!text.is_empty()).then(|| text.to_string())
}

/// "auto" / "auto-translate" / unset → nova-3 multilingual; otherwise the code.
fn deepgram_language(language: Option<&str>) -> String {
    match language.map(str::trim) {
        None | Some("") | Some("auto") | Some("auto-translate") => "multi".to_string(),
        Some(code) => code.to_string(),
    }
}

fn build_listen_url(model: &str, language: &str, keyterms: &[String]) -> Result<url::Url, TranscriptionError> {
    let mut url = url::Url::parse(ENDPOINT).map_err(|e| TranscriptionError::EngineFailed(e.to_string()))?;
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("model", model)
            .append_pair("encoding", "linear16")
            .append_pair("sample_rate", &SAMPLE_RATE.to_string())
            .append_pair("channels", "1")
            .append_pair("language", language)
            .append_pair("smart_format", "true")
            .append_pair("punctuate", "true")
            .append_pair("interim_results", "false")
            // Meeting audio is private: keep it out of Deepgram's model improvement program.
            .append_pair("mip_opt_out", "true");
        // Keyterm prompting applies to monolingual nova-3 streams.
        if language != "multi" {
            for term in keyterms.iter().map(|t| t.trim()).filter(|t| !t.is_empty()).take(MAX_KEYTERMS) {
                q.append_pair("keyterm", term);
            }
        }
    }
    Ok(url)
}

fn pcm16_le(samples: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(samples.len() * 2);
    for s in samples {
        let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

fn empty_result() -> TranscriptResult {
    TranscriptResult { text: String::new(), confidence: None, is_partial: false }
}

#[async_trait]
impl TranscriptionProvider for DeepgramProvider {
    async fn transcribe(
        &self,
        audio: Vec<f32>,
        language: Option<String>,
    ) -> std::result::Result<TranscriptResult, TranscriptionError> {
        self.transcribe_on_lane(Lane::Mic, audio, language).await
    }

    async fn transcribe_lane(
        &self,
        audio: Vec<f32>,
        language: Option<String>,
        lane: &str,
    ) -> std::result::Result<TranscriptResult, TranscriptionError> {
        self.transcribe_on_lane(Lane::from_str(lane), audio, language).await
    }

    async fn is_model_loaded(&self) -> bool {
        !self.api_key.is_empty()
    }

    async fn get_current_model(&self) -> Option<String> {
        Some(self.model.clone())
    }

    fn provider_name(&self) -> &'static str {
        "Deepgram Live STT"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_has_audio_format_and_keyterms() {
        let terms = vec!["SkillCat".to_string(), " Notesify ".to_string(), "".to_string()];
        let url = build_listen_url("nova-3", "en", &terms).unwrap();
        let q: Vec<(String, String)> = url.query_pairs().into_owned().collect();
        assert!(q.contains(&("encoding".into(), "linear16".into())));
        assert!(q.contains(&("sample_rate".into(), "16000".into())));
        assert!(q.contains(&("language".into(), "en".into())));
        let keyterms: Vec<_> = q.iter().filter(|(k, _)| k == "keyterm").map(|(_, v)| v.as_str()).collect();
        assert_eq!(keyterms, vec!["SkillCat", "Notesify"]);
    }

    #[test]
    fn multilingual_stream_skips_keyterms() {
        let url = build_listen_url("nova-3", "multi", &["SkillCat".to_string()]).unwrap();
        assert!(!url.query_pairs().any(|(k, _)| k == "keyterm"));
    }

    #[test]
    fn auto_language_maps_to_multi() {
        assert_eq!(deepgram_language(None), "multi");
        assert_eq!(deepgram_language(Some("auto")), "multi");
        assert_eq!(deepgram_language(Some("en")), "en");
    }

    #[test]
    fn only_final_results_with_text_are_kept() {
        let final_msg = serde_json::json!({
            "type": "Results", "is_final": true,
            "channel": { "alternatives": [{ "transcript": " Ship it Friday. " }] }
        });
        let interim = serde_json::json!({
            "type": "Results", "is_final": false,
            "channel": { "alternatives": [{ "transcript": "Ship" }] }
        });
        let empty = serde_json::json!({
            "type": "Results", "is_final": true, "from_finalize": true,
            "channel": { "alternatives": [{ "transcript": "" }] }
        });
        assert_eq!(final_transcript(&final_msg).as_deref(), Some("Ship it Friday."));
        assert_eq!(final_transcript(&interim), None);
        assert_eq!(final_transcript(&empty), None);
    }

    #[test]
    fn pcm16_encodes_little_endian() {
        assert_eq!(pcm16_le(&[0.0, 1.0, -1.0]), vec![0, 0, 0xff, 0x7f, 0x01, 0x80]);
    }

    /// Live check against Deepgram (uses credits):
    /// DEEPGRAM_API_KEY=… DEEPGRAM_TEST_WAV=speech-16k-mono.wav \
    ///   cargo test --lib deepgram_provider::tests::live -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn live_two_segments_and_silence_on_one_lane() {
        let key = std::env::var("DEEPGRAM_API_KEY").expect("DEEPGRAM_API_KEY");
        let wav = std::fs::read(std::env::var("DEEPGRAM_TEST_WAV").expect("DEEPGRAM_TEST_WAV")).unwrap();
        let data = wav.windows(4).position(|w| w == b"data").expect("WAV data chunk") + 8;
        let speech: Vec<f32> = wav[data..]
            .chunks_exact(2)
            .map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / i16::MAX as f32)
            .collect();

        let provider = DeepgramProvider::new(key, String::new(), vec!["Notesify".into()]);
        for round in 1..=2 {
            let started = std::time::Instant::now();
            let result = provider.transcribe_lane(speech.clone(), Some("en".into()), "system").await.unwrap();
            println!("round {}: {:?} in {:?}", round, result.text, started.elapsed());
            assert!(!result.text.is_empty());
        }
        let started = std::time::Instant::now();
        let silent = provider.transcribe_lane(vec![0.0; 16_000], Some("en".into()), "system").await.unwrap();
        println!("silence: {:?} in {:?}", silent.text, started.elapsed());
        assert!(silent.text.is_empty());
    }
}
