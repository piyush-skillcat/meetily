import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Textarea } from './ui/textarea';

/**
 * Persistent transcription glossary: names, companies and jargon the live
 * recognizer should listen for in every meeting. Saved on blur. Per-meeting
 * people and terms typed in the notes are added automatically on top.
 */
export function VocabularySettings() {
    const [glossary, setGlossary] = useState('');
    const [saved, setSaved] = useState('');
    const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

    useEffect(() => {
        invoke<string>('api_get_transcription_glossary')
            .then((value) => {
                setGlossary(value);
                setSaved(value);
            })
            .catch((e) => console.error('Failed to load glossary', e));
    }, []);

    const save = async () => {
        if (glossary === saved) return;
        setStatus('saving');
        try {
            await invoke('api_save_transcription_glossary', { glossary });
            setSaved(glossary);
            setStatus('saved');
        } catch (e) {
            console.error('Failed to save glossary', e);
            setStatus('error');
        }
    };

    return (
        <div>
            <Textarea
                value={glossary}
                onChange={(e) => {
                    setGlossary(e.target.value);
                    setStatus('idle');
                }}
                onBlur={save}
                rows={4}
                aria-label="Vocabulary"
                placeholder={'SkillCat, Notesify\nyour teammates\' names\nproduct and customer names'}
            />
            <div className="mt-1.5 flex items-start justify-between gap-4 text-[12px] leading-relaxed text-gray-500">
                <p>
                    Separate terms with commas or new lines, up to 100 in total. People you list on the recording
                    screen and names in your notes are added automatically. Applies when the language is set to a
                    specific language, not Auto.
                </p>
                <span className={`shrink-0 ${status === 'error' ? 'text-[var(--sc-danger)]' : ''}`} aria-live="polite">
                    {status === 'saving' && 'Saving'}
                    {status === 'saved' && 'Saved'}
                    {status === 'error' && 'Could not save'}
                </span>
            </div>
        </div>
    );
}
