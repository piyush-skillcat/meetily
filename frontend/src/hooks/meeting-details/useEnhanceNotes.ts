import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import type { EnhanceStreamEvent } from '@/types';

export type EnhanceStatus = 'idle' | 'streaming' | 'completed' | 'error';

interface Options {
  meetingId: string;
  onCompleted: (markdown: string, title?: string) => void;
}

/**
 * Drives `api_enhance_notes` and consumes the `enhance-stream` events so the
 * UI can show the document appearing token by token.
 */
export function useEnhanceNotes({ meetingId, onCompleted }: Options) {
  const [status, setStatus] = useState<EnhanceStatus>('idle');
  const [streamText, setStreamText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;
  const activeRef = useRef(false);

  // Single long-lived listener; filters by meeting id.
  useEffect(() => {
    let disposed = false;
    listen<EnhanceStreamEvent>('enhance-stream', (event) => {
      const p = event.payload;
      if (p.meeting_id !== meetingId) return;
      if (!p.done) {
        if (!activeRef.current) {
          // A generation started elsewhere (e.g. auto-enhance after recording); attach.
          activeRef.current = true;
          setStatus('streaming');
          setStreamText('');
        }
        if (p.delta) setStreamText((t) => t + p.delta);
        return;
      }
      activeRef.current = false;
      if (p.error) {
        const cancelled = p.error.toLowerCase().includes('cancel');
        setStatus(cancelled ? 'idle' : 'error');
        setError(cancelled ? null : p.error);
        if (!cancelled) {
          toast.error('Could not enhance notes', { description: p.error });
        }
        return;
      }
      setStatus('completed');
      setError(null);
      onCompletedRef.current(p.markdown ?? '', p.title);
    }).then((un) => {
      if (disposed) un();
      else unlistenRef.current = un;
    });
    return () => {
      disposed = true;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, [meetingId]);

  const start = useCallback(
    async (args: {
      notesMarkdown: string;
      templateId?: string | null;
      customPrompt?: string;
      provider?: string;
      modelName?: string;
      summaryLanguage?: string | null;
    }) => {
      setStatus('streaming');
      setStreamText('');
      setError(null);
      activeRef.current = true;
      try {
        await invoke('api_enhance_notes', {
          meetingId,
          notesMarkdown: args.notesMarkdown,
          templateId: args.templateId ?? null,
          provider: args.provider ?? null,
          modelName: args.modelName ?? null,
          customPrompt: args.customPrompt ?? null,
          summaryLanguage: args.summaryLanguage ?? null,
        });
      } catch (e) {
        activeRef.current = false;
        const msg = e instanceof Error ? e.message : String(e);
        setStatus('error');
        setError(msg);
        toast.error('Could not enhance notes', { description: msg });
      }
    },
    [meetingId]
  );

  const stop = useCallback(async () => {
    try {
      await invoke('api_cancel_summary', { meetingId });
    } catch (e) {
      console.warn('cancel failed', e);
    }
    activeRef.current = false;
    setStatus('idle');
  }, [meetingId]);

  return { status, streamText, error, start, stop, isStreaming: status === 'streaming' };
}
