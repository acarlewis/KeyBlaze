import * as vscode from 'vscode';
import { PRESETS } from '../config/presets';
import type { Inspector } from '../config/resolve';
import { overriddenPresetKeys, resolveSettings } from '../config/resolve';
import type { KeyBlazeSettings, PresetId, SettingKey } from '../config/schema';
import { CONFIG_SECTION, PRESETABLE_KEYS, SETTING_KEYS } from '../config/schema';

export interface SettingsChangeEvent {
  readonly settings: Readonly<KeyBlazeSettings>;
  readonly previous: Readonly<KeyBlazeSettings>;
  /** Keys whose resolved value changed. */
  readonly changed: ReadonlySet<SettingKey>;
}

/**
 * Single source of truth for resolved KeyBlaze settings. Changes apply live.
 * Resolution (explicit value → preset → default) is delegated to the pure `resolveSettings`.
 */
export class SettingsService implements vscode.Disposable {
  private current: KeyBlazeSettings;
  private readonly emitter = new vscode.EventEmitter<SettingsChangeEvent>();
  private readonly subscription: vscode.Disposable;

  readonly onDidChange = this.emitter.event;

  constructor() {
    this.current = this.read();
    this.subscription = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_SECTION)) this.reload();
    });
  }

  get(): Readonly<KeyBlazeSettings> {
    return this.current;
  }

  /** Re-reads configuration and fires `onDidChange` if any resolved value changed. */
  reload(): void {
    const previous = this.current;
    const next = this.read();
    const changed = new Set<SettingKey>();
    for (const key of SETTING_KEYS) {
      if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) changed.add(key);
    }
    this.current = next;
    if (changed.size > 0) this.emitter.fire({ settings: next, previous, changed });
  }

  /**
   * Writes a setting to the most specific scope that already defines it (workspace before user),
   * so that the change actually takes effect. Defaults to user settings.
   */
  async update<K extends SettingKey>(
    key: K,
    value: KeyBlazeSettings[K] | undefined,
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const info = config.inspect(key);
    const target =
      info?.workspaceValue !== undefined && vscode.workspace.workspaceFolders !== undefined
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
    await config.update(key, value, target);
    this.reload();
  }

  /** Activates a preset and removes user-level overrides of the keys it controls, so it shows as designed. */
  async applyPreset(id: PresetId): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const overridden = new Set(overriddenPresetKeys(this.inspector()));
    for (const key of PRESETABLE_KEYS) {
      if (!overridden.has(key) || PRESETS[id].values[key] === undefined) continue;
      await this.clearKey(config, key);
    }
    await this.update('preset', id);
  }

  /** Removes every KeyBlaze setting from user and workspace scope. */
  async resetAll(): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    for (const key of SETTING_KEYS) await this.clearKey(config, key);
    this.reload();
  }

  overriddenPresetKeys(): SettingKey[] {
    return overriddenPresetKeys(this.inspector());
  }

  dispose(): void {
    this.subscription.dispose();
    this.emitter.dispose();
  }

  private async clearKey(config: vscode.WorkspaceConfiguration, key: SettingKey): Promise<void> {
    const info = config.inspect(key);
    if (info?.globalValue !== undefined) {
      await config.update(key, undefined, vscode.ConfigurationTarget.Global);
    }
    if (info?.workspaceValue !== undefined && vscode.workspace.workspaceFolders !== undefined) {
      await config.update(key, undefined, vscode.ConfigurationTarget.Workspace);
    }
  }

  private inspector(): Inspector {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    return (key) => config.inspect(key);
  }

  private read(): KeyBlazeSettings {
    return resolveSettings(this.inspector());
  }
}
