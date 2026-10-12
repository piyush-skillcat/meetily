"use client";

/**
 * Shows a "Looks like a meeting started — start recording?" toast when the
 * backend notices another app opening the microphone (Linux, PipeWire).
 */

import { useEffect, useRef } from 'react';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useRecordingState } from '@/contexts/RecordingStateContext';

interface MeetingDetectedEvent {
  app: string;
  media?: string | null;
}

const PREF_KEY = 'notesify:meeting-detection';

export function isMeetingDetectionEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setMeetingDetectionEnabled(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
}

export function MeetingDetectionProvider() {
  const { handleRecordingToggle } = useSidebar();
  const { isRecording } = useRecordingState();
  const isRecordingRef = useRef(isRecording);
  isRecordingRef.current = isRecording;
  const toggleRef = useRef(handleRecordingToggle);
  toggleRef.current = handleRecordingToggle;

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | null = null;
    listen<MeetingDetectedEvent>('meeting-detected', (event) => {
      if (isRecordingRef.current || !isMeetingDetectionEnabled()) return;
      const app = event.payload.app || 'An app';
      toast(`${app} is using your microphone`, {
        id: 'meeting-detected',
        description: 'Looks like a meeting started. Start recording and taking notes?',
        duration: 30000,
        action: {
          label: 'Start recording',
          onClick: () => toggleRef.current(),
        },
        cancel: {
          label: 'Not now',
          onClick: () => { },
        },
      });
    }).then((un) => {
      if (disposed) un();
      else unlisten = un;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return null;
}

export default MeetingDetectionProvider;
