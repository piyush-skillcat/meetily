// audio/transcription/cloud_provider.rs
//
// Cloud speech-to-text provider using the OpenAI-compatible
// `POST /audio/transcriptions` endpoint. Supports OpenAI (gpt-4o-transcribe,
// whisper-1) and Groq (whisper-large-v3, whisper-large-v3-turbo).
//
// The live pipeline hands us 16 kHz mono f32 speech segments (already
// VAD-trimmed). We encode them as a 16-bit PCM WAV in memory and upload.

use super::provider::{TranscriptResult, TranscriptionError, TranscriptionProvider};
use async_trait::async_trait;
use log::{info, warn};
use reqwest::multipart;
use std::time::Duration;

const SAMPLE_RATE: u32 = 16_000;
/// Cloud endpoints reject very short clips; pad to at least this many seconds.
const MIN_CLIP_SECONDS: f32 = 1.0;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloudSttVendor {
    OpenAI,
    Groq,
}

impl CloudSttVendor {
    pub fn from_provider_str(s: &str) -> Option<Self> {
        match s {
            "openai" => Some(Self::OpenAI),
            "groq" => Some(Self::Groq),
            _ => None,
        }
    }

    fn endpoint(&self) -> &'static str {
        match self {
            Self::OpenAI => "https://api.openai.com/v1/audio/transcriptions",
            Self::Groq => "https://api.groq.com/openai/v1/audio/transcriptions",
        }
    }

    pub fn default_model(&self) -> &'static str {
        match self {
            Self::OpenAI => "gpt-4o-transcribe",
            Self::Groq => "whisper-large-v3",
        }
    }

    fn name(&self) -> &'static str {
        match self {
            Self::OpenAI => "OpenAI",
            Self::Groq => "Groq",
        }
    }
}

pub struct CloudTranscriptionProvider {
    vendor: CloudSttVendor,
    model: String,
    api_key: String,
    client: reqwest::Client,
}

impl CloudTranscriptionProvider {
    pub fn new(vendor: CloudSttVendor, model: String, api_key: String) -> Self {
        let model = if model.trim().is_empty() {
            vendor.default_model().to_string()
        } else {
            model
        };
        Self {
            vendor,
            model,
            api_key,
            client: reqwest::Client::new(),
        }
    }

    pub fn vendor(&self) -> CloudSttVendor {
        self.vendor
    }
}

/// Encode 16 kHz mono f32 samples as a 16-bit PCM WAV byte buffer.
pub fn encode_wav_16k_pcm16(samples: &[f32]) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // PCM chunk size
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM format
    out.extend_from_slice(&1u16.to_le_bytes()); // channels
    out.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    out.extend_from_slice(&(SAMPLE_RATE * 2).to_le_bytes()); // byte rate
    out.extend_from_slice(&2u16.to_le_bytes()); // block align
    out.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for s in samples {
        let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

/// Whisper-family models hallucinate stock phrases on near-silent audio.
/// Returns true when the text is one of those and should be dropped.
pub fn is_probable_hallucination(text: &str) -> bool {
    let t = text.trim().to_lowercase();
    if t.is_empty() {
        return true;
    }
    const BLOCKLIST: &[&str] = &[
        "thank you for watching",
        "thanks for watching",
        "subscribe to my channel",
        "please subscribe",
        "see you in the next video",
        "[music]",
        "[applause]",
        "[laughter]",
        "[blank_audio]",
        "(applause)",
        "(laughter)",
        "♪",
    ];
    if BLOCKLIST.iter().any(|p| t.contains(p)) {
        return true;
    }
    // Pure punctuation / symbols
    !t.chars().any(|c| c.is_alphanumeric())
}

#[async_trait]
impl TranscriptionProvider for CloudTranscriptionProvider {
    async fn transcribe(
        &self,
        audio: Vec<f32>,
        language: Option<String>,
    ) -> std::result::Result<TranscriptResult, TranscriptionError> {
        if audio.is_empty() {
            return Err(TranscriptionError::AudioTooShort {
                samples: 0,
                minimum: 1600,
            });
        }

        // Pad short clips with trailing silence so the API accepts them.
        let min_samples = (MIN_CLIP_SECONDS * SAMPLE_RATE as f32) as usize;
        let mut samples = audio;
        if samples.len() < min_samples {
            samples.resize(min_samples, 0.0);
        }

        let wav = encode_wav_16k_pcm16(&samples);

        let file_part = multipart::Part::bytes(wav)
            .file_name("segment.wav")
            .mime_str("audio/wav")
            .map_err(|e| TranscriptionError::EngineFailed(e.to_string()))?;

        let mut form = multipart::Form::new()
            .part("file", file_part)
            .text("model", self.model.clone())
            .text("response_format", "json")
            .text("temperature", "0");

        // "auto" / "auto-translate" mean "let the model detect"; only pass real codes.
        if let Some(lang) = language.as_deref() {
            let lang = lang.trim();
            if !lang.is_empty() && lang != "auto" && lang != "auto-translate" {
                form = form.text("language", lang.to_string());
            }
        }

        let response = self
            .client
            .post(self.vendor.endpoint())
            .bearer_auth(&self.api_key)
            .multipart(form)
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await
            .map_err(|e| TranscriptionError::EngineFailed(format!("{} request failed: {}", self.vendor.name(), e)))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| TranscriptionError::EngineFailed(e.to_string()))?;

        if !status.is_success() {
            warn!("{} transcription HTTP {}: {}", self.vendor.name(), status, body);
            return Err(TranscriptionError::EngineFailed(format!(
                "{} transcription failed ({}): {}",
                self.vendor.name(),
                status,
                body.chars().take(300).collect::<String>()
            )));
        }

        let json: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| TranscriptionError::EngineFailed(format!("Invalid JSON from {}: {}", self.vendor.name(), e)))?;
        let text = json
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        if is_probable_hallucination(&text) {
            info!("Dropping probable hallucination from {}: '{}'", self.vendor.name(), text);
            return Ok(TranscriptResult {
                text: String::new(),
                confidence: None,
                is_partial: false,
            });
        }

        Ok(TranscriptResult {
            text,
            confidence: None,
            is_partial: false,
        })
    }

    async fn is_model_loaded(&self) -> bool {
        !self.api_key.is_empty()
    }

    async fn get_current_model(&self) -> Option<String> {
        Some(self.model.clone())
    }

    fn provider_name(&self) -> &'static str {
        match self.vendor {
            CloudSttVendor::OpenAI => "OpenAI Cloud STT",
            CloudSttVendor::Groq => "Groq Cloud STT",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_header_is_well_formed() {
        let wav = encode_wav_16k_pcm16(&[0.0, 0.5, -0.5]);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(wav.len(), 44 + 6);
    }

    #[test]
    fn hallucination_filter() {
        assert!(is_probable_hallucination("Thank you for watching!"));
        assert!(is_probable_hallucination("..."));
        assert!(!is_probable_hallucination("Let's ship this on Friday."));
    }
}
