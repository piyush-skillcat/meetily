import React, { useContext, useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Loader2, Copy, Check } from 'lucide-react';
import { SettingsSection, SettingRow } from './settings/SettingsSection';
import { AnalyticsContext } from './AnalyticsProvider';
import { load } from '@tauri-apps/plugin-store';
import { invoke } from '@tauri-apps/api/core';
import { Analytics } from '@/lib/analytics';
import AnalyticsDataModal from './AnalyticsDataModal';

const ANALYTICS_DEFAULT_OFF_MIGRATION_KEY = 'analyticsDefaultOffMigrationV1';

export default function AnalyticsConsentSwitch() {
  const { setIsAnalyticsOptedIn, isAnalyticsOptedIn } = useContext(AnalyticsContext);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [userId, setUserId] = useState<string>('');
  const [isCopied, setIsCopied] = useState(false);

  // Note: Store loading is handled by AnalyticsProvider to avoid race conditions

  useEffect(() => {
    const loadUserId = async () => {
      if (isAnalyticsOptedIn) {
        try {
          const id = await Analytics.getPersistentUserId();
          setUserId(id);
        } catch (error) {
          console.error('Failed to load user ID:', error);
        }
      } else {
        setUserId('');
      }
    };
    loadUserId();
  }, [isAnalyticsOptedIn]);

  const handleCopyUserId = async () => {
    if (!userId) return;

    try {
      await navigator.clipboard.writeText(userId);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);

      // Track that user copied their ID
      await Analytics.track('user_id_copied', {
        user_id: userId
      });
    } catch (error) {
      console.error('Failed to copy user ID:', error);
    }
  };

  const handleToggle = async (enabled: boolean) => {
    // If user is trying to DISABLE, show the modal first
    if (!enabled) {
      setShowModal(true);
      // Track that user viewed the transparency modal
      try {
        await invoke('track_analytics_transparency_viewed');
      } catch (error) {
        console.error('Failed to track transparency view:', error);
      }
      return; // Don't disable yet, wait for modal confirmation
    }

    // If ENABLING, proceed immediately
    await performToggle(enabled);
  };

  const performToggle = async (enabled: boolean) => {
    // Optimistic update - immediately update UI state
    setIsAnalyticsOptedIn(enabled);
    setIsProcessing(true);

    try {
      const store = await load('analytics.json', {
        autoSave: false,
        defaults: {
          analyticsOptedIn: false
        }
      });
      await store.set('analyticsOptedIn', enabled);
      await store.set(ANALYTICS_DEFAULT_OFF_MIGRATION_KEY, true);
      await store.save();

      if (enabled) {
        // Full analytics initialization (same as AnalyticsProvider)
        const userId = await Analytics.getPersistentUserId();

        // Initialize analytics
        await Analytics.init();

        // Identify user with enhanced properties immediately after init
        await Analytics.identify(userId, {
          app_version: '0.4.0',
          platform: 'tauri',
          first_seen: new Date().toISOString(),
          os: navigator.platform,
        });

        // Start analytics session with the same user ID
        await Analytics.startSession(userId);

        // Track app started (re-enabled)
        await Analytics.trackAppStarted();

        // Track that user enabled analytics
        try {
          await invoke('track_analytics_enabled');
        } catch (error) {
          console.error('Failed to track analytics enabled:', error);
        }

        console.log('Analytics re-enabled successfully');
      } else {
        // Track that user disabled analytics BEFORE disabling
        try {
          await invoke('track_analytics_disabled');
        } catch (error) {
          console.error('Failed to track analytics disabled:', error);
        }

        await Analytics.disable();
        console.log('Analytics disabled successfully');
      }
    } catch (error) {
      console.error('Failed to toggle analytics:', error);
      // Revert the optimistic update on error
      setIsAnalyticsOptedIn(!enabled);
      // You could also show a toast notification here to inform the user
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmDisable = async () => {
    setShowModal(false);
    await performToggle(false);
  };

  const handleCancelDisable = () => {
    setShowModal(false);
    // Keep analytics enabled, no state change needed
  };

  const handlePrivacyPolicyClick = async () => {
    try {
      await invoke('open_external_url', { url: 'https://github.com/Zackriya-Solutions/meeting-minutes/blob/main/PRIVACY_POLICY.md' });
    } catch (error) {
      console.error('Failed to open privacy policy link:', error);
    }
  };

  return (
    <>
      <SettingsSection
        title="Usage analytics"
        description="Off by default. When on, anonymous product and performance data is shared; meeting content never is."
      >
        <SettingRow
          label="Share usage analytics"
          description={isProcessing ? 'Updating…' : undefined}
          control={
            <div className="flex items-center gap-2">
              {isProcessing && <Loader2 className="w-4 h-4 animate-spin text-gray-500" />}
              <Switch
                checked={isAnalyticsOptedIn}
                onCheckedChange={handleToggle}
                disabled={isProcessing}
              />
            </div>
          }
        />

        {isAnalyticsOptedIn && userId && (
          <SettingRow
            label="Your user ID"
            description="Include it when you report a problem so the logs can be found."
          >
            <div className="flex items-center gap-2">
              <code className="font-mono text-[12px] flex-1 truncate rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-gray-900">
                {userId}
              </code>
              <Button onClick={handleCopyUserId} variant="outline" size="sm" title="Copy user ID">
                {isCopied ? <Check /> : <Copy />}
                {isCopied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </SettingRow>
        )}

        <SettingRow
          label="Privacy policy"
          description="Meetings, transcripts and recordings stay on this computer."
          control={
            <Button variant="ghost" size="sm" onClick={handlePrivacyPolicyClick}>
              View
            </Button>
          }
        />
      </SettingsSection>

      {/* 2-Step Opt-Out Modal */}
      <AnalyticsDataModal
        isOpen={showModal}
        onClose={handleCancelDisable}
        onConfirmDisable={handleConfirmDisable}
      />
    </>
  );
}
