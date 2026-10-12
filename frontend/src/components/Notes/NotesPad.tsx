"use client";

/**
 * NotesPad — the "My notes" editor (Granola-style scratchpad).
 *
 * A BlockNote editor that:
 *  - loads from markdown (or a BlockNote JSON document when available),
 *  - reports changes (debounced) as both markdown and JSON,
 *  - never re-initialises while the user is typing.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import type { Block, PartialBlock } from '@blocknote/core';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import { blocksToMarkdownSafely } from '@/lib/blocknote-markdown';
import { useTheme } from '@/contexts/ThemeContext';
import '@blocknote/shadcn/style.css';
import '@blocknote/core/fonts/inter.css';

export interface NotesPadProps {
  /** Initial markdown content */
  initialMarkdown?: string;
  /** Initial BlockNote JSON (string). Preferred over markdown when present. */
  initialJson?: string | null;
  /** Called (debounced) when the content changes */
  onChange?: (markdown: string, json: string) => void;
  debounceMs?: number;
  editable?: boolean;
  placeholder?: string;
  /** Re-mount key: change to force reload of initial content */
  contentKey?: string;
  className?: string;
}

function parseJsonBlocks(json?: string | null): PartialBlock[] | undefined {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as PartialBlock[]) : undefined;
  } catch {
    return undefined;
  }
}

export function NotesPad({
  initialMarkdown = '',
  initialJson,
  onChange,
  debounceMs = 600,
  editable = true,
  className = '',
}: NotesPadProps) {
  const { resolved: theme } = useTheme();
  const editor = useCreateBlockNote({
    initialContent: parseJsonBlocks(initialJson),
  });
  const [loaded, setLoaded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Load markdown when no JSON was provided
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!parseJsonBlocks(initialJson) && initialMarkdown.trim()) {
        try {
          const blocks = await editor.tryParseMarkdownToBlocks(initialMarkdown);
          if (!cancelled) editor.replaceBlocks(editor.document, blocks);
        } catch (e) {
          console.warn('NotesPad: failed to parse markdown', e);
        }
      }
      if (!cancelled) setTimeout(() => setLoaded(true), 50);
    };
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const emitChange = useCallback(async (blocks: Block[]) => {
    const md = await blocksToMarkdownSafely(editor, blocks, { source: 'NotesPad' });
    onChangeRef.current?.(md.markdown ?? '', JSON.stringify(blocks));
  }, [editor]);

  const handleChange = useCallback(() => {
    if (!loaded) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    const snapshot = editor.document;
    timerRef.current = setTimeout(() => emitChange(snapshot), debounceMs);
  }, [loaded, editor, emitChange, debounceMs]);

  // Flush pending change on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        void emitChange(editor.document);
      }
    };
  }, [editor, emitChange]);

  return (
    <div className={`notes-pad ${className}`}>
      <BlockNoteView editor={editor} editable={editable} theme={theme} onChange={handleChange} />
    </div>
  );
}

export default NotesPad;
