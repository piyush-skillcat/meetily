"use client";

/**
 * MeetingHeader — top of the recording screen: an editable meeting title and
 * one row of meeting facts (when, how the notes will be written, who's in it).
 *
 * The title is kept as a draft until the meeting is saved, so it can be set
 * before recording starts. A typed title wins over the generated
 * "Meeting dd_mm_yy_…" name, and Enhance only replaces generated titles.
 */

import { useEffect, useState } from 'react';
import { CalendarDays, LayoutTemplate, Users } from 'lucide-react';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useTemplates } from '@/hooks/meeting-details/useTemplates';
import { notesDraft } from '@/lib/notesDraft';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface MeetingHeaderProps {
  isRecording: boolean;
  people: string;
  onPeopleChange: (value: string) => void;
}

function formatWhen(startedAt: Date | null): string {
  if (startedAt) {
    return `Started ${startedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  return `Today · ${new Date().toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}`;
}

const chip = 'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-gray-200 bg-gray-50 text-xs text-gray-600';

export function MeetingHeader({ isRecording, people, onPeopleChange }: MeetingHeaderProps) {
  const { setMeetingTitle } = useTranscripts();
  const { availableTemplates, selectedTemplate, handleTemplateSelection } = useTemplates();
  const [title, setTitle] = useState(() => notesDraft.readTitle());
  const [startedAt, setStartedAt] = useState<Date | null>(null);

  // Track when this recording started; re-read the draft when a recording
  // starts or ends (the draft is cleared once the meeting is saved).
  useEffect(() => {
    setStartedAt(isRecording ? new Date() : null);
    setTitle(notesDraft.readTitle());
  }, [isRecording]);

  // Push a typed title into the live recording so it is what gets saved.
  useEffect(() => {
    if (isRecording && title.trim()) setMeetingTitle(title.trim());
  }, [isRecording, title, setMeetingTitle]);

  const handleTitleChange = (value: string) => {
    setTitle(value);
    notesDraft.writeTitle(value);
  };

  const templateName = availableTemplates.find((t) => t.id === selectedTemplate)?.name;

  return (
    <div className="px-8 pt-6 pb-3 border-b border-gray-100 bg-white">
      <input
        value={title}
        onChange={(e) => handleTitleChange(e.target.value)}
        placeholder="Untitled meeting"
        aria-label="Meeting title"
        className="w-full bg-transparent text-2xl font-semibold text-gray-900 placeholder:text-gray-300 outline-none"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={chip} title={isRecording ? 'Recording in progress' : 'Not recording yet'}>
          <CalendarDays size={13} className="text-gray-400" />
          {formatWhen(startedAt)}
        </span>

        {availableTemplates.length > 0 && (
          <Select
            value={selectedTemplate}
            onValueChange={(id) => {
              const t = availableTemplates.find((x) => x.id === id);
              if (t) handleTemplateSelection(t.id, t.name);
            }}
          >
            <SelectTrigger
              className={`${chip} w-auto gap-1.5 focus:ring-1 focus:ring-blue-500`}
              title="How Notesify writes this meeting's notes"
            >
              <LayoutTemplate size={13} className="text-gray-400" />
              <SelectValue placeholder="Template">{templateName ?? 'Template'}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {availableTemplates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  <span className="font-medium">{t.name}</span>
                  {t.description && <span className="block text-xs text-gray-500">{t.description}</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className={`${chip} flex-1 min-w-[220px] max-w-md`}>
          <Users size={13} className="text-gray-400 shrink-0" />
          <Input
            value={people}
            onChange={(e) => onPeopleChange(e.target.value)}
            placeholder="Add people & topic: Priya Sharma, Acme Corp"
            aria-label="People and topic"
            title="Names, companies and terms in this meeting, comma-separated. Live transcription listens for them; names you type in your notes are picked up too."
            className="h-6 text-xs border-0 shadow-none bg-transparent focus-visible:ring-0 px-0"
          />
        </div>
      </div>
    </div>
  );
}
