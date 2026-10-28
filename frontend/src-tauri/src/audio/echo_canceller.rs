// audio/echo_canceller.rs
//
// Acoustic echo cancellation for the mic lane, using WebRTC's AEC3 (the echo
// canceller in Chrome and PipeWire's echo-cancel module).
//
// On laptop speakers the mic hears the remote side. The system-audio lane is
// exactly what the speakers play, so it serves as AEC3's far-end ("render")
// reference; AEC3 estimates the speaker→mic delay and subtracts the echo from
// the mic ("capture") signal. Unlike the old crosstalk gate, which dropped
// whole mic windows, this keeps the user's own voice when both sides talk at
// once.
//
// Linux links the system webrtc-audio-processing-2 library; macOS builds the
// same library from source (the crate's `bundled` feature). Elsewhere
// `EchoCanceller::new` returns None and callers keep their previous behaviour.

#[cfg(any(target_os = "linux", target_os = "macos"))]
mod imp {
    use log::{info, warn};
    use webrtc_audio_processing::config::{Config, EchoCanceller as Aec, HighPassFilter};
    use webrtc_audio_processing::Processor;

    pub struct EchoCanceller {
        processor: Processor,
        frame_len: usize,
        frames_processed: u64,
    }

    impl EchoCanceller {
        /// AEC3 runs at 8, 16, 32 or 48 kHz; the pipeline runs at 48 kHz.
        pub fn new(sample_rate: u32) -> Option<Self> {
            if ![8_000, 16_000, 32_000, 48_000].contains(&sample_rate) {
                warn!("Echo cancellation unavailable at {} Hz", sample_rate);
                return None;
            }
            let processor = match Processor::new(sample_rate) {
                Ok(p) => p,
                Err(e) => {
                    warn!("Echo cancellation unavailable: {:?}", e);
                    return None;
                }
            };
            // Echo cancellation only: the mic is already noise-suppressed and
            // loudness-normalised at capture, and the pipeline's own gate
            // handles levels. AEC3's delay estimator finds the speaker→mic lag.
            processor.set_config(Config {
                echo_canceller: Some(Aec::default()),
                high_pass_filter: Some(HighPassFilter::default()),
                ..Default::default()
            });
            info!("🔇 Echo cancellation (WebRTC AEC3) enabled at {} Hz", sample_rate);
            Some(Self { processor, frame_len: processor_frame_len(sample_rate), frames_processed: 0 })
        }

        /// Remove the system-audio echo from a mic window. `mic` and `sys` are
        /// time-aligned windows of equal length; the result has the same length.
        /// A trailing partial frame (never produced by the pipeline's 600 ms
        /// windows) is passed through untouched.
        pub fn process(&mut self, mic: &[f32], sys: &[f32]) -> Vec<f32> {
            let mut out = mic.to_vec();
            let frames = mic.len().min(sys.len()) / self.frame_len;
            for i in 0..frames {
                let range = i * self.frame_len..(i + 1) * self.frame_len;
                // Render (far end) first, then the capture frame recorded at the same time.
                if let Err(e) = self.processor.analyze_render_frame([&sys[range.clone()]]) {
                    warn!("AEC render frame failed: {:?}", e);
                    return mic.to_vec();
                }
                if let Err(e) = self.processor.process_capture_frame([&mut out[range]]) {
                    warn!("AEC capture frame failed: {:?}", e);
                    return mic.to_vec();
                }
            }
            self.frames_processed += frames as u64;
            // Every ~30 s, log how well it is doing (ERLE: echo removed, in dB).
            if frames > 0 && self.frames_processed % 3_000 < frames as u64 {
                let stats = self.processor.get_stats();
                info!(
                    "🔇 AEC3: delay {:?} ms, echo return loss enhancement {:?} dB",
                    stats.delay_ms,
                    stats.echo_return_loss_enhancement.map(|v| (v * 10.0).round() / 10.0)
                );
            }
            out
        }
    }

