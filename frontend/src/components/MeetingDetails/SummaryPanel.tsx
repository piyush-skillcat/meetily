"use client";

import { Summary, SummaryResponse, Transcript } from '@/types';
import { BlockNoteSummaryView, BlockNoteSummaryViewRef } from '@/components/AISummary/BlockNoteSummaryView';
import { EmptyStateSummary } from '@/components/EmptyStateSummary';
import { ModelConfig } from '@/components/ModelSettingsModal';
import { SummaryGeneratorButtonGroup } from './SummaryGeneratorButtonGroup';
import { SummaryUpdaterButtonGroup } from './SummaryUpdaterButtonGroup';
import dynamic from 'next/dynamic';
const NotesPad = dynamic(() => import('@/components/Notes/NotesPad').then(m => m.NotesPad), { ssr: false });
const AskPanelLazy = dynamic(() => import('./AskPanel').then(m => m.AskPanel), { ssr: false });
import Analytics from '@/lib/analytics';
import { useEffect, useRef, useState, RefObject } from 'react';
import { toast } from 'sonner';
import { Languages, ChevronDown, Sparkles, PenLine, MessageSquare, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
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
  const streamScrollRef = useRef<HTMLDivElement>(null);

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
    const el = streamScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
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
        <Button
          variant="outline"
          size="sm"
          title={`Notes language: ${effectiveLangLabel}${isLocalFallbackLanguage ? ' (saved on this device)' : ''}`}
          aria-label="Set notes language"
        >
          <Languages size={18} />
          <span className="hidden lg:inline">{effectiveLangLabel}</span>
          <ChevronDown size={14} className="text-gray-400" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
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

  const generatorGroup = (
    <SummaryGeneratorButtonGroup
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
  );

  const tabButton = (tab: SummaryTab, label: string, Icon: typeof Sparkles) => (
    <button
      onClick={() => onTabChange(tab)}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
        activeTab === tab ? 'bg-ink-strong text-surface-0' : 'text-ink-muted hover:bg-gray-100'
      }`}
    >
      <Icon size={15} />
      <span>{label}</span>
    </button>
  );

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-white overflow-hidden">
      {/* Header: tabs + actions */}
      <div className="px-4 py-3 border-b border-gray-200 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-lg p-1">
          {tabButton('enhanced', 'Enhanced notes', Sparkles)}
          {tabButton('notes', hasNotes ? 'My notes' : 'My notes', PenLine)}
          {tabButton('ask', 'Ask', MessageSquare)}
        </div>
        <div className="flex-1" />
        {activeTab === 'enhanced' && (
          <div className="flex items-center gap-2">
            {generatorGroup}
            {aiSummary && !isSummaryLoading && (
              <SummaryUpdaterButtonGroup
                isSaving={isSaving}
                isDirty={isTitleDirty || (summaryRef.current?.isDirty || false)}
                onSave={onSaveAll}
                onCopy={onCopySummary}
                onFind={() => { }}
                onOpenFolder={onOpenFolder}
                hasSummary={!!aiSummary}
              />
            )}
          </div>
        )}
        {activeTab === 'notes' && (
          <div className="flex items-center gap-2">
            {generatorGroup}
          </div>
        )}
      </div>

      {/* Body */}
      {activeTab === 'ask' ? (
        <AskPanelLazy meetingId={meeting.id} />
      ) : activeTab === 'notes' ? (
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="px-6 pt-4 pb-2 text-xs text-gray-500">
            Your own notes. Hit <span className="font-medium text-gray-700">Enhance notes</span> to have the AI fill in details from the transcript. Your original notes stay here.
          </div>
          {notesLoading ? (
            <div className="px-6 text-sm text-gray-400">Loading…</div>
          ) : (
            <div className="px-2 pb-10">
              <NotesPad
                key={`${meeting.id}-notes`}
                initialMarkdown={notesMarkdown}
                initialJson={notesJson}
                onChange={onNotesChange}
              />
            </div>
          )}
        </div>
      ) : isSummaryLoading ? (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center gap-2 px-6 py-2 text-sm text-gray-500 border-b border-gray-100">
            <Loader2 size={14} className="animate-spin" />
            <span>{streamText ? 'Writing your notes…' : getSummaryStatusMessage(summaryStatus) || 'Reading the transcript…'}</span>
          </div>
          <div ref={streamScrollRef} className="flex-1 overflow-y-auto px-8 py-4">
            {streamText ? (
              <div className="stream-md max-w-3xl">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamText}</ReactMarkdown>
                <span className="inline-block w-1.5 h-4 bg-gray-400 animate-pulse align-middle ml-0.5" />
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="inline-block animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500 mb-3"></div>
                  <p className="text-gray-500 text-sm">Reading the transcript…</p>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : !aiSummary ? (
        <div className="flex flex-col h-full">
          <EmptyStateSummary
            onGenerate={() => onGenerateSummary(customPrompt)}
            hasModel={modelConfig.provider !== null && modelConfig.model !== null}
            isGenerating={isSummaryLoading}
          />
          {hasNotes && (
            <p className="text-center text-xs text-gray-400 -mt-4">
              You have notes for this meeting. Enhancing will keep them and add what you missed.
            </p>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="p-6 w-full">
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
            <div className="mx-6 mb-6 p-4 rounded-lg bg-red-50 text-red-700">
              <p className="text-sm font-medium">{summaryError}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
