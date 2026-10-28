// Core Audio implementation for macOS system audio capture
//
// A global process tap (macOS 14.4+) wrapped in a private aggregate device.
// The tap and aggregate are owned by a supervisor thread that:
// - drains the real-time ring buffer and forwards chunks to the async stream,
// - rebuilds the tap when the default output device changes or disappears,
//   or when its sample rate changes (AirPods switching to the call profile),
// - resamples to the rate the stream started at, so the pipeline never sees
//   a rate change,
// - flags a likely permission denial: other apps are playing audio but the
//   tap delivers only silence (macOS hands a denied tap zeros, not an error).
//
// The IO proc itself only copies samples into a lock-free ring buffer.
// This module is compiled only on macOS (see capture/mod.rs).

use std::pin::Pin;
use std::task::{Context, Poll};
use anyhow::Result;
use futures_util::Stream;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use futures_channel::mpsc;
use ringbuf::{
    traits::{Consumer, Producer, Split},
    HeapCons, HeapProd, HeapRb,
};
use log::{error, info, warn};

use cidre::{arc, av, cat, cf, core_audio as ca, ns, os};

/// How long other apps must be playing, with the tap delivering only zeros,
/// before we report that system audio is probably not permitted.
const SILENCE_WHILE_PLAYING: Duration = Duration::from_secs(8);

/// Core Audio speaker input using aggregate device + tap
pub struct CoreAudioCapture;

/// Mono f32 system audio at a fixed sample rate (the rate it started at)
pub struct CoreAudioStream {
    rx: mpsc::UnboundedReceiver<Vec<f32>>,
    chunk: Vec<f32>,
    pos: usize,
    sample_rate: u32,
    stop: Arc<AtomicBool>,
}

/// State shared with the real-time IO proc. Only lock-free operations here.
struct IoContext {
    producer: HeapProd<f32>,
    callbacks: Arc<AtomicU64>,
    overflows: Arc<AtomicU64>,
}

/// One running tap + aggregate device. Field order is drop order: the device
/// is stopped and destroyed before the context it writes into is freed, and
/// the tap goes last.
struct TapSession {
    device: ca::hardware::StartedDevice<ca::AggregateDevice>,
    _ctx: Box<IoContext>,
    _tap: ca::TapGuard,
    consumer: HeapCons<f32>,
    output_uid: String,
    rate: u32,
    callbacks: Arc<AtomicU64>,
    overflows: Arc<AtomicU64>,
}

extern "C" fn io_proc(
    _device: ca::Device,
    _now: &cat::AudioTimeStamp,
    input_data: &cat::AudioBufList<1>,
    _input_time: &cat::AudioTimeStamp,
    _output_data: &mut cat::AudioBufList<1>,
    _output_time: &cat::AudioTimeStamp,
    ctx: Option<&mut IoContext>,
) -> os::Status {
    let Some(ctx) = ctx else {
        return os::Status::NO_ERR;
    };
    ctx.callbacks.fetch_add(1, Ordering::Relaxed);

    let buf = &input_data.buffers[0];
    let count = buf.data_bytes_size as usize / std::mem::size_of::<f32>();
    if count > 0 && !buf.data.is_null() {
        // The tap format is checked to be mono f32 when the session starts.
        let data = unsafe { std::slice::from_raw_parts(buf.data as *const f32, count) };
        if ctx.producer.push_slice(data) < count {
            ctx.overflows.fetch_add(1, Ordering::Relaxed);
        }
    }
    os::Status::NO_ERR
}

fn cf_to_string(s: &cf::String) -> String {
    s.to_string()
}

/// Core Audio's object for this process, so the tap can leave our own sounds out
fn own_process_exclusion() -> arc::R<ns::Array<ns::Number>> {
    match ca::Process::with_pid(std::process::id() as i32) {
        Ok(process) if process.0 .0 != 0 => {
            ns::Array::from_slice_retained(&[ns::Number::with_u32(process.0 .0)])
        }
        _ => ns::Array::new(),
    }
}

