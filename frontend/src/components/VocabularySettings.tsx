import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Label } from './ui/label';
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
        <div className="mx-1">
            <Label className="block text-sm font-medium text-gray-700 mb-1">
                Vocabulary
            </Label>
            <Textarea
                value={glossary}
                onChange={(e) => {
                    setGlossary(e.target.value);
                    setStatus('idle');
                }}
                onBlur={save}
                rows={4}
                placeholder={'SkillCat, Notesify\nyour teammates\' names\nproduct and customer names'}
                className="focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
                Names, companies and jargon to listen for, separated by commas or new lines (up to 100 terms in total).
                People you list on the recording screen and names you type in your notes are added automatically.
                Used when the language is set to a specific language, not Auto.
                {status === 'saving' && ' Saving…'}
                {status === 'saved' && ' Saved.'}
                {status === 'error' && ' Could not save.'}
            </p>
        </div>
    );
}
