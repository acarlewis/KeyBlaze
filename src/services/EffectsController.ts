import * as vscode from 'vscode';
import type { EngineSettings } from '../core/AnimationEngine';
import { AnimationEngine } from '../core/AnimationEngine';
import type { Milestone } from '../core/ComboManager';
import { reducedMotionOverrides } from '../core/motion';
import { TypingRate, budgetForRate, heatForRate } from '../core/typingRate';
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
import type { EnvironmentService } from './EnvironmentService';
import { caretContext } from './EditorMetrics';
import type { InlayHintTracker } from './InlayHintTracker';
import type { SettingsService } from './SettingsService';
import type { KeystrokeEvent, TypingDetector } from './TypingDetector';

/** Maximum cursors that get their own burst for one keystroke (multi-cursor). */
const MAX_BURST_CURSORS = 8;

/** Diagnostics about the most recent burst (exposed through the extension's test API). */
export interface LastBurstInfo {
  readonly effect: string;
  readonly particleCount: number;
  readonly shaken: boolean;
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
  private readonly typingRate = new TypingRate();

  constructor(
    private readonly settings: SettingsService,
    detector: TypingDetector,
    private readonly pool: DecorationSlotPool,
    private readonly logger: Logger,
    private readonly inlayHints?: InlayHintTracker,
    private readonly env?: EnvironmentService,
    private readonly engine = new AnimationEngine(),
  ) {
    if (env) {
      this.disposables.push(
        env.onDidChange((policy) => {
          // Screen reader or disabled: remove everything now. Unfocused: let running bursts finish.
          if (!policy.active && policy.reason !== 'unfocused') this.pool.clearAll();
        }),
      );
    }
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

  /**
   * Milestone celebration: a bigger, longer burst of the current effect at the carets, never
   * rate-limited, optionally with the Impact Pulse jitter.
   */
  celebrate(
    editor: vscode.TextEditor,
    positions: readonly vscode.Position[],
    milestone: Milestone,
    shake?: { amplitude: number; durationMs: number },
  ): void {
    const s = this.settings.get();
    const policy = this.env?.policy;
    if (!s.enabled || (policy && !policy.active)) return;
    this.engine.admit(s, true);
    if (policy?.reducedMotion) {
      this.burst(editor, positions, {
        ...reducedMotionOverrides(s),
        particleCount: Math.min(6, s.particleCount),
      });
      return;
    }
    const boost = 1 + 0.25 * (milestone.tier + 1);
    this.burst(
      editor,
      positions,
      {
        particleCount: Math.min(40, Math.round(s.particleCount * boost * 1.4)),
        intensity: Math.min(10, s.intensity + 1 + milestone.tier),
        particleLifetime: Math.min(2000, Math.round(s.particleLifetime * 1.25)),
      },
      shake,
      1,
    );
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }

  private onKeystroke(e: KeystrokeEvent): void {
    const s = this.settings.get();
    const policy = this.env?.policy;
    if (!s.enabled || (policy && !policy.active)) return;
    this.typingRate.hit();
    if (!this.engine.admit(s)) return; // paced: combos still count every keystroke
    if (policy?.reducedMotion) {
      this.burst(e.editor, e.positions, reducedMotionOverrides(s));
      return;
    }
    // Very fast typing: smaller bursts keep the renderer inside its budget. Typing heat lets an
    // effect grow with the pace instead (Fire burns higher); it never adds elements.
    const rate = this.typingRate.rate();
    const budget = budgetForRate(rate);
    // Fewer particles and a shorter life: fewer animated images on screen at once.
    this.burst(
      e.editor,
      e.positions,
      budget < 1
        ? {
            particleCount: Math.max(1, Math.round(s.particleCount * budget)),
            particleLifetime: Math.max(300, Math.round(s.particleLifetime * (0.5 + 0.5 * budget))),
          }
        : {},
      undefined,
      heatForRate(rate),
    );
  }

  private burst(
    editor: vscode.TextEditor,
    positions: readonly vscode.Position[],
    overrides: Partial<EngineSettings> = {},
    shake?: { amplitude: number; durationMs: number },
    heat = 0,
  ): void {
    const s = { ...this.settings.get(), ...overrides };
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
        tracks.set(
          decision.variant,
          this.engine.simulate(s, { variant: decision.variant, seed, heat }),
        );
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
          ...(shake ? { shake } : {}),
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
      this.last = {
        effect: s.effect,
        particleCount: s.particleCount,
        shaken: shake !== undefined,
        decisions: cursors.map((c) => c.decision),
        layouts,
        svgBytes,
      };
    } else {
      this.logger.warn('Burst was not rendered');
    }
  }
}
