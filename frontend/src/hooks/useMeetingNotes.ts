import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { MeetingNotes } from '@/types';

/**
 * Loads and saves the user's own notes for a saved meeting (meeting_notes table).
 */
export function useMeetingNotes(meetingId: string | null | undefined) {
  const [notes, setNotes] = useState<MeetingNotes | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const latestRef = useRef<{ markdown: string; json?: string }>({ markdown: '' });

  useEffect(() => {
    let cancelled = false;
    if (!meetingId || meetingId === 'intro-call') {
      setNotes(null);
      return;
    }
    setIsLoading(true);
    invoke<MeetingNotes | null>('api_get_meeting_notes', { meetingId })
      .then((n) => {
        if (cancelled) return;
        setNotes(n);
        latestRef.current = { markdown: n?.notes_markdown ?? '', json: n?.notes_json ?? undefined };
      })
      .catch((e) => console.warn('Failed to load notes', e))
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  const save = useCallback(
    async (markdown: string, json?: string) => {
      if (!meetingId) return;
      latestRef.current = { markdown, json };
      setIsSaving(true);
      try {
        await invoke('api_save_meeting_notes', { meetingId, notesMarkdown: markdown, notesJson: json ?? null });
        setNotes((prev) => ({
          meeting_id: meetingId,
          notes_markdown: markdown,
          notes_json: json ?? null,
          created_at: prev?.created_at ?? new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));
      } catch (e) {
        console.error('Failed to save notes', e);
      } finally {
        setIsSaving(false);
      }
    },
    [meetingId]
  );

  return {
    notes,
    notesMarkdown: notes?.notes_markdown ?? '',
    notesJson: notes?.notes_json ?? null,
    /** Latest content including unsaved edits */
    latestMarkdown: () => latestRef.current.markdown,
    isLoading,
    isSaving,
    save,
  };
}
