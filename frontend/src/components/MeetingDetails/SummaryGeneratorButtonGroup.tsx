"use client";

import { ModelConfig, ModelSettingsModal } from '@/components/ModelSettingsModal';
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogTitle,
} from "@/components/ui/dialog"
import { VisuallyHidden } from "@/components/ui/visually-hidden"
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sparkles, Settings, Loader2, FileText, Check, Square, SlidersHorizontal, Cpu, LayoutTemplate, ChevronDown } from 'lucide-react';
import Analytics from '@/lib/analytics';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { useState, useEffect, ReactNode, MutableRefObject } from 'react';

/** Quiet outlined chip, shared by the meeting header's fact row */
export const metaChip = 'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-gray-200 bg-transparent text-[12px] text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors';
import { isOllamaNotInstalledError } from '@/lib/utils';
import { BuiltInModelInfo } from '@/lib/builtin-ai';
import { TemplateManagerDialog } from '@/components/Templates/TemplateManagerDialog';

interface SummaryGeneratorButtonGroupProps {
  languageSlot?: ReactNode;
  modelConfig: ModelConfig;
  setModelConfig: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;
  onSaveModelConfig: (config?: ModelConfig) => Promise<void>;
  onGenerateSummary: (customPrompt: string) => Promise<void>;
  onStopGeneration: () => void;
  customPrompt: string;
  summaryStatus: 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error';
  availableTemplates: Array<{ id: string, name: string, description: string }>;
  selectedTemplate: string;
  onTemplateSelect: (templateId: string, templateName: string) => void;
  onRefreshTemplates?: () => void;
  hasTranscripts?: boolean;
  hasSummary?: boolean;
  /** Whether the user has typed any notes (changes the button label) */
  hasNotes?: boolean;
  isModelConfigLoading?: boolean;
  onOpenModelSettings?: (openFn: () => void) => void;
  /**
   * "toolbar": one outlined button group with the Enhance action.
   * "chips": template, language and model as header chips, no Enhance button;
   * the caller triggers generation through generateRef instead.
   */
  layout?: 'toolbar' | 'chips';
  /** Receives the checked generate action (model readiness checks included) */
  generateRef?: MutableRefObject<(() => void) | null>;
}

