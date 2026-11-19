import * as vscode from 'vscode';
import type { BurstRequestOptions } from '../core/AnimationEngine';
import { AnimationEngine } from '../core/AnimationEngine';
import { qualityProfile } from '../core/quality';
import { renderBurstSvg } from '../render/SvgRenderer';
import { svgToDataUri } from '../render/svg';
import type { Logger } from '../utils/logger';
import { safely } from '../utils/logger';
import type { DecorationSlotPool } from './DecorationRenderer';
import { editorLineHeight } from './EditorMetrics';
import type { SettingsService } from './SettingsService';
import type { KeystrokeEvent, TypingDetector } from './TypingDetector';

/** Maximum cursors that get their own burst for one keystroke (multi-cursor). */
const MAX_BURST_CURSORS = 8;

/** Connects keystrokes → AnimationEngine → SvgRenderer → decoration slot pool. */
export class EffectsController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private burstCount = 0;

  constructor(
    private readonly settings: SettingsService,
    detector: TypingDetector,
    private readonly pool: DecorationSlotPool,
    private readonly logger: Logger,
    private readonly engine = new AnimationEngine(),
  ) {
    this.disposables.push(
      detector.onKeystroke((e) =>
        safely(logger, 'Keystroke effect failed', () => this.onKeystroke(e)),
      ),
      settings.onDidChange(({ settings: s, changed }) => {
        if (changed.has('enabled') && !s.enabled) this.pool.clearAll();
        if (changed.has('performance.maxConcurrentBursts')) {
          this.pool.resize(s['performance.maxConcurrentBursts']);
        }
      }),
    );
  }

  /** Total bursts rendered since activation (exposed for tests and diagnostics). */
  get totalBursts(): number {
    return this.burstCount;
  }

  get engineStats(): ReturnType<AnimationEngine['getStats']> {
    return this.engine.getStats();
  }

  /** Fires a short demonstration sequence at the cursors of `editor`, ignoring the rate limit. */
  async preview(editor: vscode.TextEditor, bursts = 5, intervalMs = 160): Promise<void> {
    for (let i = 0; i < bursts; i++) {
      this.burst(
        editor,
        editor.selections.map((s) => s.active),
        { bypassRateLimit: true },
      );
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }

  private onKeystroke(e: KeystrokeEvent): void {
    if (!this.settings.get().enabled) return;
    this.burst(e.editor, e.positions, {});
  }

  private burst(
    editor: vscode.TextEditor,
    positions: readonly vscode.Position[],
    options: BurstRequestOptions,
  ): void {
    const s = this.settings.get();
    const track = this.engine.requestBurst(s, options);
    if (!track) return; // rate-limited

    const profile = qualityProfile(s['performance.quality'], s.performanceMode);
    const rendered = renderBurstSvg(track, { glow: profile.glow });
    // One image shared by every cursor of this keystroke: one encode, one CSS rule.
    const image = {
      uri: vscode.Uri.parse(svgToDataUri(rendered.svg)),
      width: rendered.width,
      height: rendered.height,
    };
    const placements = positions
      .slice(0, MAX_BURST_CURSORS)
      .map((position) => ({ position, image }));
    if (this.pool.show(editor, placements, track.durationMs, editorLineHeight(editor.document))) {
      this.burstCount++;
    } else {
      this.logger.warn('Burst was not rendered');
    }
  }
}
