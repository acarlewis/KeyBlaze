import * as vscode from 'vscode';
import { EFFECT_LABELS } from '../config/labels';
import { PRESETS } from '../config/presets';
import { displayThreshold } from '../core/ComboManager';
import type { ComboChange, ComboService } from './ComboService';
import type { SettingsService } from './SettingsService';

/** Status bar toggle: shows whether KeyBlaze is on. Clicking it toggles. */
export class StatusBarService implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly subscription: vscode.Disposable;
  private readonly comboSubscription: vscode.Disposable | undefined;
  private combo: Pick<ComboChange, 'count' | 'best'> = { count: 0, best: 0 };
  private comboTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly settings: SettingsService,
    comboService?: ComboService,
  ) {
    this.item = vscode.window.createStatusBarItem(
      'keyblaze.status',
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.name = 'KeyBlaze';
    this.item.command = 'keyblaze.toggle';
    this.subscription = settings.onDidChange(() => this.render());
    if (comboService) {
      this.combo = { count: 0, best: comboService.snapshot().best };
      this.comboSubscription = comboService.onDidChange((c) => {
        this.combo = c;
        // Coalesce: at most ~10 status bar updates per second while typing.
        if (c.count === 0 || c.milestone) this.render();
        else
          this.comboTimer ??= setTimeout(() => {
            this.comboTimer = undefined;
            this.render();
          }, 100);
      });
    }
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
    const showCombo =
      s.enabled &&
      s['combo.enabled'] &&
      s['combo.showInStatusBar'] &&
      this.combo.count >= displayThreshold(s['combo.milestones']);
    this.item.text = !s.enabled
      ? '$(circle-slash) KeyBlaze'
      : showCombo
        ? `$(flame) ${this.combo.count}x combo`
        : '$(flame) KeyBlaze';
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
    if (this.comboTimer !== undefined) clearTimeout(this.comboTimer);
    this.comboSubscription?.dispose();
    this.subscription.dispose();
    this.item.dispose();
  }
}
