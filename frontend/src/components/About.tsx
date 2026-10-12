"use client";

import { APP_NAME, APP_TAGLINE } from '@/lib/brand';
import { BrandMark } from './Logo';

/**
 * About dialog — brand card, what the app does, and where things live.
 */
export function About() {
  return (
    <div className="flex flex-col gap-6 py-2">
      <div className="flex items-center gap-4">
        <BrandMark size={56} />
        <div className="flex flex-col gap-1">
          <span className="sc-eyebrow">SkillCat</span>
          <h2 className="text-2xl font-bold text-ink-strong leading-none">{APP_NAME}</h2>
          <p className="text-sm text-ink-muted">{APP_TAGLINE}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { title: 'Take rough notes', body: 'Jot what matters while you listen. The transcript runs beside you, with you and them told apart.' },
          { title: 'Enhance after', body: 'Your notes are rewritten into a complete document with details pulled from the transcript.' },
          { title: 'Ask anything', body: 'Chat with the meeting for action items, follow-up emails, or what was decided and why.' },
        ].map((c) => (
          <div key={c.title} className="rounded-xl border border-hairline bg-surface-2 p-4 shadow-sm">
            <h3 className="text-sm font-bold text-ink-strong mb-1">{c.title}</h3>
            <p className="text-xs text-ink-muted leading-relaxed">{c.body}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl bg-surface-1 border border-hairline p-4">
        <span className="sc-eyebrow">Privacy</span>
        <p className="text-sm text-ink-body mt-1">
          Audio, transcripts and notes stay on this computer. Cloud transcription and AI models are only used when you choose them in Settings.
        </p>
      </div>

      <p className="text-xs text-ink-muted">
        Built on the open-source Meetily core. Version <span className="sc-ts">0.4.0</span>.
      </p>
    </div>
  );
}

export default About;
