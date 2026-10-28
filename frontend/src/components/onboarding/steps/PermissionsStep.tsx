import React, { useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Mic, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OnboardingContainer } from '../OnboardingContainer';
import { PermissionRow } from '../shared';
import { useOnboarding } from '@/contexts/OnboardingContext';
import type { PermissionStatus } from '@/types/onboarding';

// macOS reports real permission state (AVFoundation / TCC); elsewhere it is
// only known after the user clicks Enable.
const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');

interface AudioPermissions {
  microphone: PermissionStatus;
  systemAudio: PermissionStatus;
}

export function PermissionsStep() {
  const { setPermissionStatus, setPermissionsSkipped, permissions, completeOnboarding } = useOnboarding();
  const [isPending, setIsPending] = useState(false);

  // On macOS, read what the user already decided; undecided stays as it is
  const refreshMacPermissions = useCallback(async (): Promise<AudioPermissions | null> => {
    if (!isMac) return null;
    try {
      const current = await invoke<AudioPermissions>('get_audio_permissions');
      if (current.microphone !== 'not_determined') setPermissionStatus('microphone', current.microphone);
      if (current.systemAudio !== 'not_determined') setPermissionStatus('systemAudio', current.systemAudio);
      return current;
    } catch (err) {
      console.error('[PermissionsStep] Failed to read permissions:', err);
      return null;
    }
  }, [setPermissionStatus]);

  useEffect(() => {
    refreshMacPermissions();
  }, [refreshMacPermissions]);

  // Request microphone permission
  const handleMicrophoneAction = async () => {
    if (permissions.microphone === 'denied') {
      // Try to open system settings
      try {
        await invoke('open_system_settings', { preferencePane: 'Privacy_Microphone' });
      } catch {
        alert('Please enable microphone access in System Settings → Privacy & Security → Microphone');
      }
      return;
    }

    setIsPending(true);
    try {
      console.log('[PermissionsStep] Triggering microphone permission...');
      const granted = await invoke<boolean>('trigger_microphone_permission');
      console.log('[PermissionsStep] Microphone permission result:', granted);

      if (granted) {
        setPermissionStatus('microphone', 'authorized');
      } else {
        // Denied, or (macOS) the prompt was left unanswered
        const current = await refreshMacPermissions();
        setPermissionStatus('microphone', current?.microphone === 'not_determined' ? 'not_determined' : 'denied');
      }
    } catch (err) {
      console.error('[PermissionsStep] Failed to request microphone permission:', err);
      setPermissionStatus('microphone', 'denied');
    } finally {
      setIsPending(false);
    }
  };

  // Request system audio permission
  const handleSystemAudioAction = async () => {
    if (permissions.systemAudio === 'denied') {
      // Try to open system settings
      try {
        await invoke('open_system_settings', { preferencePane: 'Privacy_ScreenCapture' });
      } catch {
        alert('Please allow Notesify in System Settings → Privacy & Security → Screen & System Audio Recording');
      }
      return;
    }

    setIsPending(true);
    try {
      console.log('[PermissionsStep] Triggering Audio Capture permission...');
      // macOS: asks TCC for system audio access (prompting if undecided)
      const granted = await invoke<boolean>('trigger_system_audio_permission_command');
      console.log('[PermissionsStep] System audio permission result:', granted);

      if (granted) {
        setPermissionStatus('systemAudio', 'authorized');
      } else {
        const current = await refreshMacPermissions();
        setPermissionStatus('systemAudio', current?.systemAudio === 'not_determined' ? 'not_determined' : 'denied');
      }
    } catch (err) {
      console.error('[PermissionsStep] Failed to request system audio permission:', err);
      setPermissionStatus('systemAudio', 'denied');
    } finally {
      setIsPending(false);
    }
  };

  const handleFinish = async () => {
    try {
      await completeOnboarding();
      window.location.reload();
    } catch (error) {
      console.error('Failed to complete onboarding:', error);
    }
  };

  const handleSkip = async () => {
    setPermissionsSkipped(true);
    await handleFinish();
  };

  const allPermissionsGranted =
    permissions.microphone === 'authorized' &&
    permissions.systemAudio === 'authorized';

  return (
    <OnboardingContainer
      title="Grant Permissions"
      description="Notesify needs access to your microphone and system audio to record meetings"
      step={4}
      hideProgress={true}
      showNavigation={allPermissionsGranted}
      canGoNext={allPermissionsGranted}
    >
      <div className="max-w-lg mx-auto space-y-6">
        {/* Permission Rows */}
        <div className="space-y-4">
          {/* Microphone */}
          <PermissionRow
            icon={<Mic className="w-5 h-5" />}
            title="Microphone"
            description="Required to capture your voice during meetings"
            status={permissions.microphone}
            isPending={isPending}
            onAction={handleMicrophoneAction}
          />

          {/* System Audio */}
          <PermissionRow
            icon={<Volume2 className="w-5 h-5" />}
            title="System Audio"
            description="Required to capture the other side of the call"
            status={permissions.systemAudio}
            isPending={isPending}
            onAction={handleSystemAudioAction}
          />
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-3 pt-4">
          <Button onClick={handleFinish} disabled={!allPermissionsGranted} className="w-full h-11">
            Finish Setup
          </Button>

          <button
            onClick={handleSkip}
            className="text-sm text-neutral-500 hover:text-neutral-700 transition-colors"
          >
            I'll do this later
          </button>

          {!allPermissionsGranted && (
            <p className="text-xs text-center text-muted-foreground">
              Recording won't work without permissions. You can grant them later in settings.
            </p>
          )}
        </div>
      </div>
    </OnboardingContainer>
  );
}