    fn processor_frame_len(sample_rate: u32) -> usize {
        // AEC3 works on 10 ms frames.
        sample_rate as usize / 100
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
mod imp {
    pub struct EchoCanceller;

    impl EchoCanceller {
        pub fn new(_sample_rate: u32) -> Option<Self> {
            None
        }

        pub fn process(&mut self, mic: &[f32], _sys: &[f32]) -> Vec<f32> {
            mic.to_vec()
        }
    }
}

pub use imp::EchoCanceller;

#[cfg(all(test, any(target_os = "linux", target_os = "macos")))]
mod tests {
    use super::*;

    const RATE: u32 = 48_000;
    const WINDOW: usize = RATE as usize * 6 / 10; // the pipeline's 600 ms window

    /// Deterministic speech-like noise (filtered pseudo-random), so the test
    /// does not depend on audio fixtures.
    fn voice(len: usize, seed: u32) -> Vec<f32> {
        let mut state = seed;
        let mut low = 0.0f32;
        (0..len)
            .map(|i| {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let white = (state >> 8) as f32 / (1u32 << 24) as f32 - 0.5;
                low = 0.9 * low + 0.1 * white;
                // Syllable-like amplitude envelope (~4 Hz).
                let envelope = 0.5 + 0.5 * (i as f32 * 2.0 * std::f32::consts::PI * 4.0 / RATE as f32).sin();
                low * envelope * 2.0
            })
            .collect()
    }

    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|s| s * s).sum::<f32>() / x.len().max(1) as f32).sqrt()
    }

    /// Mic = remote audio played on speakers and picked up 40 ms later at
    /// 60 % level. After a few seconds of convergence AEC3 should remove most of it.
    #[test]
    fn removes_speaker_echo_from_mic() {
        let mut aec = EchoCanceller::new(RATE).expect("AEC3 available");
        let delay = RATE as usize * 40 / 1000;
        let far = voice(WINDOW * 20, 7);
        let mut residual_last = 0.0;
        let mut echo_last = 0.0;
        for w in 0..20 {
            let sys = &far[w * WINDOW..(w + 1) * WINDOW];
            let mic: Vec<f32> = (w * WINDOW..(w + 1) * WINDOW)
                .map(|i| if i >= delay { far[i - delay] * 0.6 } else { 0.0 })
                .collect();
            let cleaned = aec.process(&mic, sys);
            assert_eq!(cleaned.len(), mic.len());
            if w == 19 {
                residual_last = rms(&cleaned);
                echo_last = rms(&mic);
            }
        }
        // At least 12 dB of echo removed once converged.
        assert!(
            residual_last < echo_last / 4.0,
            "residual {residual_last} vs echo {echo_last}"
        );
    }

    /// The user talking over the remote side must survive cancellation.
    #[test]
    fn keeps_near_end_speech_during_double_talk() {
        let mut aec = EchoCanceller::new(RATE).expect("AEC3 available");
        let delay = RATE as usize * 40 / 1000;
        let far = voice(WINDOW * 20, 7);
        let near = voice(WINDOW * 20, 99);
        let mut kept = 0.0;
        let mut near_rms = 0.0;
        for w in 0..20 {
            let sys = &far[w * WINDOW..(w + 1) * WINDOW];
            // The user only starts talking after AEC3 has converged on echo alone.
            let talking = w >= 15;
            let mic: Vec<f32> = (w * WINDOW..(w + 1) * WINDOW)
                .map(|i| {
                    let echo = if i >= delay { far[i - delay] * 0.6 } else { 0.0 };
                    echo + if talking { near[i] } else { 0.0 }
                })
                .collect();
            let cleaned = aec.process(&mic, sys);
            if w == 19 {
                kept = rms(&cleaned);
                near_rms = rms(&near[w * WINDOW..(w + 1) * WINDOW]);
            }
        }
        // Most of the user's own voice remains (within ~6 dB).
        assert!(kept > near_rms / 2.0, "kept {kept} vs near-end {near_rms}");
    }

    #[test]
    fn output_matches_input_length_with_partial_frame() {
        let mut aec = EchoCanceller::new(RATE).expect("AEC3 available");
        let mic = vec![0.1; 1000];
        let sys = vec![0.0; 1000];
        assert_eq!(aec.process(&mic, &sys).len(), 1000);
    }
}
