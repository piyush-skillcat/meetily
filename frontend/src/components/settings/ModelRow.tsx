"use client";

/**
 * One downloadable transcription model (Whisper or Parakeet) as a selectable
 * row: name and one-line description, muted specs, and the action for its
 * state (download, progress, retry, delete).
 */

import { Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type ModelRowStatus =
  | 'Available'
  | 'Missing'
  | { Downloading: number }
  | { Error: string }
  | { Corrupted: { file_size: number; expected_min_size: number } };

interface ModelRowProps {
  name: string;
  description?: string;
  /** Short facts shown under the name, e.g. ["466 MB", "Good accuracy"] */
  specs: string[];
  status: ModelRowStatus;
  sizeMb?: number;
  isSelected: boolean;
  isRecommended?: boolean;
  isDownloading?: boolean;
  onSelect: () => void;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

export function formatModelSize(sizeMb: number): string {
  return sizeMb >= 1000 ? `${(sizeMb / 1000).toFixed(1)} GB` : `${Math.round(sizeMb)} MB`;
}

export function ModelRow({
  name,
  description,
  specs,
  status,
  sizeMb,
  isSelected,
  isRecommended = false,
  isDownloading = false,
  onSelect,
  onDownload,
  onCancel,
  onDelete,
}: ModelRowProps) {
  const isAvailable = status === 'Available';
  const isMissing = status === 'Missing';
  const isError = typeof status === 'object' && 'Error' in status;
  const isCorrupted = typeof status === 'object' && 'Corrupted' in status;
  const progress = typeof status === 'object' && 'Downloading' in status ? status.Downloading : null;
  const selected = isSelected && isAvailable;

  return (
    <div
      role={isAvailable ? 'radio' : undefined}
      aria-checked={isAvailable ? selected : undefined}
      tabIndex={isAvailable ? 0 : undefined}
      onClick={() => { if (isAvailable) onSelect(); }}
      onKeyDown={(e) => { if (isAvailable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect(); } }}
      className={`group rounded-lg border px-4 py-3 transition-colors ${
        selected
          ? 'border-gray-900 bg-white'
          : isAvailable
            ? 'cursor-pointer border-gray-200 bg-white hover:border-gray-300'
            : 'border-gray-200 bg-transparent'
      }`}
    >
      <div className="flex items-center gap-3">
        {/* Selection dot: filled when this model is in use */}
        <span
          aria-hidden="true"
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
            selected ? 'border-gray-900' : isAvailable ? 'border-gray-300' : 'border-dashed border-gray-300'
          }`}
        >
          {selected && <span className="h-2 w-2 rounded-full bg-gray-900" />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[13px] font-semibold text-gray-900">{name}</span>
            {description && <span className="text-[12.5px] text-gray-500">{description}</span>}
            {isRecommended && (
              <span className="rounded px-1.5 py-px text-[11px] font-medium bg-[var(--sc-accent-bg)] text-[var(--sc-accent)]">
                Recommended
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[12px] text-gray-500">{specs.join(' · ')}</div>
        </div>

        <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {isAvailable && (
            <>
              <span className="text-[12px] text-gray-500">{selected ? 'In use' : 'Downloaded'}</span>
              <button
                type="button"
                onClick={onDelete}
                className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 opacity-0 transition-opacity hover:bg-gray-100 hover:text-[var(--sc-danger)] group-hover:opacity-100 focus-visible:opacity-100"
                title="Delete to free up space"
                aria-label={`Delete ${name}`}
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
          {isMissing && !isDownloading && (
            <Button variant="outline" size="sm" onClick={onDownload}>Download</Button>
          )}
          {isMissing && isDownloading && progress === null && (
            <Loader2 size={15} className="animate-spin text-gray-400" />
          )}
          {isError && progress === null && (
            <Button variant="outline" size="sm" onClick={onDownload}>Retry</Button>
          )}
          {isCorrupted && (
            <>
              <Button variant="ghost" size="sm" onClick={onDelete}>Delete</Button>
              <Button variant="outline" size="sm" onClick={onDownload}>Download again</Button>
            </>
          )}
        </div>
      </div>

      {isError && (
        <p className="mt-2 pl-7 text-[12px] text-[var(--sc-danger)]">
          Download failed{typeof status === 'object' && 'Error' in status && status.Error ? `: ${status.Error}` : '.'}
        </p>
      )}
      {isCorrupted && (
        <p className="mt-2 pl-7 text-[12px] text-[var(--sc-warning)]">The downloaded file is incomplete. Download it again to use this model.</p>
      )}

      {progress !== null && (
        <div className="mt-3 pl-7">
          <div className="flex items-center justify-between text-[12px] text-gray-500">
            <span>
              Downloading {Math.round(progress)}%
              {sizeMb ? ` · ${formatModelSize((sizeMb * progress) / 100)} of ${formatModelSize(sizeMb)}` : ''}
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onCancel(); }}
              className="rounded px-1.5 py-0.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            >
              Cancel
            </button>
          </div>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-gray-200">
            <div className="h-full rounded-full bg-gray-900 transition-[width] duration-300" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
