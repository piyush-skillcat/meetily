"use client";

/**
 * AskPanel — "Ask about this meeting" chat, grounded in transcript + notes.
 * Streams replies via the `chat-stream` Tauri event.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { Send, Square, Trash2, Copy, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ChatMessageRow, ChatStreamEvent } from '@/types';

interface AskPanelProps {
  meetingId: string;
  /** Provider/model override; falls back to saved config on the backend */
  provider?: string;
  modelName?: string;
}

const SUGGESTIONS = [
  'Summarize this in 3 bullets',
  'List every action item with its owner',
  'What did they ask me to do?',
  'Draft a follow-up email',
  'What decisions were made, and why?',
  'What questions were left open?',
];

export function AskPanel({ meetingId, provider, modelName }: AskPanelProps) {
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<{ requestId: string; text: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load history
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    invoke<ChatMessageRow[]>('api_get_meeting_chat', { meetingId })
      .then((rows) => !cancelled && setMessages(rows))
      .catch((e) => console.warn('Failed to load chat', e))
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  // Stream listener
  useEffect(() => {
    let disposed = false;
    listen<ChatStreamEvent>('chat-stream', (event) => {
      const p = event.payload;
      if (p.meeting_id !== meetingId) return;
      setPending((cur) => {
        if (!cur || cur.requestId !== p.request_id) return cur;
        if (!p.done) return { ...cur, text: cur.text + (p.delta ?? '') };
        return cur;
      });
      if (p.done) {
        if (p.error) {
          if (!p.error.toLowerCase().includes('cancel')) {
            toast.error('Ask failed', { description: p.error });
          }
        } else if (p.message) {
          const saved = p.message;
          setMessages((m) => (m.some((x) => x.id === saved.id) ? m : [...m, saved]));
        }
        setPending(null);
      }
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

  // Auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending?.text]);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || pending) return;
      setInput('');
      // Optimistic user bubble
      const optimistic: ChatMessageRow = {
        id: `local-${Date.now()}`,
        meeting_id: meetingId,
        role: 'user',
        content: message,
        created_at: new Date().toISOString(),
      };
      setMessages((m) => [...m, optimistic]);
      try {
        const requestId = await invoke<string>('api_send_meeting_chat', {
          meetingId,
          message,
          provider: provider ?? null,
          modelName: modelName ?? null,
        });
        setPending({ requestId, text: '' });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error('Could not send', { description: msg });
        setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      }
    },
    [meetingId, pending, provider, modelName]
  );

  const stop = useCallback(async () => {
    if (!pending) return;
    try {
      await invoke('api_cancel_meeting_chat', { requestId: pending.requestId });
    } catch (e) {
      console.warn(e);
    }
    setPending(null);
  }, [pending]);

  const clear = useCallback(async () => {
    try {
      await invoke('api_clear_meeting_chat', { meetingId });
      setMessages([]);
    } catch (e) {
      toast.error('Could not clear chat');
    }
  }, [meetingId]);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success('Copied'));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {isLoading ? (
          <div className="text-sm text-gray-400">Loading…</div>
        ) : messages.length === 0 && !pending ? (
          <div className="max-w-xl mx-auto mt-8 text-center">
            <Sparkles className="mx-auto text-blue-400 mb-3" size={28} />
            <h3 className="text-lg font-semibold text-gray-800">Ask anything about this meeting</h3>
            <p className="text-sm text-gray-500 mt-1 mb-5">
              Answers come from the transcript and your notes. Try one of these:
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-sm px-3 py-1.5 rounded-full border border-gray-200 bg-white hover:bg-blue-50 hover:border-blue-200 text-gray-700 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m) => (
              <MessageBubble key={m.id} role={m.role} content={m.content} onCopy={() => copy(m.content)} />
            ))}
            {pending && (
              <MessageBubble role="assistant" content={pending.text || '…'} streaming onCopy={() => copy(pending.text)} />
            )}
          </>
        )}
      </div>

      <div className="border-t border-gray-200 bg-white px-4 py-3">
        {messages.length > 0 && !pending && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {SUGGESTIONS.slice(0, 3).map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="text-xs px-2.5 py-1 rounded-full border border-gray-200 bg-gray-50 hover:bg-blue-50 hover:border-blue-200 text-gray-600"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about this meeting…  (Enter to send, Shift+Enter for a new line)"
            rows={2}
            className="flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
          {pending ? (
            <Button variant="outline" size="sm" onClick={stop} title="Stop">
              <Square size={16} fill="currentColor" />
            </Button>
          ) : (
            <Button size="sm" onClick={() => send(input)} disabled={!input.trim()} title="Send">
              <Send size={16} />
            </Button>
          )}
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clear} title="Clear conversation" disabled={!!pending}>
              <Trash2 size={16} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  role,
  content,
  streaming = false,
  onCopy,
}: {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  onCopy: () => void;
}) {
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`group relative max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-gray-100 text-gray-900 rounded-bl-sm'
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : (
          <div className="chat-md">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            {streaming && <span className="inline-block w-1.5 h-4 bg-gray-400 animate-pulse align-middle ml-0.5" />}
          </div>
        )}
        {!streaming && (
          <button
            onClick={onCopy}
            className={`absolute -top-2 ${isUser ? '-left-2' : '-right-2'} hidden group-hover:flex items-center justify-center w-6 h-6 rounded-full bg-white border border-gray-200 text-gray-500 shadow-sm`}
            title="Copy"
          >
            <Copy size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

export default AskPanel;
