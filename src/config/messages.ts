/**
 * Control Panel message protocol, shared by the extension host and the webview (pure, no `vscode`).
 * Every message from the webview is untrusted input and is validated with `parseWebviewMessage`.
 */
import type { PresetValues } from './presets';
import type { EffectId, KeyBlazeSettings, PresetId, SettingKey } from './schema';
import { EFFECT_IDS, PRESET_IDS, SETTING_KEYS } from './schema';

export interface PanelPreset {
  readonly id: PresetId;
  readonly label: string;
  readonly description: string;
  readonly values: PresetValues;
}

export interface PanelEffect {
  readonly id: EffectId;
  readonly label: string;
  readonly description: string;
}

export interface PanelState {
  readonly settings: KeyBlazeSettings;
  /** Presetable keys the user has explicitly overridden. */
  readonly overridden: readonly SettingKey[];
  readonly presets: readonly PanelPreset[];
  readonly effects: readonly PanelEffect[];
  readonly version: string;
  readonly vscodeVersion: string;
  readonly bestCombo: number;
}

export type HostMessage =
  | { readonly type: 'state'; readonly state: PanelState }
  | { readonly type: 'notice'; readonly level: 'info' | 'error'; readonly text: string };

export const PANEL_COMMANDS = ['toggle', 'previewInEditor', 'openSettings', 'openDocs'] as const;
export type PanelCommand = (typeof PANEL_COMMANDS)[number];

export type WebviewMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'update'; readonly key: SettingKey; readonly value: unknown }
  | { readonly type: 'resetKey'; readonly key: SettingKey }
  | { readonly type: 'applyPreset'; readonly id: PresetId }
  | { readonly type: 'resetAll' }
  | { readonly type: 'command'; readonly command: PanelCommand }
  | { readonly type: 'error'; readonly message: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isSettingKey = (v: unknown): v is SettingKey =>
  typeof v === 'string' && (SETTING_KEYS as string[]).includes(v);

/**
 * Validates a raw message from the webview. Returns `undefined` for anything malformed or unknown.
 * Setting values are validated separately against the settings schema by the host.
 */
export function parseWebviewMessage(raw: unknown): WebviewMessage | undefined {
  if (!isObject(raw) || typeof raw.type !== 'string') return undefined;
  switch (raw.type) {
    case 'ready':
    case 'resetAll':
      return { type: raw.type };
    case 'update':
      return isSettingKey(raw.key) && 'value' in raw
        ? { type: 'update', key: raw.key, value: raw.value }
        : undefined;
    case 'resetKey':
      return isSettingKey(raw.key) ? { type: 'resetKey', key: raw.key } : undefined;
    case 'applyPreset':
      return typeof raw.id === 'string' && (PRESET_IDS as readonly string[]).includes(raw.id)
        ? { type: 'applyPreset', id: raw.id as PresetId }
        : undefined;
    case 'command':
      return typeof raw.command === 'string' &&
        (PANEL_COMMANDS as readonly string[]).includes(raw.command)
        ? { type: 'command', command: raw.command as PanelCommand }
        : undefined;
    case 'error':
      return typeof raw.message === 'string'
        ? { type: 'error', message: raw.message.slice(0, 2000) }
        : undefined;
    default:
      return undefined;
  }
}

export function isEffectId(v: unknown): v is EffectId {
  return typeof v === 'string' && (EFFECT_IDS as readonly string[]).includes(v);
}
