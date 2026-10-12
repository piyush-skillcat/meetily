/**
 * Local draft storage for notes typed during a recording, before the meeting
 * row exists in SQLite. Once the meeting is saved, the draft is moved into the
 * `meeting_notes` table and cleared here.
 */

const LIVE_DRAFT_KEY = 'meetily:notes-draft:live';

export interface NotesDraft {
  markdown: string;
  /** BlockNote document JSON (stringified) */
  json?: string;
  updatedAt: number;
}

function read(key: string): NotesDraft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NotesDraft;
    if (typeof parsed?.markdown !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function write(key: string, draft: NotesDraft | null) {
  try {
    if (!draft || (!draft.markdown.trim() && !draft.json)) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(draft));
    }
  } catch (e) {
    console.warn('Failed to persist notes draft', e);
  }
}

export const notesDraft = {
  readLive: () => read(LIVE_DRAFT_KEY),
  writeLive: (markdown: string, json?: string) =>
    write(LIVE_DRAFT_KEY, { markdown, json, updatedAt: Date.now() }),
  clearLive: () => write(LIVE_DRAFT_KEY, null),
};
