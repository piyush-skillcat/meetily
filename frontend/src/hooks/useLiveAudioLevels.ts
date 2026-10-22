import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface LiveAudioLevels {
  /** 0..1 on a dB scale (-60 dBFS → 0, 0 dBFS → 1). */
  mic: number;
  system: number;
}

const SILENT: LiveAudioLevels = { mic: 0, system: 0 };

/**
 * Polls the pipeline's live input levels (audio/live_levels.rs) while `active`.
 * Each poll waits for the previous one, so a slow backend never queues calls.
 */
export function useLiveAudioLevels(active: boolean, intervalMs = 90): LiveAudioLevels {
  const [levels, setLevels] = useState<LiveAudioLevels>(SILENT);

  useEffect(() => {
    if (!active) {
      setLevels(SILENT);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const next = await invoke<LiveAudioLevels | null>('get_live_audio_levels');
        if (!cancelled) setLevels(next ?? SILENT);
      } catch {
        if (!cancelled) setLevels(SILENT);
      }
      if (!cancelled) timer = setTimeout(tick, intervalMs);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, intervalMs]);

  return levels;
}

/**
 * Elapsed recording time in seconds: counts only while recording and not
 * paused, and restarts from zero for each new recording.
 */
export function useRecordingTimer(isRecording: boolean, isPaused: boolean): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!isRecording) setSeconds(0);
  }, [isRecording]);

  useEffect(() => {
    if (!isRecording || isPaused) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [isRecording, isPaused]);

  return seconds;
}

export function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}