/// True when another process is sending audio to an output device
fn other_process_is_playing() -> bool {
    let own_pid = std::process::id() as i32;
    ca::System::processes()
        .map(|list| {
            list.iter().any(|p| {
                p.pid().map(|pid| pid != own_pid).unwrap_or(false)
                    && p.is_running_output().unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

fn default_output_uid() -> Option<String> {
    ca::System::default_output_device()
        .ok()
        .and_then(|d| d.uid().ok())
        .map(|uid| cf_to_string(&uid))
}

impl TapSession {
    fn start() -> Result<Self> {
        let output_device = ca::System::default_output_device()
            .map_err(|e| anyhow::anyhow!("Failed to get default output device: {:?}", e))?;
        let output_uid = output_device
            .uid()
            .map_err(|e| anyhow::anyhow!("Failed to get output device UID: {:?}", e))?;
        let device_name = output_device
            .name()
            .map(|n| cf_to_string(&n))
            .unwrap_or_else(|_| "Unknown".into());

        // Mono global tap of everything except this app. The tap alone is the
        // aggregate's input; adding the output device too would double the audio.
        let tap_desc = ca::TapDesc::with_mono_global_tap_excluding_processes(&own_process_exclusion());
        let tap = tap_desc
            .create_process_tap()
            .map_err(|e| anyhow::anyhow!("Failed to create process tap: {:?}", e))?;
        let tap_uid = tap
            .uid()
            .map_err(|e| anyhow::anyhow!("Failed to get tap UID: {:?}", e))?;
        let asbd = tap
            .asbd()
            .map_err(|e| anyhow::anyhow!("Failed to get tap format: {:?}", e))?;
        let format = av::AudioFormat::with_asbd(&asbd)
            .ok_or_else(|| anyhow::anyhow!("Unsupported tap format"))?;
        if format.common_format() != av::audio::CommonFormat::PcmF32 || asbd.channels_per_frame != 1 {
            anyhow::bail!(
                "Unexpected tap format: {:?}, {} channels",
                format.common_format(),
                asbd.channels_per_frame
            );
        }

        let sub_tap = cf::DictionaryOf::with_keys_values(
            &[ca::sub_device_keys::uid()],
            &[tap_uid.as_type_ref()],
        );
        let agg_desc = cf::DictionaryOf::with_keys_values(
            &[
                ca::aggregate_device_keys::is_private(),
                ca::aggregate_device_keys::is_stacked(),
                ca::aggregate_device_keys::tap_auto_start(),
                ca::aggregate_device_keys::name(),
                ca::aggregate_device_keys::main_sub_device(),
                ca::aggregate_device_keys::uid(),
                ca::aggregate_device_keys::tap_list(),
            ],
            &[
                cf::Boolean::value_true().as_type_ref(),
                cf::Boolean::value_false(),
                cf::Boolean::value_true(),
                cf::str!(c"notesify-system-audio").as_type_ref(),
                &output_uid,
                &cf::Uuid::new().to_cf_string(),
                &cf::ArrayOf::from_slice(&[sub_tap.as_ref()]),
            ],
        );
        let agg_device = ca::AggregateDevice::with_desc(&agg_desc)
            .map_err(|e| anyhow::anyhow!("Failed to create aggregate device: {:?}", e))?;

        // ~2.7 s at 48 kHz; the supervisor drains it every 10 ms.
        let (producer, consumer) = HeapRb::<f32>::new(1 << 17).split();
        let callbacks = Arc::new(AtomicU64::new(0));
        let overflows = Arc::new(AtomicU64::new(0));
        let mut ctx = Box::new(IoContext {
            producer,
            callbacks: callbacks.clone(),
            overflows: overflows.clone(),
        });

        let proc_id = agg_device
            .create_io_proc_id(io_proc, Some(&mut *ctx))
            .map_err(|e| anyhow::anyhow!("Failed to create IO proc: {:?}", e))?;
        let device = ca::device_start(agg_device, Some(proc_id))
            .map_err(|e| anyhow::anyhow!("Failed to start aggregate device: {:?}", e))?;

        let rate = device
            .nominal_sample_rate()
            .ok()
            .filter(|r| *r > 0.0)
            .unwrap_or(asbd.sample_rate) as u32;

        info!(
            "CoreAudio: tapping system audio on '{}' at {} Hz (mono)",
            device_name, rate
        );

        Ok(Self {
            device,
            _ctx: ctx,
            _tap: tap,
            consumer,
            output_uid: cf_to_string(&output_uid),
            rate,
            callbacks,
            overflows,
        })
    }

    /// Why this session should be rebuilt, if it should
    fn needs_rebuild(&self) -> Option<String> {
        match default_output_uid() {
            Some(uid) if uid != self.output_uid => {
                return Some(format!("default output changed to {}", uid));
            }
            _ => {}
        }
        if let Ok(dev) = ca::Device::with_uid(&cf::String::from_str(&self.output_uid)) {
            let alive = dev
                .bool_prop(&ca::PropSelector::DEVICE_IS_ALIVE.global_addr())
                .unwrap_or(true);
            if dev.0 .0 == 0 || !alive {
                return Some("output device disappeared".into());
            }
        }
        if let Ok(rate) = self.device.nominal_sample_rate() {
            let rate = rate as u32;
            if rate > 0 && rate != self.rate {
                return Some(format!("sample rate changed {} -> {} Hz", self.rate, rate));
            }
        }
        None
    }
}

/// Linear interpolation from the device rate to the stream's fixed rate.
/// Only used after a rate change; speech survives it fine for transcription.
#[derive(Default)]
struct LinearResampler {
    pos: f64,
    prev: Option<f32>,
}

impl LinearResampler {
    fn reset(&mut self) {
        *self = Self::default();
    }

    fn process(&mut self, input: &[f32], from: u32, to: u32, out: &mut Vec<f32>) {
        if input.is_empty() {
            return;
        }
        let step = from as f64 / to as f64;
        let mut buf = Vec::with_capacity(input.len() + 1);
        if let Some(p) = self.prev {
            buf.push(p);
        }
        buf.extend_from_slice(input);
        let last = (buf.len() - 1) as f64;
        while self.pos < last {
            let i = self.pos as usize;
            let frac = (self.pos - i as f64) as f32;
            out.push(buf[i] * (1.0 - frac) + buf[i + 1] * frac);
            self.pos += step;
        }
        self.pos -= last;
        self.prev = buf.last().copied();
    }
}

/// Runs on its own thread for the lifetime of the stream
fn supervise(
    mut session: Option<TapSession>,
    output_rate: u32,
    tx: mpsc::UnboundedSender<Vec<f32>>,
    stop: Arc<AtomicBool>,
) {
    let mut scratch = vec![0f32; 8192];
    let mut resampler = LinearResampler::default();
    let mut last_check = Instant::now();
    let mut last_callbacks = 0u64;
    let mut last_overflows = 0u64;
    let mut last_nonzero = Instant::now();
    let mut playing_since: Option<Instant> = None;
    let mut reported_silence = false;
    let mut retry_at = Instant::now();

    while !stop.load(Ordering::Acquire) {
        if let Some(s) = session.as_mut() {
            loop {
                let n = s.consumer.pop_slice(&mut scratch);
                if n == 0 {
                    break;
                }
                let chunk = &scratch[..n];
                if chunk.iter().any(|v| v.abs() > 1e-7) {
                    last_nonzero = Instant::now();
                }
                let out = if s.rate == output_rate {
                    chunk.to_vec()
                } else {
                    let mut out = Vec::with_capacity(n * output_rate as usize / s.rate.max(1) as usize + 2);
                    resampler.process(chunk, s.rate, output_rate, &mut out);
                    out
                };
                if tx.unbounded_send(out).is_err() {
                    return; // stream dropped
                }
            }
        }

        if last_check.elapsed() >= Duration::from_millis(500) {
            last_check = Instant::now();
            let mut rebuild = None;
            if let Some(s) = session.as_ref() {
                let overflows = s.overflows.load(Ordering::Relaxed);
                if overflows > last_overflows {
                    warn!("CoreAudio: system audio buffer overflowed {} time(s)", overflows - last_overflows);
                    last_overflows = overflows;
                }
                let callbacks = s.callbacks.load(Ordering::Relaxed);
                let io_running = callbacks != last_callbacks;
                last_callbacks = callbacks;

                // Other apps playing but nothing but zeros (or no IO at all)
                // from the tap: macOS is most likely withholding system audio.
                if other_process_is_playing() {
                    let since = *playing_since.get_or_insert_with(Instant::now);
                    if !reported_silence
                        && since.elapsed() >= SILENCE_WHILE_PLAYING
                        && last_nonzero < since
                    {
                        reported_silence = true;
                        warn!(
                            "CoreAudio: other apps are playing but the tap is silent (IO running: {}); system audio permission is probably denied",
                            io_running
                        );
                        crate::audio::permissions::notify_system_audio_silent();
                    }
                } else {
                    playing_since = None;
                }

                rebuild = s.needs_rebuild();
            }
            if let Some(reason) = rebuild {
                info!("CoreAudio: rebuilding system audio tap ({})", reason);
                session = None; // tear down before building the next one
                resampler.reset();
                retry_at = Instant::now();
            }
        }

        if session.is_none() && Instant::now() >= retry_at {
            match TapSession::start() {
                Ok(s) => {
                    last_callbacks = 0;
                    last_overflows = 0;
                    session = Some(s);
                }
                Err(e) => {
                    warn!("CoreAudio: could not restart system audio tap, retrying: {}", e);
                    retry_at = Instant::now() + Duration::from_secs(1);
                }
            }
        }

        std::thread::sleep(Duration::from_millis(10));
    }
    info!("CoreAudio: system audio capture stopped");
}

impl CoreAudioCapture {
    /// Create a new Core Audio capture for system audio
    pub fn new() -> Result<Self> {
        Ok(Self)
    }

    /// Start the tap on its supervisor thread and return the sample stream.
    /// Fails if the first tap cannot be created.
    pub fn stream(self) -> Result<CoreAudioStream> {
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<u32>>();
        let (tx, rx) = mpsc::unbounded::<Vec<f32>>();
        let stop = Arc::new(AtomicBool::new(false));
        let stop_thread = stop.clone();

        std::thread::Builder::new()
            .name("notesify-system-audio".into())
            .spawn(move || match TapSession::start() {
                Ok(session) => {
                    let rate = session.rate;
                    let _ = ready_tx.send(Ok(rate));
                    supervise(Some(session), rate, tx, stop_thread);
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                }
            })
            .map_err(|e| anyhow::anyhow!("Failed to start system audio thread: {}", e))?;

        let sample_rate = ready_rx
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| anyhow::anyhow!("System audio tap did not start in time"))?
            .map_err(|e| {
                error!("CoreAudio: {}", e);
                e
            })?;

        Ok(CoreAudioStream {
            rx,
            chunk: Vec::new(),
            pos: 0,
            sample_rate,
            stop,
        })
    }
}

impl CoreAudioStream {
    /// Sample rate of every sample this stream yields (fixed for its lifetime)
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }
}

impl Stream for CoreAudioStream {
    type Item = f32;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        loop {
            if self.pos < self.chunk.len() {
                let sample = self.chunk[self.pos];
                self.pos += 1;
                return Poll::Ready(Some(sample));
            }
            match Pin::new(&mut self.rx).poll_next(cx) {
                Poll::Ready(Some(chunk)) => {
                    self.chunk = chunk;
                    self.pos = 0;
                }
                Poll::Ready(None) => return Poll::Ready(None),
                Poll::Pending => return Poll::Pending,
            }
        }
    }
}

impl Drop for CoreAudioStream {
    fn drop(&mut self) {
        // The supervisor tears the tap down within ~10 ms
        self.stop.store(true, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
        use super::*;

        #[test]
    fn resampler_keeps_duration() {
        let mut r = LinearResampler::default();
        let mut out = Vec::new();
        // 1 s of 24 kHz in 10 ms chunks -> about 1 s of 48 kHz
        for _ in 0..100 {
            r.process(&[0.5; 240], 24_000, 48_000, &mut out);
        }
        assert!((out.len() as i64 - 48_000).abs() <= 2, "{}", out.len());
        assert!(out.iter().all(|v| (*v - 0.5).abs() < 1e-6));
    }

    #[tokio::test]
        #[ignore] // Only run manually as it requires audio hardware
    async fn test_core_audio_capture() {
        use futures_util::StreamExt;

        let capture = CoreAudioCapture::new().expect("Failed to create capture");
        let mut stream = capture.stream().expect("Failed to create stream");

        info!("Stream sample rate: {} Hz", stream.sample_rate());

        let mut sample_count = 0;
        while sample_count < 48000 {
            if let Some(_sample) = stream.next().await {
                sample_count += 1;
            }
        }
        assert!(sample_count >= 48000);
    }
}
