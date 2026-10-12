"use client";

/**
 * LiveNotesPanel — the Granola-style scratchpad shown on the recording screen.
 * Notes are kept as a local draft while recording and attached to the meeting
 * once it is saved (see useRecordingStop).
 */

import { useCallback, useMemo, useState } from 'react';
import { PenLine, Eraser } from 'lucide-react';
import dynamic from 'next/dynamic';

// BlockNote touches `document` at construction time; keep it client-only for the static export.
const NotesPad = dynamic(() => import('@/components/Notes/NotesPad').then(m => m.NotesPad), { ssr: false });
import { notesDraft } from '@/lib/notesDraft';
import { Button } from '@/components/ui/button';

interface LiveNotesPanelProps {
  isRecording: boolean;
}

export function LiveNotesPanel({ isRecording }: LiveNotesPanelProps) {
  const [draftVersion, setDraftVersion] = useState(0);
  const draft = useMemo(() => notesDraft.readLive(), [draftVersion]);
  const [hasContent, setHasContent] = useState(() => !!(draft?.markdown?.trim()));

  const handleChange = useCallback((markdown: string, json: string) => {
    notesDraft.writeLive(markdown, json);
    setHasContent(markdown.trim().length > 0);
  }, []);

  const clear = () => {
    if (hasContent && !confirm('Clear your notes?')) return;
    notesDraft.clearLive();
    setHasContent(false);
    setDraftVersion((v) => v + 1);
  };

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-white overflow-hidden">
      <div className="sticky top-0 z-10 bg-white px-6 pt-4 pb-2 border-b border-gray-100 flex items-center gap-2">
        <PenLine size={16} className="text-gray-500" />
        <span className="text-sm font-medium text-gray-800">My notes</span>
        <span className="text-xs text-gray-400 hidden md:inline">
          {isRecording
            ? '— jot down what matters; Notesify fills in the details after the meeting'
            : '— type here before or during the meeting'}
        </span>
        <div className="flex-1" />
        {hasContent && (
          <Button variant="ghost" size="sm" onClick={clear} title="Clear notes">
            <Eraser size={14} />
          </Button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto pb-32">
        <div className="max-w-3xl px-2 pt-2">
          <NotesPad
            key={`live-${draftVersion}`}
            initialMarkdown={draft?.markdown ?? ''}
            initialJson={draft?.json}
            onChange={handleChange}
            debounceMs={400}
          />
        </div>
      </div>
    </div>
  );
}
