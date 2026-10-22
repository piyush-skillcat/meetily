import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { PermissionWarning } from '@/components/PermissionWarning';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Copy, GlobeIcon, X } from 'lucide-react';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useConfig } from '@/contexts/ConfigContext';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { usePermissionCheck } from '@/hooks/usePermissionCheck';
import { ModalType } from '@/hooks/useModalState';
import { useIsLinux } from '@/hooks/usePlatform';
import { useMemo } from 'react';

/**
 * TranscriptPanel Component
 *
 * Displays transcript content with controls for copying and language settings.
 * Uses TranscriptContext, ConfigContext, and RecordingStateContext internally.
 */

interface TranscriptPanelProps {
  // indicates stop-processing state for transcripts; derived from backend statuses.
  isProcessingStop: boolean;
  isStopping: boolean;
  showModal: (name: ModalType, message?: string) => void;
  /** Narrow side-column layout (used next to the notes pad) */
  compact?: boolean;
  /** Shows a close button in the compact header */
  onClose?: () => void;
}

export function TranscriptPanel({
  isProcessingStop,
  isStopping,
  showModal,
  compact = false,
  onClose,
}: TranscriptPanelProps) {
  // Contexts
  const { transcripts, transcriptContainerRef, copyTranscript } = useTranscripts();
  const { transcriptModelConfig } = useConfig();
  const { isRecording, isPaused } = useRecordingState();
  const { checkPermissions, isChecking, hasSystemAudio, hasMicrophone } = usePermissionCheck();
  const isLinux = useIsLinux();

  // Convert transcripts to segments for virtualized view
  const segments = useMemo(() =>
    transcripts.map(t => ({
      id: t.id,
      timestamp: t.audio_start_time ?? 0,
      endTime: t.audio_end_time,
      text: t.text,
      confidence: t.confidence,
      speaker: t.speaker,
    })),
    [transcripts]
  );

  return (
    <div ref={transcriptContainerRef} className={`w-full bg-white flex flex-col overflow-y-auto ${compact ? '' : 'border-r border-gray-200'}`}>
      {/* Title area - Sticky header */}
      <div className={`sticky top-0 z-10 bg-white border-gray-200 ${compact ? 'px-4 h-12 flex items-center border-b border-gray-200' : 'p-4'}`}>
        <div className="flex flex-col space-y-3 w-full">
          <div className="flex  flex-col space-y-2">
            <div className={`flex items-center space-x-2 ${compact ? 'justify-between' : 'justify-center'}`}>
              {compact && (
                <span className="text-[13px] font-medium text-gray-900">Transcript</span>
              )}
              <div className="flex items-center gap-1">
              <ButtonGroup>
                {transcripts?.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyTranscript}
                    title="Copy Transcript"
                  >
                    <Copy />
                    <span className='hidden md:inline'>
                      Copy
                    </span>
                  </Button>
                )}
                {transcriptModelConfig.provider === "localWhisper" &&
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => showModal('languageSettings')}
                    title="Language"
                  >
                    <GlobeIcon />
                    <span className='hidden md:inline'>
                      Language
                    </span>
                  </Button>
                }
              </ButtonGroup>
              {compact && onClose && (
                <button
                  onClick={onClose}
                  className="h-7 w-7 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100"
                  title="Hide transcript"
                  aria-label="Hide transcript"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Permission Warning - Not needed on Linux */}
      {!isRecording && !isChecking && !isLinux && (
        <div className="flex justify-center px-4 pt-4">
          <PermissionWarning
            hasMicrophone={hasMicrophone}
            hasSystemAudio={hasSystemAudio}
            onRecheck={checkPermissions}
            isRechecking={isChecking}
          />
        </div>
      )}

      {/* Transcript content */}
      <div className={compact ? 'pb-32' : 'pb-20'}>
        <div className="flex justify-center">
          <div className={compact ? 'w-full' : 'w-2/3 max-w-[750px]'}>
            <VirtualizedTranscriptView
              segments={segments}
              isRecording={isRecording}
              isPaused={isPaused}
              isProcessing={isProcessingStop}
              isStopping={isStopping}
              enableStreaming={isRecording}
              showConfidence={true}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
