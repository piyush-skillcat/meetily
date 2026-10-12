"use client";

/**
 * Theme: "system" (follow the OS), "light" or "dark".
 * Writes `data-theme="light|dark"` on <html> (SkillCat tokens) and mirrors it
 * as the `dark` class for any class-based styling. Persists the choice.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'notesify:theme';

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', resolved);
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [system, setSystem] = useState<ResolvedTheme>('light');

  // Initial load (client only)
  useEffect(() => {
    setPreferenceState(readStoredPreference());
    setSystem(systemTheme());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystem(mq.matches ? 'dark' : 'light');
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const resolved: ResolvedTheme = preference === 'system' ? system : preference;

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, p);
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback(() => {
    setPreference(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setPreference]);

  const value = useMemo(() => ({ preference, resolved, setPreference, toggle }), [preference, resolved, setPreference, toggle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Allow use outside the provider (e.g. in isolated dynamic components) with safe defaults
    return { preference: 'system', resolved: 'light', setPreference: () => {}, toggle: () => {} };
  }
  return ctx;
}

/**
 * Inline script for <head>: applies the stored/system theme before React
 * hydrates so there's no flash of the wrong theme.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var p=localStorage.getItem('${THEME_STORAGE_KEY}');var d=p==='dark'||(p!=='light'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.setAttribute('data-theme',d?'dark':'light');if(d)r.classList.add('dark');r.style.colorScheme=d?'dark':'light';}catch(e){}})();`;
