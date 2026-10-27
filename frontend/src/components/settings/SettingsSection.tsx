"use client";

/**
 * Building blocks shared by every Settings tab so they read as one page:
 * a section is a quiet card with a small heading; rows inside it put the
 * label and its explanation on the left and the control on the right.
 */

import { ReactNode } from 'react';
import { Info, TriangleAlert } from 'lucide-react';

interface SettingsSectionProps {
  title: string;
  description?: ReactNode;
  /** Sits at the right of the heading (e.g. a status or a small button) */
  action?: ReactNode;
  children: ReactNode;
}

export function SettingsSection({ title, description, action, children }: SettingsSectionProps) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-gray-900">{title}</h3>
          {description && <p className="mt-0.5 text-[13px] leading-relaxed text-gray-500">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className="divide-y divide-gray-200 border-t border-gray-200">{children}</div>
    </section>
  );
}

interface SettingRowProps {
  label: ReactNode;
  description?: ReactNode;
  /** Control at the right (switch, select, button) */
  control?: ReactNode;
  /** Full-width content under the label */
  children?: ReactNode;
}

export function SettingRow({ label, description, control, children }: SettingRowProps) {
  return (
    <div className="px-5 py-3.5">
      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-gray-900">{label}</div>
          {description && <div className="mt-0.5 text-[12.5px] leading-relaxed text-gray-500">{description}</div>}
        </div>
        {control && <div className="shrink-0">{control}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

/** Free-form content inside a section, padded like a row */
export function SettingBlock({ children }: { children: ReactNode }) {
  return <div className="px-5 py-4">{children}</div>;
}

/** Inline note: neutral by default, amber for things that need attention */
export function SettingNote({ tone = 'neutral', title, children }: { tone?: 'neutral' | 'warning'; title?: string; children: ReactNode }) {
  const Icon = tone === 'warning' ? TriangleAlert : Info;
  return (
    <div className={`flex gap-2.5 rounded-lg px-3 py-2.5 text-[12.5px] leading-relaxed ${
      tone === 'warning' ? 'bg-[var(--sc-warning-bg)] text-gray-800' : 'bg-gray-100 text-gray-600'
    }`}>
      <Icon size={14} className={`mt-0.5 shrink-0 ${tone === 'warning' ? 'text-[var(--sc-warning)]' : 'text-gray-400'}`} />
      <div>
        {title && <p className="font-medium text-gray-900">{title}</p>}
        {children}
      </div>
    </div>
  );
}
