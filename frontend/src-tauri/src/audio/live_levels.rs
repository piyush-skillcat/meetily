// audio/live_levels.rs
//
// Live input levels for the recording UI's meters. The pipeline publishes the
// RMS of every chunk it receives (mic and system separately); the frontend
// polls `get_live_audio_levels` a few times a second while recording.

use super::recording_state::DeviceType;
use serde::Serialize;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Levels older than this read as silence (stream stalled or recording stopped).
const STALE_AFTER_MS: u64 = 500;
/// Meter floor: anything quieter reads as 0.
const FLOOR_DB: f32 = -60.0;

static MIC_LEVEL: AtomicU32 = AtomicU32::new(0);
static SYSTEM_LEVEL: AtomicU32 = AtomicU32::new(0);
static MIC_UPDATED_MS: AtomicU64 = AtomicU64::new(0);
static SYSTEM_UPDATED_MS: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
pub struct LiveLevels {
    /// 0.0 (silent, ≤ -60 dBFS) to 1.0 (0 dBFS), perceptual (dB) scale.
    pub mic: f32,
    pub system: f32,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// Map an RMS amplitude to a 0..1 meter position on a dB scale.
pub fn meter_level(rms: f32) -> f32 {
    if rms <= 0.0 {
        return 0.0;
    }
    ((20.0 * rms.log10() - FLOOR_DB) / -FLOOR_DB).clamp(0.0, 1.0)
}

/// Record the level of one captured chunk.
pub fn publish(device: &DeviceType, samples: &[f32]) {
    if samples.is_empty() {
        return;
    }
    let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
    let level = meter_level(rms).to_bits();
    match device {
        DeviceType::Microphone => {
            MIC_LEVEL.store(level, Ordering::Relaxed);
            MIC_UPDATED_MS.store(now_ms(), Ordering::Relaxed);
        }
        DeviceType::System => {
            SYSTEM_LEVEL.store(level, Ordering::Relaxed);
            SYSTEM_UPDATED_MS.store(now_ms(), Ordering::Relaxed);
        }
    }
}

fn read(level: &AtomicU32, updated: &AtomicU64, now: u64) -> f32 {
    if now.saturating_sub(updated.load(Ordering::Relaxed)) > STALE_AFTER_MS {
        0.0
    } else {
        f32::from_bits(level.load(Ordering::Relaxed))
    }
}

pub fn current() -> LiveLevels {
    let now = now_ms();
    LiveLevels {
        mic: read(&MIC_LEVEL, &MIC_UPDATED_MS, now),
        system: read(&SYSTEM_LEVEL, &SYSTEM_UPDATED_MS, now),
    }
}

#[tauri::command]
pub fn get_live_audio_levels() -> LiveLevels {
    current()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn meter_maps_db_range() {
        assert_eq!(meter_level(0.0), 0.0);
        assert_eq!(meter_level(1.0), 1.0);
        assert!((meter_level(0.1) - 2.0 / 3.0).abs() < 1e-3); // -20 dBFS
        assert_eq!(meter_level(0.0001), 0.0); // -80 dBFS, below the floor
    }

    #[test]
    fn published_levels_are_read_back_per_lane() {
        publish(&DeviceType::Microphone, &[0.1, -0.1, 0.1, -0.1]);
        publish(&DeviceType::System, &[0.0; 4]);
        let levels = current();
        assert!((levels.mic - 2.0 / 3.0).abs() < 1e-3);
        assert_eq!(levels.system, 0.0);
    }
}
