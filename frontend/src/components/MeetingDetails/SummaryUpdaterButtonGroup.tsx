"use client";

import { Copy, Check, Loader2, FolderOpen } from 'lucide-react';
import Analytics from '@/lib/analytics';

interface SummaryUpdaterButtonGroupProps {
  isSaving: boolean;
  isDirty: boolean;
  onSave: () => Promise<void>;
  onCopy: () => Promise<void>;
  onFind?: () => void;
  onOpenFolder: () => Promise<void>;
  hasSummary: boolean;
}

const iconButton = 'h-7 w-7 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:pointer-events-none';

/** Quiet actions at the right of the notes tab bar; Save only shows when there are edits */
export function SummaryUpdaterButtonGroup({
  isSaving,
  isDirty,
  onSave,
  onCopy,
  onOpenFolder,
  hasSummary
}: SummaryUpdaterButtonGroupProps) {
  return (
    <div className="flex items-center gap-0.5">
      {(isDirty || isSaving) && (
        <button
          type="button"
          className="mr-1 h-7 px-2.5 flex items-center gap-1.5 rounded-md text-[12px] sc-cta"
          title={isSaving ? 'Saving' : 'Save changes'}
          onClick={() => {
            Analytics.trackButtonClick('save_changes', 'meeting_details');
            onSave();
          }}
          disabled={isSaving}
        >
          {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          {isSaving ? 'Saving' : 'Save'}
        </button>
      )}

      <button
        type="button"
        className={iconButton}
        title="Copy notes"
        aria-label="Copy notes"
        onClick={() => {
          Analytics.trackButtonClick('copy_summary', 'meeting_details');
          onCopy();
        }}
        disabled={!hasSummary}
      >
        <Copy size={15} />
      </button>

      <button
        type="button"
        className={iconButton}
        title="Open meeting folder"
        aria-label="Open meeting folder"
        onClick={() => {
          Analytics.trackButtonClick('open_recording_folder', 'meeting_details');
          onOpenFolder();
        }}
      >
        <FolderOpen size={15} />
      </button>
    </div>
  );
}
