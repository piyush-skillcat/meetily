'use client';

import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { ArrowLeft, Settings2, Mic, AudioLines, Sparkles, FlaskConical } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { motion } from 'framer-motion';
import { TranscriptSettings } from '@/components/TranscriptSettings';
import { RecordingSettings } from '@/components/RecordingSettings';
import { PreferenceSettings } from '@/components/PreferenceSettings';
import { SummaryModelSettings } from '@/components/SummaryModelSettings';
import { BetaSettings } from '@/components/BetaSettings';
import { useConfig } from '@/contexts/ConfigContext';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

// Tabs configuration (constant)
const TABS = [
  { value: 'general', label: 'General', icon: Settings2 },
  { value: 'recording', label: 'Recordings', icon: Mic },
  { value: 'Transcriptionmodels', label: 'Transcription', icon: AudioLines },
  { value: 'summaryModels', label: 'Summary', icon: Sparkles },
  { value: 'beta', label: 'Beta', icon: FlaskConical }
] as const;

export default function SettingsPage() {
  const router = useRouter();
  const { transcriptModelConfig, setTranscriptModelConfig } = useConfig();

  // Animation state for tabs
  const [activeTab, setActiveTab] = useState('general');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [underlineStyle, setUnderlineStyle] = useState({ left: 0, width: 0 });

  // Load saved transcript configuration on mount
  useEffect(() => {
    const loadTranscriptConfig = async () => {
      try {
        const config = await invoke('api_get_transcript_config') as any;
        if (config) {
          console.log('Loaded saved transcript config:', config);
          setTranscriptModelConfig({
            provider: config.provider || 'localWhisper',
            model: config.model || 'large-v3',
            apiKey: config.apiKey || null
          });
        }
      } catch (error) {
        console.error('Failed to load transcript config:', error);
      }
    };
    loadTranscriptConfig();
  }, [setTranscriptModelConfig]);

  // Update underline position when active tab changes
  useLayoutEffect(() => {
    const activeIndex = TABS.findIndex(tab => tab.value === activeTab);
    const activeTabElement = tabRefs.current[activeIndex];

    if (activeTabElement) {
      const { offsetLeft, offsetWidth } = activeTabElement;
      setUnderlineStyle({ left: offsetLeft, width: offsetWidth });
    }
  }, [activeTab]);

  return (
    <div className="h-screen bg-white flex flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 sm:px-10 pt-10 pb-16">
          <button
            onClick={() => router.back()}
            className="-ml-1.5 mb-3 flex h-7 items-center gap-1 rounded-md px-1.5 text-[13px] text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-gray-900">Settings</h1>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
            <TabsList className="bg-transparent relative w-full justify-start gap-5 rounded-none border-b border-gray-200 p-0 h-auto">
              {TABS.map((tab, index) => {
                const Icon = tab.icon;
                return (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    ref={el => { tabRefs.current[index] = el }}
                    className="flex items-center gap-1.5 px-0 pb-2.5 pt-0 text-[13px] font-medium bg-transparent rounded-none border-0 data-[state=active]:bg-transparent data-[state=active]:text-gray-900 data-[state=active]:shadow-none text-gray-500 hover:text-gray-900 relative z-10"
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {tab.label}
                  </TabsTrigger>
                );
              })}

              <motion.div
                className="absolute -bottom-px z-20 h-0.5 bg-gray-900"
                layoutId="underline"
                style={{ left: underlineStyle.left, width: underlineStyle.width }}
                transition={{ type: 'spring', stiffness: 400, damping: 40 }}
              />
            </TabsList>

            <TabsContent value="general" className="mt-6">
              <PreferenceSettings />
            </TabsContent>
            <TabsContent value="recording" className="mt-6">
              <RecordingSettings />
            </TabsContent>
            <TabsContent value="Transcriptionmodels" className="mt-6">
              <TranscriptSettings
                transcriptModelConfig={transcriptModelConfig}
                setTranscriptModelConfig={setTranscriptModelConfig}
              />
            </TabsContent>
            <TabsContent value="summaryModels" className="mt-6">
              <SummaryModelSettings />
            </TabsContent>
            <TabsContent value="beta" className="mt-6">
              <BetaSettings />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
};
