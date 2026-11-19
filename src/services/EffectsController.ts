import * as vscode from 'vscode';
import { interimBurstSvg } from '../render/interimBurst';
import { svgToDataUri } from '../render/svg';
import type { Logger } from '../utils/logger';
import { safely } from '../utils/logger';
import type { DecorationSlotPool } from './DecorationRenderer';
import { editorLineHeight } from './EditorMetrics';
import type { SettingsService } from './SettingsService';
import type { KeystrokeEvent, TypingDetector } from './TypingDetector';

/**
 * Wires keystrokes to rendered bursts.
 * Phase 2: uses the interim burst SVG. Phase 3 puts the AnimationEngine/ParticleEngine behind this.
 */
export class EffectsController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly recentBursts: number[] = [];
  private burstCount = 0;

  constructor(
    private readonly settings: SettingsService,
    detector: TypingDetector,
    private readonly pool: DecorationSlotPool,
    private readonly logger: Logger,
  ) {
    this.disposables.push(
      detector.onKeystroke((e) =>
        safely(logger, 'Keystroke effect failed', () => this.onKeystroke(e)),
      ),
      settings.onDidChange(({ settings: s, changed }) => {
        if (changed.has('enabled') && !s.enabled) this.pool.clearAll();
        if (changed.has('performance.maxConcurrentBursts'))
          this.pool.resize(s['performance.maxConcurrentBursts']);
      }),
    );
  }

  /** Total bursts rendered since activation (exposed for tests and diagnostics). */
  get totalBursts(): number {
    return this.burstCount;
  }

  /** Fires a short demonstration sequence at the cursors of `editor`, ignoring the rate limit. */
  async preview(editor: vscode.TextEditor, bursts = 5, intervalMs = 160): Promise<void> {
    for (let i = 0; i < bursts; i++) {
      this.render(
        editor,
        editor.selections.map((s) => s.active),
      );
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }

  private onKeystroke(e: KeystrokeEvent): void {
    if (!this.settings.get().enabled) return;
    if (!this.allowBurst()) return;
    this.render(e.editor, e.positions);
  }

  private allowBurst(): boolean {
    const now = Date.now();
    while (this.recentBursts.length > 0 && now - (this.recentBursts[0] ?? 0) > 1000)
      this.recentBursts.shift();
    if (this.recentBursts.length >= this.settings.get()['performance.maxBurstsPerSecond'])
      return false;
    this.recentBursts.push(now);
    return true;
  }

  private render(editor: vscode.TextEditor, positions: readonly vscode.Position[]): void {
    const s = this.settings.get();
    const canvas = 96;
    const count = s.performanceMode ? Math.max(1, Math.ceil(s.particleCount / 2)) : s.particleCount;
    const placements = positions.slice(0, 8).map((position) => ({
      position,
      image: {
        uri: vscode.Uri.parse(
          svgToDataUri(
            interimBurstSvg({
              colors: s.colors,
              count,
              size: s.particleSize,
              speed: s.particleSpeed,
              lifetimeMs: s.particleLifetime,
              canvas,
            }),
          ),
        ),
        width: canvas,
        height: canvas,
      },
    }));
    if (this.pool.show(editor, placements, s.particleLifetime, editorLineHeight(editor.document))) {
      this.burstCount++;
    } else {
      this.logger.warn('Burst was not rendered');
    }
  }
}
