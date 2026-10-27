import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { ModelManager } from './WhisperModelManager';
import { ParakeetModelManager } from './ParakeetModelManager';
import { VocabularySettings } from './VocabularySettings';
import { SettingsSection, SettingRow, SettingBlock } from './settings/SettingsSection';


export interface TranscriptModelProps {
    provider: 'localWhisper' | 'parakeet' | 'deepgram' | 'elevenLabs' | 'groq' | 'openai';
    model: string;
    apiKey?: string | null;
}

export interface TranscriptSettingsProps {
    transcriptModelConfig: TranscriptModelProps;
    setTranscriptModelConfig: (config: TranscriptModelProps) => void;
    onModelSelect?: () => void;
}

type Provider = TranscriptModelProps['provider'];

const PROVIDERS: Array<{ id: Provider; label: string; hint: string }> = [
    { id: 'deepgram', label: 'Deepgram', hint: 'Cloud, live streaming' },
    { id: 'openai', label: 'OpenAI', hint: 'Cloud' },
    { id: 'groq', label: 'Groq', hint: 'Cloud, Whisper' },
    { id: 'parakeet', label: 'Parakeet', hint: 'On this device' },
    { id: 'localWhisper', label: 'Whisper', hint: 'On this device' },
];

const PROVIDER_NOTES: Partial<Record<Provider, string>> = {
    deepgram: 'Your mic and the other side each stream to Deepgram over their own connection, so the transcript shows who said what. Only detected speech is sent, and Deepgram is asked not to use it for training. With the language set to Auto, Deepgram runs in multilingual mode.',
    openai: 'Speech is sent to OpenAI in short segments as you talk. Your mic and the other side are transcribed separately.',
    groq: 'Speech is sent to Groq in short segments as you talk. Your mic and the other side are transcribed separately.',
    parakeet: 'Runs on this device; nothing leaves your computer.',
    localWhisper: 'Runs on this device; nothing leaves your computer. Larger models are more accurate and slower.',
};

