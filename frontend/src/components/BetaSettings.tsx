"use client"

import { Switch } from "./ui/switch"
import { SettingsSection, SettingRow } from "./settings/SettingsSection"
import { useConfig } from "@/contexts/ConfigContext"
import {
  BetaFeatureKey,
  BETA_FEATURE_NAMES,
  BETA_FEATURE_DESCRIPTIONS
} from "@/types/betaFeatures"

export function BetaSettings() {
  const { betaFeatures, toggleBetaFeature } = useConfig();

  // Define feature order for display (allows custom ordering)
  const featureOrder: BetaFeatureKey[] = ['importAndRetranscribe'];

  return (
    <SettingsSection
      title="Beta features"
      description="Still being tested, so expect rough edges. Turning one off hides it; your meetings are not affected."
    >
      {featureOrder.map((featureKey) => (
        <SettingRow
          key={featureKey}
          label={BETA_FEATURE_NAMES[featureKey]}
          description={BETA_FEATURE_DESCRIPTIONS[featureKey]}
          control={
            <Switch
              checked={betaFeatures[featureKey]}
              onCheckedChange={(checked) => toggleBetaFeature(featureKey, checked)}
            />
          }
        />
      ))}
    </SettingsSection>
  );
}
