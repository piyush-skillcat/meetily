"use client";

import { Summary, SummaryResponse, Transcript } from '@/types';
import { BlockNoteSummaryView, BlockNoteSummaryViewRef } from '@/components/AISummary/BlockNoteSummaryView';
import { ModelConfig } from '@/components/ModelSettingsModal';
import { SummaryGeneratorButtonGroup, metaChip } from './SummaryGeneratorButtonGroup';
import { SummaryUpdaterButtonGroup } from './SummaryUpdaterButtonGroup';
import dynamic from 'next/dynamic';
const NotesPad = dynamic(() => import('@/components/Notes/NotesPad').then(m => m.NotesPad), { ssr: false });
const AskPanelLazy = dynamic(() => import('./AskPanel').then(m => m.AskPanel), { ssr: false });
import Analytics from '@/lib/analytics';
import { useEffect, useRef, useState, RefObject, ReactNode } from 'react';
import { toast } from 'sonner';
import { Languages, ChevronDown, Sparkles, Loader2, CalendarDays, Square } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { LanguagePickerPopover } from '@/components/LanguagePickerPopover';
import { useRecentLanguages } from '@/hooks/useRecentLanguages';
import { labelForCode } from '@/lib/summary-languages';
import {
  readMeetingSummaryLanguage,
  saveMeetingSummaryLanguage,
  SummaryLanguageStorage,
} from '@/lib/summary-language-preferences';

export type SummaryTab = 'enhanced' | 'notes' | 'ask';

