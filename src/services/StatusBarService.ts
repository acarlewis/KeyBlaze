import * as vscode from 'vscode';
import { EFFECT_LABELS } from '../config/labels';
import { PRESETS } from '../config/presets';
import type { SettingsService } from './SettingsService';

/** Status bar toggle: shows whether KeyBlaze is on. Clicking it toggles. */
export class StatusBarService implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly settings: SettingsService) {
    this.item = vscode.window.createStatusBarItem(
      'keyblaze.status',
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.name = 'KeyBlaze';
    this.item.command = 'keyblaze.toggle';
    this.subscription = settings.onDidChange(() => this.render());
    this.render();
    this.item.show();
  }

  /** Exposed for tests. */
  get text(): string {
    return this.item.text;
  }

  render(): void {
    const s = this.settings.get();
    const preset = PRESETS[s.preset].label;
    const effect = EFFECT_LABELS[s.effect];
    this.item.text = s.enabled ? '$(flame) KeyBlaze' : '$(circle-slash) KeyBlaze';
    const tooltip = new vscode.MarkdownString(undefined, true);
    tooltip.appendMarkdown(`**KeyBlaze** is ${s.enabled ? 'enabled' : 'disabled'}\n\n`);
    tooltip.appendMarkdown(`Preset: ${preset} · Effect: ${effect} · Intensity: ${s.intensity}\n\n`);
    tooltip.appendMarkdown(`Click to ${s.enabled ? 'disable' : 'enable'}.`);
    this.item.tooltip = tooltip;
    this.item.accessibilityInformation = {
      label: `KeyBlaze ${s.enabled ? 'enabled' : 'disabled'}. Activate to toggle.`,
    };
  }

  dispose(): void {
    this.subscription.dispose();
    this.item.dispose();
  }
}
