import * as vscode from 'vscode';
import type { Milestone } from '../core/ComboManager';
import { flashSteps, impactAmplitude, impactDuration, tierColor, withAlpha } from '../core/impact';
import type { Logger } from '../utils/logger';
import { safely } from '../utils/logger';
import type { ComboService } from './ComboService';
import type { EffectsController } from './EffectsController';
import type { SettingsService } from './SettingsService';

/**
 * Milestone celebrations. Every milestone fires a bigger burst at the carets. With
 * `screenShake.enabled`, that burst (and the combo badge) jitters, and the cursor lines can flash.
 * Nothing moves the editor text.
 */
export class ImpactPulse implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  /** Whole-line background types, one per colour + alpha step (created lazily, reused). */
  private readonly flashTypes = new Map<string, vscode.TextEditorDecorationType>();
  private flashTimers: ReturnType<typeof setTimeout>[] = [];
  private activeFlash:
    { editor: vscode.TextEditor; type: vscode.TextEditorDecorationType } | undefined;
  private celebrations = 0;

  constructor(
    private readonly settings: SettingsService,
    combo: ComboService,
    private readonly effects: EffectsController,
    private readonly logger: Logger,
  ) {
    this.disposables.push(
      combo.onMilestone((m) =>
        safely(logger, 'Milestone celebration failed', () => {
          if (m.editor && m.positions) this.celebrate(m.editor, m.positions, m.milestone, m.count);
        }),
      ),
    );
  }

  get celebrationCount(): number {
    return this.celebrations;
  }

  dispose(): void {
    this.clearFlash();
    for (const d of this.disposables) d.dispose();
    for (const t of this.flashTypes.values()) t.dispose();
    this.flashTypes.clear();
  }

  private celebrate(
    editor: vscode.TextEditor,
    positions: readonly vscode.Position[],
    milestone: Milestone,
    count: number,
  ): void {
    const s = this.settings.get();
    const impact = { intensity: s['screenShake.intensity'], durationMs: s['screenShake.duration'] };
    const shake = s['screenShake.enabled']
      ? {
          amplitude: impactAmplitude(impact, milestone),
          durationMs: impactDuration(impact, milestone),
        }
      : undefined;
    this.effects.celebrate(editor, positions, milestone, shake);
    this.celebrations++;
    if (shake && s['screenShake.flashLine']) {
      this.flash(
        editor,
        positions,
        tierColor(count, s['combo.milestones'], s.colors),
        shake.durationMs,
        milestone,
      );
    }
  }

  private flash(
    editor: vscode.TextEditor,
    positions: readonly vscode.Position[],
    color: string,
    durationMs: number,
    milestone: Milestone,
  ): void {
    this.clearFlash();
    const lines = [...new Set(positions.map((p) => p.line))].map(
      (l) => new vscode.Range(l, 0, l, 0),
    );
    for (const step of flashSteps(durationMs, milestone)) {
      this.flashTimers.push(
        setTimeout(() => {
          try {
            if (this.activeFlash) this.activeFlash.editor.setDecorations(this.activeFlash.type, []);
            this.activeFlash = undefined;
            if (step.alpha <= 0) return;
            const type = this.flashType(color, step.alpha);
            editor.setDecorations(type, lines);
            this.activeFlash = { editor, type };
          } catch {
            // Editor closed mid-flash.
          }
        }, step.atMs),
      );
    }
  }

  private flashType(color: string, alpha: number): vscode.TextEditorDecorationType {
    const key = `${color}|${alpha.toFixed(3)}`;
    let type = this.flashTypes.get(key);
    if (!type) {
      type = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        backgroundColor: withAlpha(color, alpha),
      });
      this.flashTypes.set(key, type);
    }
    return type;
  }

  private clearFlash(): void {
    for (const t of this.flashTimers) clearTimeout(t);
    this.flashTimers = [];
    if (this.activeFlash) {
      try {
        this.activeFlash.editor.setDecorations(this.activeFlash.type, []);
      } catch {
        // ignore
      }
    }
    this.activeFlash = undefined;
  }
}
