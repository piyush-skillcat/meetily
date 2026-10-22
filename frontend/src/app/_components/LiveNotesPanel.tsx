"use client";

/**
 * LiveNotesPanel — the Granola-style scratchpad shown on the recording screen.
 * Notes are kept as a local draft while recording and attached to the meeting
 * once it is saved (see useRecordingStop).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';
import dynamic from 'next/dynamic';
import { invoke } from '@tauri-apps/api/core';

// BlockNote touches `document` at construction time; keep it client-only for the static export.
const NotesPad = dynamic(() => import('@/components/Notes/NotesPad').then(m => m.NotesPad), { ssr: false });
import { notesDraft } from '@/lib/notesDraft';
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
    <div className="flex-1 min-h-0 overflow-y-auto bg-white">
      <div className="mx-auto w-full max-w-[720px] px-10 pt-14 pb-40">
        <MeetingHeader isRecording={isRecording} people={people} onPeopleChange={handlePeopleChange} />
        <div className="group/notes relative mt-6">
          {hasContent && (
            <button
              onClick={clear}
              title="Clear notes"
              aria-label="Clear notes"
              className="absolute -right-8 top-1 h-7 w-7 flex items-center justify-center rounded-md text-gray-400 opacity-0 group-hover/notes:opacity-100 hover:text-gray-900 hover:bg-gray-100 transition-opacity"
            >
              <Eraser size={14} />
            </button>
          )}
          <div className="-mx-3">
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
    </div>
  );
}
