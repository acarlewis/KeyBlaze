import * as vscode from 'vscode';
import { EFFECT_DESCRIPTIONS, EFFECT_LABELS } from '../config/labels';
import { PRESETS } from '../config/presets';
import type { EffectId, PresetId } from '../config/schema';
import { EFFECT_IDS, PRESET_IDS } from '../config/schema';
import type { ControlPanelProvider } from '../providers/ControlPanelProvider';
import type { DecorationSlotPool } from '../services/DecorationRenderer';
import type { EffectsController } from '../services/EffectsController';
import type { SettingsService } from '../services/SettingsService';
import { cycle } from '../utils/cycle';
import type { Logger } from '../utils/logger';

export const COMMAND_IDS = {
  enable: 'keyblaze.enable',
  disable: 'keyblaze.disable',
  toggle: 'keyblaze.toggle',
  openControlPanel: 'keyblaze.openControlPanel',
  changeEffect: 'keyblaze.changeEffect',
  nextEffect: 'keyblaze.nextEffect',
  previousEffect: 'keyblaze.previousEffect',
  applyPreset: 'keyblaze.applyPreset',
  previewEffect: 'keyblaze.previewEffect',
  resetSettings: 'keyblaze.resetSettings',
} as const;

export interface CommandDeps {
  readonly context: vscode.ExtensionContext;
  readonly settings: SettingsService;
  readonly effects: EffectsController;
  readonly pool: DecorationSlotPool;
  readonly logger: Logger;
  readonly controlPanel: ControlPanelProvider;
}

export interface ResetOptions {
  /** Skip the confirmation dialog (used by tests and other commands). */
  readonly skipConfirmation?: boolean;
}

type PickItem = vscode.QuickPickItem & { effect?: EffectId; preset?: PresetId };

export function registerCommands(deps: CommandDeps): vscode.Disposable[] {
  const { settings, logger } = deps;

  const guarded =
    <A extends unknown[]>(id: string, fn: (...args: A) => unknown) =>
    async (...args: A): Promise<void> => {
      try {
        await fn(...args);
      } catch (err) {
        logger.error(`Command ${id} failed`, err);
        void vscode.window.showErrorMessage(
          `KeyBlaze: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    };

  const register = <A extends unknown[]>(
    id: string,
    fn: (...args: A) => unknown,
  ): vscode.Disposable => vscode.commands.registerCommand(id, guarded(id, fn));

  const setEffect = async (effect: EffectId): Promise<void> => {
    await settings.update('effect', effect);
    vscode.window.setStatusBarMessage(`KeyBlaze: ${EFFECT_LABELS[effect]}`, 2500);
  };

  const applyPreset = async (preset: PresetId): Promise<void> => {
    await settings.applyPreset(preset);
    vscode.window.setStatusBarMessage(`KeyBlaze: ${PRESETS[preset].label} preset`, 2500);
  };

  return [
    register(COMMAND_IDS.enable, () => settings.update('enabled', true)),
    register(COMMAND_IDS.disable, () => settings.update('enabled', false)),
    register(COMMAND_IDS.toggle, () => settings.update('enabled', !settings.get().enabled)),
    register(COMMAND_IDS.openControlPanel, () => deps.controlPanel.show()),

    register(COMMAND_IDS.nextEffect, () => setEffect(cycle(EFFECT_IDS, settings.get().effect, 1))),
    register(COMMAND_IDS.previousEffect, () =>
      setEffect(cycle(EFFECT_IDS, settings.get().effect, -1)),
    ),

    register(COMMAND_IDS.changeEffect, async (effect?: unknown) => {
      if (typeof effect === 'string' && (EFFECT_IDS as readonly string[]).includes(effect)) {
        return setEffect(effect as EffectId);
      }
      const s = settings.get();
      const items: PickItem[] = [
        { label: 'Presets', kind: vscode.QuickPickItemKind.Separator },
        ...PRESET_IDS.map((id) => ({
          label: `${id === s.preset ? '$(check) ' : ''}${PRESETS[id].label}`,
          description: PRESETS[id].description,
          preset: id,
        })),
        { label: 'Effects', kind: vscode.QuickPickItemKind.Separator },
        ...EFFECT_IDS.map((id) => ({
          label: `${id === s.effect ? '$(check) ' : ''}${EFFECT_LABELS[id]}`,
          description: EFFECT_DESCRIPTIONS[id],
          effect: id,
        })),
      ];
      const picked = await vscode.window.showQuickPick(items, {
        title: 'KeyBlaze: Change Effect',
        placeHolder: 'Pick a preset (complete look) or a base effect',
        matchOnDescription: true,
      });
      if (picked?.preset) return applyPreset(picked.preset);
      if (picked?.effect) return setEffect(picked.effect);
      return undefined;
    }),

    register(COMMAND_IDS.applyPreset, async (preset?: unknown) => {
      if (typeof preset === 'string' && (PRESET_IDS as readonly string[]).includes(preset)) {
        return applyPreset(preset as PresetId);
      }
      const current = settings.get().preset;
      const picked = await vscode.window.showQuickPick(
        PRESET_IDS.map((id) => ({
          label: `${id === current ? '$(check) ' : ''}${PRESETS[id].label}`,
          description: PRESETS[id].description,
          id,
        })),
        { title: 'KeyBlaze: Apply Preset', matchOnDescription: true },
      );
      return picked ? applyPreset(picked.id) : undefined;
    }),

    register(COMMAND_IDS.previewEffect, async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showInformationMessage(
          'KeyBlaze: Open a text editor to preview the current effect.',
        );
        return;
      }
      await deps.effects.preview(editor);
    }),

    register(COMMAND_IDS.resetSettings, async (options?: ResetOptions) => {
      if (!options?.skipConfirmation) {
        const answer = await vscode.window.showWarningMessage(
          'Reset all KeyBlaze settings to their defaults? This clears user and workspace values.',
          { modal: true },
          'Reset',
        );
        if (answer !== 'Reset') return;
      }
      await settings.resetAll();
      vscode.window.setStatusBarMessage('KeyBlaze: settings reset', 2500);
    }),
  ];
}