interface SummaryPanelProps {
  meeting: {
    id: string;
    title: string;
    created_at: string;
  };
  meetingTitle: string;
  onTitleChange: (title: string) => void;
  isEditingTitle: boolean;
  onStartEditTitle: () => void;
  onFinishEditTitle: () => void;
  isTitleDirty: boolean;
  summaryRef: RefObject<BlockNoteSummaryViewRef>;
  isSaving: boolean;
  onSaveAll: () => Promise<void>;
  onCopySummary: () => Promise<void>;
  onOpenFolder: () => Promise<void>;
  aiSummary: Summary | null;
  summaryStatus: 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error';
  transcripts: Transcript[];
  modelConfig: ModelConfig;
  setModelConfig: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;
  onSaveModelConfig: (config?: ModelConfig) => Promise<void>;
  onGenerateSummary: (customPrompt: string) => Promise<void>;
  onStopGeneration: () => void;
  customPrompt: string;
  summaryResponse: SummaryResponse | null;
  onSaveSummary: (summary: Summary | { markdown?: string; summary_json?: any[] }) => Promise<void>;
  onSummaryChange: (summary: Summary) => void;
  onDirtyChange: (isDirty: boolean) => void;
  summaryError: string | null;
  onRegenerateSummary: () => Promise<void>;
  getSummaryStatusMessage: (status: 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error') => string;
  availableTemplates: Array<{ id: string, name: string, description: string }>;
  selectedTemplate: string;
  onTemplateSelect: (templateId: string, templateName: string) => void;
  onRefreshTemplates?: () => void;
  isModelConfigLoading?: boolean;
  onOpenModelSettings?: (openFn: () => void) => void;

  // Granola-style additions
  /** Text streamed from the model while enhancing (shown live) */
  streamText?: string;
  /** The user's own notes (markdown) */
  notesMarkdown: string;
  notesJson?: string | null;
  notesLoading?: boolean;
  onNotesChange: (markdown: string, json: string) => void;
  /** Controlled active tab */
  activeTab: SummaryTab;
  onTabChange: (tab: SummaryTab) => void;
  /** Who said what; passed through to AskPanel via provider/model */
  totalTranscriptCount?: number;
  /** Edits the optional instructions sent with Enhance */
  onPromptChange: (value: string) => void;
  /** Persists the title (called on blur when it changed) */
  onSaveTitle: () => Promise<unknown>;
}

export function SummaryPanel({
  meeting,
  meetingTitle,
  summaryRef,
  isSaving,
  onSaveAll,
  onCopySummary,
  onOpenFolder,
  aiSummary,
  summaryStatus,
  transcripts,
  modelConfig,
  setModelConfig,
  onSaveModelConfig,
  onGenerateSummary,
  onStopGeneration,
  customPrompt,
  onSaveSummary,
  onSummaryChange,
  onDirtyChange,
  summaryError,
  onRegenerateSummary,
  getSummaryStatusMessage,
  availableTemplates,
  selectedTemplate,
  onTemplateSelect,
  onRefreshTemplates,
  isModelConfigLoading = false,
  onOpenModelSettings,
  isTitleDirty,
  streamText = '',
  notesMarkdown,
  notesJson,
  notesLoading = false,
  onNotesChange,
  activeTab,
  onTabChange,
  totalTranscriptCount,
  onPromptChange,
  onSaveTitle,
  onTitleChange,
}: SummaryPanelProps) {
  const [summaryLang, setSummaryLang] = useState<string | null>(null);
  const [summaryLangStorage, setSummaryLangStorage] = useState<SummaryLanguageStorage>('metadata');
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const languageLoadVersionRef = useRef(0);
  const activeMeetingIdRef = useRef(meeting.id);
  const languageSaveVersionRef = useRef(0);
  const languageSaveLoopRunningRef = useRef(false);
  const latestLanguageSaveRequestRef = useRef<{
    version: number;
    meetingId: string;
    language: string | null;
    rollback: {
      language: string | null;
      storage: SummaryLanguageStorage;
    };
  } | null>(null);
  activeMeetingIdRef.current = meeting.id;
  const { addRecent } = useRecentLanguages();
  const docScrollRef = useRef<HTMLDivElement>(null);
  const generateRef = useRef<(() => void) | null>(null);

  const effectiveLangLabel = summaryLang ? labelForCode(summaryLang) : 'Auto';
  const isLocalFallbackLanguage = summaryLangStorage === 'local_fallback';
  const autoSubtitle = isLocalFallbackLanguage
    ? 'Saved on this device for folderless meetings'
    : 'Uses dominant transcript language';

  useEffect(() => {
    let cancelled = false;
    const loadVersion = languageLoadVersionRef.current + 1;
    languageLoadVersionRef.current = loadVersion;

    const loadSummaryLanguage = async () => {
      try {
        const stored = await readMeetingSummaryLanguage(meeting.id);
        if (!cancelled && languageLoadVersionRef.current === loadVersion) {
          setSummaryLang(stored.language);
          setSummaryLangStorage(stored.storage);
        }
      } catch (err) {
        console.error('Failed to load summary language:', err);
        if (!cancelled && languageLoadVersionRef.current === loadVersion) setSummaryLang(null);
      }
    };

    loadSummaryLanguage();

    return () => {
      cancelled = true;
    };
  }, [meeting.id]);

  // Keep the streaming preview pinned to the bottom
  useEffect(() => {
    const el = docScrollRef.current;
    if (el && streamText) el.scrollTop = el.scrollHeight;
  }, [streamText]);

  const persistLatestLanguageSelection = async () => {
    if (languageSaveLoopRunningRef.current) return;
    languageSaveLoopRunningRef.current = true;

    try {
      while (true) {
        const request = latestLanguageSaveRequestRef.current;
        if (!request) return;

        try {
          const saved = await saveMeetingSummaryLanguage(request.meetingId, request.language);
          const latest = latestLanguageSaveRequestRef.current;
          if (
            latest?.version === request.version &&
            activeMeetingIdRef.current === request.meetingId
          ) {
            setSummaryLang(saved.language);
            setSummaryLangStorage(saved.storage);
            if (request.language) {
              addRecent(request.language);
            }
            return;
          }

          if (latest?.version === request.version) return;
        } catch (err) {
          const latest = latestLanguageSaveRequestRef.current;
          if (
            latest?.version === request.version &&
            activeMeetingIdRef.current === request.meetingId
          ) {
            console.error('Failed to persist summary language:', err);
            toast.error('Failed to save summary language');
            setSummaryLang(request.rollback.language);
            setSummaryLangStorage(request.rollback.storage);
            return;
          }

          if (latest?.version === request.version) return;
        }
      }
    } finally {
      languageSaveLoopRunningRef.current = false;
    }
  };

  const handleLangChange = (code: string | null) => {
    const previous = summaryLang;
    const previousStorage = summaryLangStorage;
    languageLoadVersionRef.current += 1;
    latestLanguageSaveRequestRef.current = {
      version: languageSaveVersionRef.current + 1,
      meetingId: meeting.id,
      language: code,
      rollback: {
        language: previous,
        storage: previousStorage,
      },
    };
    languageSaveVersionRef.current += 1;
    setSummaryLang(code);
    setLangPickerOpen(false);
    void persistLatestLanguageSelection();
  };

  const isSummaryLoading = summaryStatus === 'processing' || summaryStatus === 'summarizing' || summaryStatus === 'regenerating';
  const hasNotes = notesMarkdown.trim().length > 0;
  const hasTranscripts = (totalTranscriptCount ?? transcripts.length) > 0;

  const languageSlot = (
    <Popover open={langPickerOpen} onOpenChange={setLangPickerOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={metaChip}
          title={`Notes language: ${effectiveLangLabel}${isLocalFallbackLanguage ? ' (saved on this device)' : ''}`}
          aria-label="Set notes language"
        >
          <Languages size={13} className="text-gray-400" />
          <span>{effectiveLangLabel}</span>
          <ChevronDown size={12} className="text-gray-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto p-0 border-0 shadow-none bg-transparent"
      >
        <LanguagePickerPopover
          value={summaryLang}
          onChange={handleLangChange}
          onClose={() => setLangPickerOpen(false)}
          autoSubtitle={autoSubtitle}
        />
      </PopoverContent>
    </Popover>
  );

  const canGenerate = hasTranscripts || hasNotes;
  const mainLabel = aiSummary ? 'Re-enhance' : hasNotes ? 'Enhance notes' : 'Generate notes';
  const generate = () => {
    Analytics.trackButtonClick('generate_summary', 'meeting_details');
    generateRef.current?.();
  };

  const createdAt = new Date(meeting.created_at);
  const whenLabel = Number.isNaN(createdAt.getTime())
    ? null
    : `${createdAt.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} · ${createdAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;

  const tabButton = (tab: SummaryTab, label: string) => (
    <button
      role="tab"
      aria-selected={activeTab === tab}
      onClick={() => onTabChange(tab)}
      className={`-mb-px pb-2.5 text-[13px] font-medium border-b-2 transition-colors ${
        activeTab === tab
          ? 'border-gray-900 text-gray-900'
          : 'border-transparent text-gray-500 hover:text-gray-900'
      }`}
    >
      {label}
    </button>
  );

  // Title, meeting facts and tabs: the top of the meeting document
  const header = (
    <>
      <input
        value={meetingTitle}
        onChange={(e) => onTitleChange(e.target.value)}
        onBlur={() => { if (isTitleDirty) void onSaveTitle(); }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        placeholder="Untitled meeting"
        aria-label="Meeting title"
        className="w-full bg-transparent text-[28px] leading-tight font-semibold tracking-tight text-gray-900 placeholder:text-gray-300 outline-none"
      />
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {whenLabel && (
          <span className={`${metaChip} hover:bg-transparent hover:text-gray-600`}>
            <CalendarDays size={13} className="text-gray-400" />
            {whenLabel}
          </span>
        )}
        <SummaryGeneratorButtonGroup
          layout="chips"
          generateRef={generateRef}
          modelConfig={modelConfig}
          setModelConfig={setModelConfig}
          onSaveModelConfig={onSaveModelConfig}
          onGenerateSummary={onGenerateSummary}
          onStopGeneration={onStopGeneration}
          customPrompt={customPrompt}
          summaryStatus={summaryStatus}
          availableTemplates={availableTemplates}
          selectedTemplate={selectedTemplate}
          onTemplateSelect={onTemplateSelect}
          onRefreshTemplates={onRefreshTemplates}
          hasTranscripts={hasTranscripts}
          hasSummary={!!aiSummary}
          hasNotes={hasNotes}
          isModelConfigLoading={isModelConfigLoading}
          onOpenModelSettings={onOpenModelSettings}
          languageSlot={hasTranscripts ? languageSlot : undefined}
        />
      </div>

      <div role="tablist" className="mt-8 flex items-center gap-5 border-b border-gray-200">
        {tabButton('enhanced', 'Enhanced notes')}
        {tabButton('notes', 'My notes')}
        {tabButton('ask', 'Ask')}
        <div className="flex-1" />
        {activeTab === 'enhanced' && aiSummary && !isSummaryLoading && (
          <div className="-mt-1.5 pb-1.5">
            <SummaryUpdaterButtonGroup
              isSaving={isSaving}
              isDirty={isTitleDirty || (summaryRef.current?.isDirty || false)}
              onSave={onSaveAll}
              onCopy={onCopySummary}
              onFind={() => { }}
              onOpenFolder={onOpenFolder}
              hasSummary={!!aiSummary}
            />
          </div>
        )}
      </div>
    </>
  );

  let body: ReactNode;
  if (activeTab === 'notes') {
    body = (
      <>
        <p className="mt-4 mb-2 text-[12px] text-gray-500">
          Your own notes, kept as you wrote them. Enhancing builds on them with details from the transcript.
        </p>
        {notesLoading ? (
          <div className="text-sm text-gray-400">Loading…</div>
        ) : (
          <div className="-mx-3">
            <NotesPad
              key={`${meeting.id}-notes`}
              initialMarkdown={notesMarkdown}
              initialJson={notesJson}
              onChange={onNotesChange}
            />
          </div>
        )}
      </>
    );
  } else if (isSummaryLoading) {
    body = (
      <div className="mt-5">
        <div className="mb-3 flex items-center gap-2 text-[12px] text-gray-500">
          <Loader2 size={13} className="animate-spin" />
          <span>{streamText ? 'Writing your notes…' : getSummaryStatusMessage(summaryStatus) || 'Reading the transcript…'}</span>
        </div>
        {streamText ? (
          <div className="stream-md">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamText}</ReactMarkdown>
            <span className="inline-block w-1.5 h-4 bg-gray-400 animate-pulse align-middle ml-0.5" />
          </div>
        ) : (
          <div className="space-y-2.5 pt-2" aria-hidden="true">
            {[92, 78, 85, 60].map((w) => (
              <div key={w} className="h-3 rounded bg-gray-100 animate-pulse" style={{ width: `${w}%` }} />
            ))}
          </div>
        )}
      </div>
    );
  } else if (!aiSummary) {
    body = (
      <div className="mt-16 text-center">
        <Sparkles size={22} className="mx-auto mb-3 text-gray-300" />
        <h3 className="text-[15px] font-semibold text-gray-900">No notes written yet</h3>
        <p className="mx-auto mt-1 max-w-sm text-[13px] text-gray-500">
          {!canGenerate
            ? 'This meeting has no transcript or notes to work from.'
            : hasNotes
              ? 'Notesify will keep your notes and add what you missed from the transcript.'
              : 'Notesify will write decisions, action items and key points from the transcript.'}
        </p>
      </div>
    );
  } else {
    body = (
      <>
        <div className="mt-4 -mx-3">
          <BlockNoteSummaryView
            ref={summaryRef}
            summaryData={aiSummary}
            onSave={onSaveSummary}
            onSummaryChange={onSummaryChange}
            onDirtyChange={onDirtyChange}
            status={summaryStatus}
            error={summaryError}
            onRegenerateSummary={() => {
              Analytics.trackButtonClick('regenerate_summary', 'meeting_details');
              onRegenerateSummary();
            }}
            meeting={{
              id: meeting.id,
              title: meetingTitle,
              created_at: meeting.created_at
            }}
          />
        </div>
        {summaryStatus === 'error' && summaryError && (
          <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-red-700">
            <p className="text-sm font-medium">{summaryError}</p>
          </div>
        )}
      </>
    );
  }

  // Dark capsule docked at the bottom, matching the recorder: optional
  // instructions for the AI plus the Enhance / Stop action.
  const dock = activeTab !== 'ask' && canGenerate && (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center px-6">
      <div className="pointer-events-auto flex w-full max-w-[560px] items-center gap-2 rounded-full bg-[var(--sc-dock)] py-1.5 pl-5 pr-1.5 text-[var(--sc-dock-ink)] shadow-[var(--sc-shadow-md)] ring-1 ring-black/5">
        <input
          value={customPrompt}
          onChange={(e) => onPromptChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !isSummaryLoading) generate(); }}
          disabled={isSummaryLoading}
          placeholder={aiSummary ? 'What should change? e.g. shorter, focus on decisions' : 'Add context: who was there, what mattered'}
          aria-label="Instructions for the AI"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--sc-dock-ink)]/45 disabled:opacity-60"
        />
        {isSummaryLoading ? (
          <button
            type="button"
            onClick={() => {
              Analytics.trackButtonClick('stop_summary_generation', 'meeting_details');
              onStopGeneration();
            }}
            className="flex h-9 shrink-0 items-center gap-2 rounded-full bg-white/10 pl-3.5 pr-4 text-[13px] font-medium hover:bg-white/15 transition-colors"
          >
            <Square size={11} fill="currentColor" />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={generate}
            disabled={isModelConfigLoading}
            title={hasNotes ? 'Rewrite your notes into a complete document using the transcript' : 'Write notes from the transcript'}
            className="flex h-9 shrink-0 items-center gap-2 rounded-full bg-[var(--sc-dock-ink)] pl-3.5 pr-4 text-[13px] font-semibold text-[var(--sc-dock)] hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Sparkles size={14} />
            {mainLabel}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="relative flex-1 min-w-0 min-h-0 flex flex-col bg-white">
      {activeTab === 'ask' ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="mx-auto w-full max-w-[720px] px-6 sm:px-10 pt-14">{header}</div>
          <div className="mx-auto w-full max-w-[720px] flex-1 min-h-0 sm:px-4">
            <AskPanelLazy meetingId={meeting.id} />
          </div>
        </div>
      ) : (
        <div ref={docScrollRef} className="flex-1 min-h-0 overflow-y-auto">
          <div className="meeting-doc mx-auto w-full max-w-[720px] px-6 sm:px-10 pt-14 pb-40">
            {header}
            {body}
          </div>
        </div>
      )}
      {dock}
    </div>
  );
}
