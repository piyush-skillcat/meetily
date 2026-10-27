import React, { useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { FolderOpen } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { DeviceSelection, SelectedDevices } from '@/components/DeviceSelection';
import Analytics from '@/lib/analytics';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SettingsSection, SettingRow, SettingBlock } from '@/components/settings/SettingsSection';

export interface RecordingPreferences {
  save_folder: string;
  auto_save: boolean;
  file_format: string;
  preferred_mic_device: string | null;
  preferred_system_device: string | null;
}

interface RecordingSettingsProps {
  onSave?: (preferences: RecordingPreferences) => void;
}

export function RecordingSettings({ onSave }: RecordingSettingsProps) {
  const [preferences, setPreferences] = useState<RecordingPreferences>({
    save_folder: '',
    auto_save: true,
    file_format: 'mp4',
    preferred_mic_device: null,
    preferred_system_device: null
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showRecordingNotification, setShowRecordingNotification] = useState(true);

  // Load recording preferences on component mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const prefs = await invoke<RecordingPreferences>('get_recording_preferences');
        setPreferences(prefs);
      } catch (error) {
        console.error('Failed to load recording preferences:', error);
        // If loading fails, get default folder path
        try {
          const defaultPath = await invoke<string>('get_default_recordings_folder_path');
          setPreferences(prev => ({ ...prev, save_folder: defaultPath }));
        } catch (defaultError) {
          console.error('Failed to get default folder path:', defaultError);
        }
      } finally {
        setLoading(false);
      }
    };

    loadPreferences();
  }, []);

  // Load recording notification preference
  useEffect(() => {
    const loadNotificationPref = async () => {
      try {
        const { Store } = await import('@tauri-apps/plugin-store');
        const store = await Store.load('preferences.json');
        const show = await store.get<boolean>('show_recording_notification') ?? true;
        setShowRecordingNotification(show);
      } catch (error) {
        console.error('Failed to load notification preference:', error);
      }
    };
    loadNotificationPref();
  }, []);

  const handleAutoSaveToggle = async (enabled: boolean) => {
    const newPreferences = { ...preferences, auto_save: enabled };
    setPreferences(newPreferences);
    await savePreferences(newPreferences);

    // Track auto-save setting change
    await Analytics.track('auto_save_recording_toggled', {
      enabled: enabled.toString()
    });
  };

  const handleDeviceChange = async (devices: SelectedDevices) => {
    const newPreferences = {
      ...preferences,
      preferred_mic_device: devices.micDevice,
      preferred_system_device: devices.systemDevice
    };
    setPreferences(newPreferences);
    await savePreferences(newPreferences, true);

    // Track default device preference changes
    // Note: Individual device selection analytics are tracked in DeviceSelection component
    await Analytics.track('default_devices_changed', {
      has_preferred_microphone: (!!devices.micDevice).toString(),
      has_preferred_system_audio: (!!devices.systemDevice).toString()
    });
  };

  const handleOpenFolder = async () => {
    try {
      await invoke('open_recordings_folder');
    } catch (error) {
      console.error('Failed to open recordings folder:', error);
    }
  };

  const handleNotificationToggle = async (enabled: boolean) => {
    try {
      setShowRecordingNotification(enabled);
      const { Store } = await import('@tauri-apps/plugin-store');
      const store = await Store.load('preferences.json');
      await store.set('show_recording_notification', enabled);
      await store.save();
      toast.success('Recording settings saved');
      await Analytics.track('recording_notification_preference_changed', {
        enabled: enabled.toString()
      });
    } catch (error) {
      console.error('Failed to save notification preference:', error);
      toast.error('Failed to save preference');
    }
  };

  const savePreferences = async (prefs: RecordingPreferences, describeDevices = false) => {
    setSaving(true);
    try {
      await invoke('set_recording_preferences', { preferences: prefs });
      onSave?.(prefs);

      toast.success('Recording settings saved', describeDevices ? {
        description: `Microphone: ${prefs.preferred_mic_device || 'Default'}. System audio: ${prefs.preferred_system_device || 'Default'}.`
      } : undefined);
    } catch (error) {
      toast.error('Could not save recording settings', {
        description: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-24 bg-gray-100 rounded-xl"></div>
        <div className="h-40 bg-gray-100 rounded-xl"></div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SettingsSection title="Audio files" description="What happens to the meeting audio once a recording stops.">
        <SettingRow
          label="Save audio recordings"
          description={
            preferences.auto_save
              ? `Saved as ${preferences.file_format.toUpperCase()} files named recording_YYYYMMDD_HHMMSS.${preferences.file_format}.`
              : 'Off: only the transcript and notes are kept.'
          }
          control={
            <Switch
              checked={preferences.auto_save}
              onCheckedChange={handleAutoSaveToggle}
              disabled={saving}
            />
          }
        />
        {preferences.auto_save && (
          <SettingRow
            label="Save location"
            description={<span className="font-mono text-[12px] break-all">{preferences.save_folder || 'Default folder'}</span>}
            control={
              <Button variant="outline" size="sm" onClick={handleOpenFolder}>
                <FolderOpen />
                Open
              </Button>
            }
          />
        )}
        <SettingRow
          label="Remind me to tell participants"
          description="When a recording starts, show a reminder to let everyone know they are being recorded."
          control={
            <Switch
              checked={showRecordingNotification}
              onCheckedChange={handleNotificationToggle}
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        title="Default devices"
        description="Picked automatically when a new recording starts. You can still change them on the recording screen."
      >
        <SettingBlock>
          <DeviceSelection
            selectedDevices={{
              micDevice: preferences.preferred_mic_device,
              systemDevice: preferences.preferred_system_device
            }}
            onDeviceChange={handleDeviceChange}
            disabled={saving}
          />
        </SettingBlock>
      </SettingsSection>
    </div>
  );
}