const MODEL_OPTIONS: Partial<Record<Provider, Array<{ id: string; label: string }>>> = {
    deepgram: [{ id: 'nova-3', label: 'nova-3' }],
    elevenLabs: [{ id: 'scribe_v1', label: 'scribe_v1' }],
    groq: [
        { id: 'whisper-large-v3', label: 'whisper-large-v3' },
        { id: 'whisper-large-v3-turbo', label: 'whisper-large-v3-turbo' },
    ],
    openai: [
        { id: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe' },
        { id: 'gpt-4o-mini-transcribe', label: 'gpt-4o-mini-transcribe' },
        { id: 'whisper-1', label: 'whisper-1' },
    ],
};

const CLOUD_DEFAULT_MODEL: Partial<Record<Provider, string>> = {
    groq: 'whisper-large-v3',
    openai: 'gpt-4o-transcribe',
    deepgram: 'nova-3',
    elevenLabs: 'scribe_v1',
};

const isLocal = (p: Provider) => p === 'localWhisper' || p === 'parakeet';
const providerLabel = (p: Provider) => PROVIDERS.find((x) => x.id === p)?.label ?? p;

export function TranscriptSettings({ transcriptModelConfig, setTranscriptModelConfig, onModelSelect }: TranscriptSettingsProps) {
    const [uiProvider, setUiProvider] = useState<Provider>(transcriptModelConfig.provider);
    const [uiModel, setUiModel] = useState<string>(transcriptModelConfig.model);
    // Key as stored in the database for uiProvider, and the draft being typed
    const [storedKey, setStoredKey] = useState<string>('');
    const [apiKey, setApiKey] = useState<string>('');
    const [showApiKey, setShowApiKey] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Follow the saved config when it loads or changes elsewhere
    useEffect(() => {
        setUiProvider(transcriptModelConfig.provider);
        setUiModel(transcriptModelConfig.model);
    }, [transcriptModelConfig.provider, transcriptModelConfig.model]);

    useEffect(() => {
        if (isLocal(uiProvider)) {
            setStoredKey('');
            setApiKey('');
            return;
        }
        let cancelled = false;
        invoke<string>('api_get_transcript_api_key', { provider: uiProvider })
            .then((key) => {
                if (cancelled) return;
                setStoredKey(key || '');
                setApiKey(key || '');
            })
            .catch((err) => {
                console.error('Error fetching API key:', err);
                if (!cancelled) { setStoredKey(''); setApiKey(''); }
            });
        return () => { cancelled = true; };
    }, [uiProvider]);

    // Writes provider + model (and a new key, when given) to the database
    const persist = async (config: TranscriptModelProps, newKey: string | null) => {
        await invoke('api_save_transcript_config', {
            provider: config.provider,
            model: config.model,
            apiKey: newKey,
        });
        setTranscriptModelConfig(config);
    };

    const handleProviderChange = (value: string) => {
        const provider = value as Provider;
        setUiProvider(provider);
        setShowApiKey(false);
        if (!isLocal(provider)) {
            setUiModel(transcriptModelConfig.provider === provider && transcriptModelConfig.model
                ? transcriptModelConfig.model
                : (CLOUD_DEFAULT_MODEL[provider] ?? ''));
        }
    };

    // A cloud provider only becomes active once it has a key, so switching here
    // never leaves recording pointed at a provider that cannot authenticate.
    useEffect(() => {
        if (isLocal(uiProvider) || !storedKey) return;
        if (uiProvider === transcriptModelConfig.provider && uiModel === transcriptModelConfig.model) return;
        persist({ provider: uiProvider, model: uiModel, apiKey: storedKey }, null)
            .then(() => toast.success(`Transcribing with ${providerLabel(uiProvider)} ${uiModel}`))
            .catch((err) => toast.error('Could not save transcription settings', { description: String(err) }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uiProvider, uiModel, storedKey]);

    const handleSaveKey = async () => {
        const key = apiKey.trim();
        if (!key) return;
        setIsSaving(true);
        try {
            await persist({ provider: uiProvider, model: uiModel, apiKey: key }, key);
            setStoredKey(key);
            setApiKey(key);
            setShowApiKey(false);
            toast.success(`${providerLabel(uiProvider)} key saved`, {
                description: `New recordings are transcribed with ${providerLabel(uiProvider)} ${uiModel}.`,
            });
        } catch (err) {
            console.error('Failed to save transcript API key:', err);
            toast.error('Could not save the API key', { description: String(err) });
        } finally {
            setIsSaving(false);
        }
    };

    const handleWhisperModelSelect = (modelName: string) => {
        // The model manager saves the choice itself (autoSave)
        setTranscriptModelConfig({ ...transcriptModelConfig, provider: 'localWhisper', model: modelName });
        onModelSelect?.();
    };

    const handleParakeetModelSelect = (modelName: string) => {
        setTranscriptModelConfig({ ...transcriptModelConfig, provider: 'parakeet', model: modelName });
        onModelSelect?.();
    };

    const keyDirty = apiKey.trim() !== storedKey;
    const activeLabel = `${providerLabel(transcriptModelConfig.provider)} · ${transcriptModelConfig.model}`;
    const pendingSwitch = !isLocal(uiProvider) && !storedKey && uiProvider !== transcriptModelConfig.provider;

    return (
        <div className="space-y-5">
            <SettingsSection
                title="Transcription engine"
                description="Turns meeting audio into text, live while you record."
                action={<span className="text-[12px] text-gray-500">In use: <span className="text-gray-900">{activeLabel}</span></span>}
            >
                <SettingRow
                    label="Provider"
                    description={PROVIDER_NOTES[uiProvider]}
                >
                        <div className="flex flex-wrap items-center gap-2">
                            <Select value={uiProvider} onValueChange={handleProviderChange}>
                                <SelectTrigger className="w-[260px]" aria-label="Transcription provider">
                                    <SelectValue placeholder="Select provider" />
                                </SelectTrigger>
                                <SelectContent>
                                    {PROVIDERS.map((p) => (
                                        <SelectItem key={p.id} value={p.id}>
                                            {p.label} <span className="text-gray-500">· {p.hint}</span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {!isLocal(uiProvider) && (
                                <Select value={uiModel} onValueChange={setUiModel}>
                                    <SelectTrigger className="w-[200px]" aria-label="Transcription model">
                                        <SelectValue placeholder="Select model" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {(MODEL_OPTIONS[uiProvider] ?? []).map((model) => (
                                            <SelectItem key={model.id} value={model.id}>{model.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>
                </SettingRow>

                {uiProvider === 'localWhisper' && (
                    <SettingBlock>
                        <ModelManager
                            selectedModel={transcriptModelConfig.provider === 'localWhisper' ? transcriptModelConfig.model : undefined}
                            onModelSelect={handleWhisperModelSelect}
                            autoSave={true}
                        />
                    </SettingBlock>
                )}

                {uiProvider === 'parakeet' && (
                    <SettingBlock>
                        <ParakeetModelManager
                            selectedModel={transcriptModelConfig.provider === 'parakeet' ? transcriptModelConfig.model : undefined}
                            onModelSelect={handleParakeetModelSelect}
                            autoSave={true}
                        />
                    </SettingBlock>
                )}

                {!isLocal(uiProvider) && (
                    <SettingRow
                        label={`${providerLabel(uiProvider)} API key`}
                        description={
                            pendingSwitch
                                ? `Save a key to switch transcription to ${providerLabel(uiProvider)}.`
                                : storedKey
                                    ? 'Saved on this device.'
                                    : 'Not set.'
                        }
                    >
                        <form
                            className="flex items-center gap-2"
                            onSubmit={(e) => { e.preventDefault(); void handleSaveKey(); }}
                        >
                            <div className="relative flex-1">
                                <Input
                                    type={showApiKey ? 'text' : 'password'}
                                    value={apiKey}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    placeholder="Paste your API key"
                                    autoComplete="off"
                                    spellCheck={false}
                                    aria-label={`${providerLabel(uiProvider)} API key`}
                                    className="pr-10 font-mono text-[13px]"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowApiKey(!showApiKey)}
                                    className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-gray-400 hover:text-gray-900"
                                    title={showApiKey ? 'Hide key' : 'Show key'}
                                    aria-label={showApiKey ? 'Hide key' : 'Show key'}
                                >
                                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                            </div>
                            <Button type="submit" size="sm" className="h-9" disabled={!apiKey.trim() || !keyDirty || isSaving}>
                                {isSaving && <Loader2 className="animate-spin" />}
                                {isSaving ? 'Saving' : 'Save'}
                            </Button>
                        </form>
                    </SettingRow>
                )}
            </SettingsSection>

            {uiProvider === 'deepgram' && (
                <SettingsSection
                    title="Vocabulary"
                    description="Names, companies and jargon Deepgram should listen for."
                >
                    <SettingBlock>
                        <VocabularySettings />
                    </SettingBlock>
                </SettingsSection>
            )}
        </div>
    )
}