export function SummaryGeneratorButtonGroup({
  modelConfig,
  setModelConfig,
  onSaveModelConfig,
  onGenerateSummary,
  onStopGeneration,
  customPrompt,
  summaryStatus,
  availableTemplates,
  selectedTemplate,
  onTemplateSelect,
  onRefreshTemplates,
  hasTranscripts = true,
  hasSummary = false,
  hasNotes = false,
  isModelConfigLoading = false,
  onOpenModelSettings,
  languageSlot,
  layout = 'toolbar',
  generateRef,
}: SummaryGeneratorButtonGroupProps) {
  const [isCheckingModels, setIsCheckingModels] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);

  // Expose the function to open the modal via callback registration
  useEffect(() => {
    if (onOpenModelSettings) {
      onOpenModelSettings(() => setSettingsDialogOpen(true));
    }
  }, [onOpenModelSettings]);

  if (!hasTranscripts && !hasNotes) {
    return null;
  }

  const checkBuiltInAIModelsAndGenerate = async () => {
    setIsCheckingModels(true);
    try {
      const selectedModel = modelConfig.model;

      if (!selectedModel) {
        toast.error('No built-in AI model selected', {
          description: 'Please select a model in settings',
          duration: 5000,
        });
        setSettingsDialogOpen(true);
        return;
      }

      const isReady = await invoke<boolean>('builtin_ai_is_model_ready', {
        modelName: selectedModel,
        refresh: true,
      });

      if (isReady) {
        onGenerateSummary(customPrompt);
        return;
      }

      const modelInfo = await invoke<BuiltInModelInfo | null>('builtin_ai_get_model_info', {
        modelName: selectedModel,
      });

      if (!modelInfo) {
        toast.error('Model not found', {
          description: `Could not find information for model: ${selectedModel}`,
          duration: 5000,
        });
        setSettingsDialogOpen(true);
        return;
      }

      const status = modelInfo.status;

      if (status.type === 'downloading') {
        toast.info('Model download in progress', {
          description: `${selectedModel} is downloading (${status.progress}%). Please wait until download completes.`,
          duration: 5000,
        });
        return;
      }

      if (status.type === 'not_downloaded') {
        toast.error('Model not downloaded', {
          description: `${selectedModel} needs to be downloaded before use. Opening model settings...`,
          duration: 5000,
        });
        setSettingsDialogOpen(true);
        return;
      }

      if (status.type === 'corrupted') {
        toast.error('Model file corrupted', {
          description: `${selectedModel} file is corrupted. Please delete and re-download.`,
          duration: 7000,
        });
        setSettingsDialogOpen(true);
        return;
      }

      if (status.type === 'error') {
        toast.error('Model error', {
          description: status.Error || 'An error occurred with the model',
          duration: 5000,
        });
        setSettingsDialogOpen(true);
        return;
      }

      toast.error('Model not available', {
        description: 'The selected model is not ready for use',
        duration: 5000,
      });
      setSettingsDialogOpen(true);

    } catch (error) {
      console.error('Error checking built-in AI models:', error);
      toast.error('Failed to check model status', {
        description: error instanceof Error ? error.message : String(error),
        duration: 5000,
      });
    } finally {
      setIsCheckingModels(false);
    }
  };

  const checkOllamaModelsAndGenerate = async () => {
    if (modelConfig.provider === 'builtin-ai') {
      await checkBuiltInAIModelsAndGenerate();
      return;
    }

    if (modelConfig.provider !== 'ollama') {
      onGenerateSummary(customPrompt);
      return;
    }

    setIsCheckingModels(true);
    try {
      const endpoint = modelConfig.ollamaEndpoint || null;
      const models = await invoke('get_ollama_models', { endpoint }) as any[];

      if (!models || models.length === 0) {
        toast.error(
          'No Ollama models found. Please download a model from Model Settings.',
          { duration: 5000 }
        );
        setSettingsDialogOpen(true);
        return;
      }

      onGenerateSummary(customPrompt);
    } catch (error) {
      console.error('Error checking Ollama models:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (isOllamaNotInstalledError(errorMessage)) {
        toast.error(
          'Ollama is not installed',
          {
            description: 'Please download and install Ollama to use local models.',
            duration: 7000,
            action: {
              label: 'Download',
              onClick: () => invoke('open_external_url', { url: 'https://ollama.com/download' })
            }
          }
        );
      } else {
        toast.error(
          'Failed to check Ollama models. Please check if Ollama is running and download a model.',
          { duration: 5000 }
        );
      }
      setSettingsDialogOpen(true);
    } finally {
      setIsCheckingModels(false);
    }
  };

  const isGenerating = summaryStatus === 'processing' || summaryStatus === 'summarizing' || summaryStatus === 'regenerating';
  const selectedTemplateName = availableTemplates.find(t => t.id === selectedTemplate)?.name ?? 'Auto';
  const mainLabel = hasSummary ? 'Re-enhance' : hasNotes ? 'Enhance notes' : 'Generate notes';
  if (generateRef) generateRef.current = checkOllamaModelsAndGenerate;

  const chips = layout === 'chips';

  const settingsDialog = (
    <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
      <DialogTrigger asChild>
        {chips ? (
          <button type="button" className={metaChip} title="AI model used for notes and chat">
            <Cpu size={13} className="text-gray-400" />
            <span className="max-w-[160px] truncate">{modelConfig.model || 'AI model'}</span>
            <ChevronDown size={12} className="text-gray-400" />
          </button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            title="AI model used for notes and chat"
          >
            <Settings />
            <span className="hidden lg:inline">AI Model</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        aria-describedby={undefined}
      >
        <VisuallyHidden>
          <DialogTitle>Model Settings</DialogTitle>
        </VisuallyHidden>
        <ModelSettingsModal
          onSave={async (config) => {
            await onSaveModelConfig(config);
            setSettingsDialogOpen(false);
          }}
          modelConfig={modelConfig}
          setModelConfig={setModelConfig}
          skipInitialFetch={true}
          layout="dialog"
        />
      </DialogContent>
    </Dialog>
  );

  const templateMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {chips ? (
          <button type="button" className={metaChip} title="How Notesify writes this meeting's notes">
            <LayoutTemplate size={13} className="text-gray-400" />
            <span className="max-w-[140px] truncate">{selectedTemplateName}</span>
            <ChevronDown size={12} className="text-gray-400" />
          </button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            title={`Template: ${selectedTemplateName}`}
          >
            <FileText />
            <span className="hidden lg:inline max-w-[140px] truncate">{selectedTemplateName}</span>
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={chips ? 'start' : 'end'} className="max-h-[70vh] overflow-y-auto">
        {availableTemplates.map((template) => (
          <DropdownMenuItem
            key={template.id}
            onClick={() => onTemplateSelect(template.id, template.name)}
            title={template.description}
            className="flex items-center justify-between gap-2"
          >
            <span>{template.name}</span>
            {selectedTemplate === template.id && (
              <Check className="h-4 w-4 text-green-600" />
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setTemplateManagerOpen(true)} className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          <span>Manage templates…</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const templateManager = (
    <TemplateManagerDialog
      open={templateManagerOpen}
      onOpenChange={setTemplateManagerOpen}
      selectedTemplateId={selectedTemplate}
      onChanged={onRefreshTemplates}
      onUseTemplate={onTemplateSelect}
    />
  );

  if (chips) {
    return (
      <>
        {templateMenu}
        {languageSlot}
        {settingsDialog}
        {templateManager}
      </>
    );
  }

  return (
    <ButtonGroup>
      {isGenerating ? (
        <Button
          variant="outline"
          size="sm"
          className="bg-gradient-to-r from-red-50 to-orange-50 hover:from-red-100 hover:to-orange-100 border-red-200 xl:px-4"
          onClick={() => {
            Analytics.trackButtonClick('stop_summary_generation', 'meeting_details');
            onStopGeneration();
          }}
          title="Stop"
        >
          <Square className="xl:mr-2" size={18} fill="currentColor" />
          <span className="hidden lg:inline xl:inline">Stop</span>
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="bg-gradient-to-r from-blue-50 to-purple-50 hover:from-blue-100 hover:to-purple-100 border-blue-200 xl:px-4"
          onClick={() => {
            Analytics.trackButtonClick('generate_summary', 'meeting_details');
            checkOllamaModelsAndGenerate();
          }}
          disabled={isCheckingModels || isModelConfigLoading}
          title={
            isModelConfigLoading
              ? 'Loading model configuration...'
              : isCheckingModels
                ? 'Checking models...'
                : hasNotes
                  ? 'Rewrite your notes into a complete document using the transcript'
                  : 'Write notes from the transcript'
          }
        >
          {isCheckingModels || isModelConfigLoading ? (
            <>
              <Loader2 className="animate-spin xl:mr-2" size={18} />
              <span className="hidden xl:inline">Processing...</span>
            </>
          ) : (
            <>
              <Sparkles className="xl:mr-2" size={18} />
              <span className="hidden lg:inline xl:inline">{mainLabel}</span>
            </>
          )}
        </Button>
      )}

      {languageSlot}

      {settingsDialog}

      {templateMenu}

      {templateManager}
    </ButtonGroup>
  );
}
