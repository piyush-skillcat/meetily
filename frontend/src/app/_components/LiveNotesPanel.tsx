"use client";

/**
 * LiveNotesPanel — the Granola-style scratchpad shown on the recording screen.
 * Notes are kept as a local draft while recording and attached to the meeting
 * once it is saved (see useRecordingStop).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PenLine, Eraser, Users } from 'lucide-react';
import dynamic from 'next/dynamic';
import { invoke } from '@tauri-apps/api/core';

// BlockNote touches `document` at construction time; keep it client-only for the static export.
const NotesPad = dynamic(() => import('@/components/Notes/NotesPad').then(m => m.NotesPad), { ssr: false });
import { notesDraft } from '@/lib/notesDraft';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Typing pauses this long before the transcription vocabulary is refreshed. */
const KEYTERM_SYNC_DELAY_MS = 1500;

interface LiveNotesPanelProps {
  isRecording: boolean;
}

export function LiveNotesPanel({ isRecording }: LiveNotesPanelProps) {
  const [draftVersion, setDraftVersion] = useState(0);
  const draft = useMemo(() => notesDraft.readLive(), [draftVersion]);
  const [hasContent, setHasContent] = useState(() => !!(draft?.markdown?.trim()));
  const [people, setPeople] = useState(() => notesDraft.readPeople());

  // Names in "People & topic" and in the notes become keyterms for live
  // transcription (see audio/transcription/keyterms.rs).
  const peopleRef = useRef(people);
  const notesRef = useRef(draft?.markdown ?? '');
  const syncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const syncKeyterms = useCallback((delayMs = KEYTERM_SYNC_DELAY_MS) => {
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      invoke('api_set_meeting_keyterms', {
        peopleAndTopic: peopleRef.current,
        notesMarkdown: notesRef.current,
      }).catch((e) => console.warn('Failed to update transcription keyterms', e));
    }, delayMs);
  }, []);

  // On mount and when a recording starts or stops, resync from the stored
  // draft so a new meeting never inherits the previous one's terms.
  useEffect(() => {
    peopleRef.current = notesDraft.readPeople();
    setPeople(peopleRef.current);
    notesRef.current = notesDraft.readLive()?.markdown ?? '';
    syncKeyterms(0);
  }, [isRecording, syncKeyterms]);

  useEffect(() => () => clearTimeout(syncTimer.current), []);

  const handleChange = useCallback((markdown: string, json: string) => {
    notesDraft.writeLive(markdown, json);
    setHasContent(markdown.trim().length > 0);
    notesRef.current = markdown;
    syncKeyterms();
  }, [syncKeyterms]);

  const handlePeopleChange = (value: string) => {
    setPeople(value);
    notesDraft.writePeople(value);
    peopleRef.current = value;
    syncKeyterms();
  };

  const clear = () => {
    if (hasContent && !confirm('Clear your notes?')) return;
    notesDraft.clearLiveNotes();
    setHasContent(false);
    setDraftVersion((v) => v + 1);
    notesRef.current = '';
    syncKeyterms(0);
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
      <div className="px-6 py-2 border-b border-gray-100 flex items-center gap-2">
        <Users size={14} className="text-gray-400 shrink-0" />
        <Input
          value={people}
          onChange={(e) => handlePeopleChange(e.target.value)}
          placeholder="People & topic: Priya Sharma, Acme Corp, SOC2 audit"
          title="Names, companies and terms in this meeting, comma-separated. Live transcription listens for them; names you type in your notes are picked up too."
          className="h-8 text-sm border-0 shadow-none focus-visible:ring-0 px-1"
        />
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
