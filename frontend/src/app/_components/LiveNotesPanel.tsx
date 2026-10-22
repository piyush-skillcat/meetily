"use client";

/**
 * LiveNotesPanel — the Granola-style scratchpad shown on the recording screen.
 * Notes are kept as a local draft while recording and attached to the meeting
 * once it is saved (see useRecordingStop).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PenLine, Eraser } from 'lucide-react';
import dynamic from 'next/dynamic';
import { invoke } from '@tauri-apps/api/core';

// BlockNote touches `document` at construction time; keep it client-only for the static export.
const NotesPad = dynamic(() => import('@/components/Notes/NotesPad').then(m => m.NotesPad), { ssr: false });
import { notesDraft } from '@/lib/notesDraft';
import { Button } from '@/components/ui/button';
import { MeetingHeader } from './MeetingHeader';

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
      <MeetingHeader isRecording={isRecording} people={people} onPeopleChange={handlePeopleChange} />
      <div className="px-8 pt-3 flex items-center gap-2">
        <PenLine size={14} className="text-gray-400" />
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">My notes</span>
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
        <div className="max-w-3xl px-4 pt-1">
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
