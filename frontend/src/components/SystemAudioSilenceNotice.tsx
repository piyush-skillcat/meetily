'use client';

import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';

/**
 * macOS gives a recording that lacks system-audio permission silence instead
 * of an error. The backend notices other apps playing while the tap stays
 * silent and emits `system-audio-silent`; this explains it once per recording.
 * Never emitted on other platforms.
 */
export function SystemAudioSilenceNotice() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen('system-audio-silent', () => {
      toast.warning("The other side of the call isn't being recorded", {
        id: 'system-audio-silent',
        duration: Infinity,
        description:
          'Other apps are playing sound, but macOS is giving Notesify silence. Allow Notesify under Screen & System Audio Recording, then start the recording again.',
        action: {
          label: 'Open Settings',
          onClick: () => {
            invoke('open_system_settings', { preferencePane: 'Privacy_ScreenCapture' }).catch((err) =>
              console.error('Failed to open System Settings:', err),
            );
          },
        },
      });
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err) => console.error('Failed to listen for system-audio-silent:', err));
    return () => unlisten?.();
  }, []);

  return null;
}
