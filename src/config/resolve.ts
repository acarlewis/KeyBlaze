import { PRESETS } from './presets';
import type { KeyBlazeSettings, SettingKey } from './schema';
import { PRESETABLE_KEYS, SETTING_KEYS, SETTING_SPECS, defaultSettings } from './schema';

/** Subset of `WorkspaceConfiguration.inspect()` that resolution needs. */
export interface InspectLike {
  globalValue?: unknown;
  workspaceValue?: unknown;
  workspaceFolderValue?: unknown;
}

export type Inspector = (key: SettingKey) => InspectLike | undefined;

/** The most specific value the user explicitly set, if any. */
export function explicitValue(info: InspectLike | undefined): unknown {
  if (!info) return undefined;
  return info.workspaceFolderValue ?? info.workspaceValue ?? info.globalValue;
}

/**
 * Resolution order per key: valid explicit user value → active preset value → default.
 * Invalid explicit values are ignored rather than breaking the extension.
 */
export function resolveSettings(inspect: Inspector): KeyBlazeSettings {
  const result = defaultSettings() as unknown as Record<SettingKey, unknown>;
  const explicit = (key: SettingKey): unknown =>
    SETTING_SPECS[key].validate(explicitValue(inspect(key)));

  const preset =
    (explicit('preset') as KeyBlazeSettings['preset'] | undefined) ?? SETTING_SPECS.preset.default;
  const presetValues = PRESETS[preset].values as Partial<Record<SettingKey, unknown>>;
  const presetable = new Set<SettingKey>(PRESETABLE_KEYS);

  for (const key of SETTING_KEYS) {
    const userValue = explicit(key);
    if (userValue !== undefined) {
      result[key] = userValue;
    } else if (presetable.has(key) && presetValues[key] !== undefined) {
      const pv = presetValues[key];
      result[key] = Array.isArray(pv) ? [...(pv as unknown[])] : pv;
    }
  }
  result.preset = preset;
  return result as unknown as KeyBlazeSettings;
}

/** Presetable keys the user has explicitly overridden (useful for UI and preset application). */
export function overriddenPresetKeys(inspect: Inspector): SettingKey[] {
  return PRESETABLE_KEYS.filter((key) => explicitValue(inspect(key)) !== undefined);
}
