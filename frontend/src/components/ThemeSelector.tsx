"use client";

import { Monitor, Sun, Moon } from 'lucide-react';
import { useTheme, ThemePreference } from '@/contexts/ThemeContext';

const OPTIONS: Array<{ value: ThemePreference; label: string; Icon: typeof Sun }> = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
];

/** Segmented control for the theme preference (System / Light / Dark). */
export function ThemeSelector({ compact = false }: { compact?: boolean }) {
  const { preference, setPreference } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex items-center gap-0.5 p-0.5 rounded-lg border border-hairline bg-surface-2"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = preference === value;
        return (
          <button
            key={value}
            role="radio"
            aria-checked={active}
            title={label}
            onClick={() => setPreference(value)}
            className={`flex items-center gap-1.5 rounded-md text-xs font-semibold transition-colors ${compact ? 'px-2 py-1' : 'px-3 py-1.5'} ${
              active ? 'sc-cta' : 'text-ink-muted hover:text-ink-body hover:bg-gray-100'
            }`}
          >
            <Icon size={14} />
            {!compact && <span>{label}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Single icon button that flips light/dark (used in the sidebar rail). */
export function ThemeToggleButton({ className = '' }: { className?: string }) {
  const { resolved, toggle } = useTheme();
  const Icon = resolved === 'dark' ? Sun : Moon;
  return (
    <button
      onClick={toggle}
      title={resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className={`p-2 rounded-lg text-ink-muted hover:text-ink-body hover:bg-gray-100 transition-colors ${className}`}
    >
      <Icon className="w-5 h-5" />
    </button>
  );
}

export default ThemeSelector;
