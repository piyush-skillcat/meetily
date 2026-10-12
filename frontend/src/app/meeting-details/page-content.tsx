"use client";
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Summary, SummaryResponse } from '@/types';
import Analytics from '@/lib/analytics';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { TranscriptPanel } from '@/components/MeetingDetails/TranscriptPanel';
import { SummaryPanel, SummaryTab } from '@/components/MeetingDetails/SummaryPanel';
import { ModelConfig } from '@/components/ModelSettingsModal';
import { readMeetingSummaryLanguage } from '@/lib/summary-language-preferences';

// Custom hooks
import { useMeetingData } from '@/hooks/meeting-details/useMeetingData';
import { useSummaryGeneration } from '@/hooks/meeting-details/useSummaryGeneration';
import { useTemplates } from '@/hooks/meeting-details/useTemplates';
import { useCopyOperations } from '@/hooks/meeting-details/useCopyOperations';
import { useMeetingOperations } from '@/hooks/meeting-details/useMeetingOperations';
import { useEnhanceNotes } from '@/hooks/meeting-details/useEnhanceNotes';
import { useMeetingNotes } from '@/hooks/useMeetingNotes';
import { useConfig } from '@/contexts/ConfigContext';

export default function PageContent({
  meeting,
  summaryData,
  shouldAutoGenerate = false,
  onAutoGenerateComplete,
  onMeetingUpdated,
  onRefetchTranscripts,
  // Pagination props for efficient transcript loading
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
}: {
  meeting: any;
  summaryData: Summary | null;
  shouldAutoGenerate?: boolean;
  onAutoGenerateComplete?: () => void;
  onMeetingUpdated?: () => Promise<void>;
  onRefetchTranscripts?: () => Promise<void>;
  // Pagination props
  segments?: any[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;
}) {
  // State
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [isRecording] = useState(false);
  const [summaryResponse] = useState<SummaryResponse | null>(null);
  const [activeTab, setActiveTab] = useState<SummaryTab>('enhanced');

  // Ref to store the modal open function from SummaryGeneratorButtonGroup
  const openModelSettingsRef = useRef<(() => void) | null>(null);

  // Get model config from ConfigContext
  const { modelConfig, setModelConfig } = useConfig();

  // Custom hooks
  const meetingData = useMeetingData({ meeting, summaryData, onMeetingUpdated });
  const templates = useTemplates();
  const notes = useMeetingNotes(meeting.id);

  const handleRegisterModalOpen = (openFn: () => void) => {
    openModelSettingsRef.current = openFn;
  };

  const handleOpenModelSettings = () => {
    if (openModelSettingsRef.current) {
      openModelSettingsRef.current();
    }
  };

  // Save model config to backend database and sync via event
  const handleSaveModelConfig = async (config?: ModelConfig) => {
    if (!config) return;
    try {
      await invoke('api_save_model_config', {
        provider: config.provider,
        model: config.model,
        whisperModel: config.whisperModel,
        apiKey: config.apiKey ?? null,
        ollamaEndpoint: config.ollamaEndpoint ?? null,
      });

      const { emit } = await import('@tauri-apps/api/event');
      await emit('model-config-updated', config);

      toast.success('Model settings saved successfully');
    } catch (error) {
      console.error('Failed to save model config:', error);
      toast.error('Failed to save model settings');
    }
  };

  // Legacy polling-based generation (kept for status recovery + stop)
  const summaryGeneration = useSummaryGeneration({
    meeting,
    transcripts: meetingData.transcripts,
    modelConfig: modelConfig,
    isModelConfigLoading: false,
    selectedTemplate: templates.selectedTemplate,
    onMeetingUpdated,
    updateMeetingTitle: meetingData.updateMeetingTitle,
    setAiSummary: meetingData.setAiSummary,
    onOpenModelSettings: handleOpenModelSettings,
  });

  // Granola-style streaming enhancement
  const enhance = useEnhanceNotes({
    meetingId: meeting.id,
    onCompleted: (markdown, title) => {
      meetingData.setAiSummary({ markdown } as any);
      if (title) meetingData.updateMeetingTitle(title);
      setActiveTab('enhanced');
      onMeetingUpdated?.();
      Analytics.trackSummaryGenerationCompleted(modelConfig.provider, modelConfig.model, true).catch(() => { });
    },
  });

  const handleEnhance = useCallback(async (prompt: string = '') => {
    if (!modelConfig.provider || !modelConfig.model) {
      toast.error('Pick an AI model first', { description: 'Open AI Model and choose a provider.' });
      handleOpenModelSettings();
      return;
    }
    let summaryLanguage: string | null = null;
    try {
      summaryLanguage = (await readMeetingSummaryLanguage(meeting.id)).language;
    } catch {
      summaryLanguage = null;
    }
    setActiveTab('enhanced');
    Analytics.trackSummaryGenerationStarted(modelConfig.provider, modelConfig.model, 0, 0).catch(() => { });
    await enhance.start({
      notesMarkdown: notes.latestMarkdown(),
      templateId: templates.selectedTemplate,
      customPrompt: prompt,
      // Backend resolves the saved provider/model; avoids racing the config load
      summaryLanguage,
    });
  }, [enhance, meeting.id, modelConfig.provider, modelConfig.model, notes, templates.selectedTemplate]);

  const handleStop = useCallback(() => {
    void enhance.stop();
    if (summaryGeneration.summaryStatus !== 'idle' && summaryGeneration.summaryStatus !== 'completed') {
      summaryGeneration.handleStopGeneration();
    }
  }, [enhance, summaryGeneration]);

  const copyOperations = useCopyOperations({
    meeting,
    transcripts: meetingData.transcripts,
    meetingTitle: meetingData.meetingTitle,
    aiSummary: meetingData.aiSummary,
    blockNoteSummaryRef: meetingData.blockNoteSummaryRef,
  });

  const meetingOperations = useMeetingOperations({
    meeting,
  });

  useEffect(() => {
    Analytics.trackPageView('meeting_details');
  }, []);

  // Auto-enhance right after a recording (waits for the notes to load)
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!shouldAutoGenerate || notes.isLoading || autoStartedRef.current) return;
    const hasTranscripts = (totalCount ?? meetingData.transcripts.length) > 0;
    if (!hasTranscripts && !notes.latestMarkdown().trim()) return;
    autoStartedRef.current = true;
    console.log(`🤖 Auto-enhancing notes with ${modelConfig.provider}/${modelConfig.model}...`);
    handleEnhance('').finally(() => onAutoGenerateComplete?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAutoGenerate, notes.isLoading, meeting.id]);

  useEffect(() => {
    autoStartedRef.current = false;
    setActiveTab('enhanced');
  }, [meeting.id]);

  const summaryStatus = enhance.isStreaming
    ? 'summarizing'
    : enhance.status === 'error'
      ? 'error'
      : summaryGeneration.summaryStatus;
  const summaryError = enhance.error ?? summaryGeneration.summaryError;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex flex-col h-screen bg-gray-50"
    >
      <div className="flex flex-1 overflow-hidden">
        <TranscriptPanel
          transcripts={meetingData.transcripts}
          customPrompt={customPrompt}
          onPromptChange={setCustomPrompt}
          onCopyTranscript={copyOperations.handleCopyTranscript}
          onOpenMeetingFolder={meetingOperations.handleOpenMeetingFolder}
          isRecording={isRecording}
          disableAutoScroll={true}
          usePagination={true}
          segments={segments}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          totalCount={totalCount}
          loadedCount={loadedCount}
          onLoadMore={onLoadMore}
          meetingId={meeting.id}
          meetingFolderPath={meeting.folder_path}
          onRefetchTranscripts={onRefetchTranscripts}
        />
        <SummaryPanel
          meeting={meeting}
          meetingTitle={meetingData.meetingTitle}
          onTitleChange={meetingData.handleTitleChange}
          isEditingTitle={meetingData.isEditingTitle}
          onStartEditTitle={() => meetingData.setIsEditingTitle(true)}
          onFinishEditTitle={() => meetingData.setIsEditingTitle(false)}
          isTitleDirty={meetingData.isTitleDirty}
          summaryRef={meetingData.blockNoteSummaryRef}
          isSaving={meetingData.isSaving}
          onSaveAll={meetingData.saveAllChanges}
          onCopySummary={copyOperations.handleCopySummary}
          onOpenFolder={meetingOperations.handleOpenMeetingFolder}
          aiSummary={meetingData.aiSummary}
          summaryStatus={summaryStatus}
          transcripts={meetingData.transcripts}
          totalTranscriptCount={totalCount}
          modelConfig={modelConfig}
          setModelConfig={setModelConfig}
          onSaveModelConfig={handleSaveModelConfig}
          onGenerateSummary={handleEnhance}
          onStopGeneration={handleStop}
          customPrompt={customPrompt}
          summaryResponse={summaryResponse}
          onSaveSummary={meetingData.handleSaveSummary}
          onSummaryChange={meetingData.handleSummaryChange}
          onDirtyChange={meetingData.setIsSummaryDirty}
          summaryError={summaryError}
          onRegenerateSummary={() => handleEnhance(customPrompt)}
          getSummaryStatusMessage={summaryGeneration.getSummaryStatusMessage}
          availableTemplates={templates.availableTemplates}
          selectedTemplate={templates.selectedTemplate}
          onTemplateSelect={templates.handleTemplateSelection}
          onRefreshTemplates={templates.refreshTemplates}
          isModelConfigLoading={false}
          onOpenModelSettings={handleRegisterModalOpen}
          streamText={enhance.streamText}
          notesMarkdown={notes.notesMarkdown}
          notesJson={notes.notesJson}
          notesLoading={notes.isLoading}
          onNotesChange={(md, json) => { void notes.save(md, json); }}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      </div>
    </motion.div>
  );
}
