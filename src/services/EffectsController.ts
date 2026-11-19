import * as vscode from 'vscode';
import { AnimationEngine } from '../core/AnimationEngine';
import type { BurstTrack } from '../core/BurstTrack';
import type { AnchorDecision, EffectVariant, Layout } from '../core/placement';
import { decideAnchor, layoutBurst } from '../core/placement';
import { qualityProfile } from '../core/quality';
import { randomSeed } from '../core/random';
import { renderBurstSvg } from '../render/SvgRenderer';
import { svgToDataUri } from '../render/svg';
import type { Logger } from '../utils/logger';
import { safely } from '../utils/logger';
import type { DecorationSlotPool, PlacedImage } from './DecorationRenderer';
import { caretContext } from './EditorMetrics';
import type { InlayHintTracker } from './InlayHintTracker';
import type { SettingsService } from './SettingsService';
import type { KeystrokeEvent, TypingDetector } from './TypingDetector';

/** Maximum cursors that get their own burst for one keystroke (multi-cursor). */
const MAX_BURST_CURSORS = 8;

/** Diagnostics about the most recent burst (exposed through the extension's test API). */
export interface LastBurstInfo {
  readonly decisions: readonly AnchorDecision[];
  readonly layouts: readonly Layout[];
  readonly svgBytes: number;
}

/**
 * Keystroke → rate limit → per-cursor anchor decision → simulation (one per variant) →
 * per-cursor layout → unique SVG per distinct layout → decoration slot.
 */
export class EffectsController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private burstCount = 0;
  private nonce = 0;
  private last: LastBurstInfo | undefined;

  constructor(
    private readonly settings: SettingsService,
    detector: TypingDetector,
    private readonly pool: DecorationSlotPool,
    private readonly logger: Logger,
    private readonly inlayHints?: InlayHintTracker,
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

  get lastBurst(): LastBurstInfo | undefined {
    return this.last;
  }

  /** Fires a short demonstration sequence at the cursors of `editor`, ignoring the rate limit. */
  async preview(editor: vscode.TextEditor, bursts = 5, intervalMs = 160): Promise<void> {
    for (let i = 0; i < bursts; i++) {
      if (this.engine.admit(this.settings.get(), true)) {
        this.burst(
          editor,
          editor.selections.map((s) => s.active),
        );
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }

  private onKeystroke(e: KeystrokeEvent): void {
    const s = this.settings.get();
    if (!s.enabled) return;
    if (!this.engine.admit(s)) return; // paced: combos (Phase 5) still count every keystroke
    this.burst(e.editor, e.positions);
  }

  private burst(editor: vscode.TextEditor, positions: readonly vscode.Position[]): void {
    const s = this.settings.get();
    const profile = qualityProfile(s['performance.quality'], s.performanceMode);
    const cursors = positions.slice(0, MAX_BURST_CURSORS).map((position) => {
      const ctx = caretContext(editor, position, s.placement, this.inlayHints);
      return { ctx, decision: decideAnchor(ctx, profile.maxHalfExtent) };
    });

    // One simulation per variant needed by this keystroke (usually one).
    const seed = randomSeed();
    const tracks = new Map<EffectVariant, BurstTrack>();
    for (const { decision } of cursors) {
      if (!tracks.has(decision.variant)) {
        tracks.set(decision.variant, this.engine.simulate(s, { variant: decision.variant, seed }));
      }
    }

    // One unique SVG per distinct layout. Cursors with identical layouts share an image (same start time).
    const images: PlacedImage[] = [];
    const uriByKey = new Map<string, vscode.Uri>();
    const layouts: Layout[] = [];
    let svgBytes = 0;
    let duration = s.particleLifetime;
    for (const { ctx, decision } of cursors) {
      const track = tracks.get(decision.variant);
      if (!track) continue;
      duration = track.durationMs;
      const layout = layoutBurst(track, decision.mode, ctx);
      const key = `${decision.variant}|${layout.width}|${layout.height}|${layout.originY}`;
      let uri = uriByKey.get(key);
      if (!uri) {
        const rendered = renderBurstSvg(track, {
          glow: profile.glow,
          height: layout.height,
          originY: layout.originY,
          nonce: `${Date.now().toString(36)}.${(++this.nonce).toString(36)}`,
        });
        svgBytes += rendered.svg.length;
        uri = vscode.Uri.parse(svgToDataUri(rendered.svg));
        uriByKey.set(key, uri);
      }
      layouts.push(layout);
      images.push({ layout, uri });
    }

    if (this.pool.show(editor, images, duration)) {
      this.burstCount++;
      this.last = { decisions: cursors.map((c) => c.decision), layouts, svgBytes };
    } else {
      this.logger.warn('Burst was not rendered');
    }
  }
}
