import * as vscode from 'vscode';
import type { EngineSettings } from '../core/AnimationEngine';
import { AnimationEngine, RateLimiter } from '../core/AnimationEngine';
import { decideAnchor, layoutBurst } from '../core/placement';
import { qualityProfile } from '../core/quality';
import type { Effect } from '../effects/Effect';
import { MinimalEffect } from '../effects/MinimalEffect';
import type { AuraKind } from '../render/CursorAura';
import { auraExtents, renderAura } from '../render/CursorAura';
import { renderBurstSvg } from '../render/SvgRenderer';
import { svgToDataUri } from '../render/svg';
import type { Logger } from '../utils/logger';
import { safely } from '../utils/logger';
import { DecorationSlotPool } from './DecorationRenderer';
import { caretContext, editorFontMetrics } from './EditorMetrics';
import type { EnvironmentService } from './EnvironmentService';
import type { InlayHintTracker } from './InlayHintTracker';
import type { SettingsService } from './SettingsService';
import type { TypingDetector } from './TypingDetector';

const MAX_CURSORS = 8;
/** Selection changes this soon after an edit are caused by typing, not by navigation. */
const EDIT_SUPPRESS_MS = 120;
/** Aura moves at most 10×/s: each move with a new column margin adds a CSS rule. */
const AURA_THROTTLE_MS = 100;
/**
 * The aura pulses while the caret is in use and rests (a static image) after this long without caret
 * activity. A looping SMIL image makes Chromium paint every display frame (about a quarter to almost
 * half of a CPU core, measured), which an idle editor should not pay for indefinitely.
 */
export const AURA_REST_MS = 5000;

/** A single fading dot left behind where the caret was (trail effect). */
const TrailDot: Effect = {
  id: 'minimal',
  naturalShape: 'circle',
  spawn(emitter, params) {
    emitter.particle({
      vx: 0,
      vy: 0,
      size: params.size * 0.9,
      sizeEnd: 0.25,
      life: 1,
      color: params.colors[0] ?? '#ffffff',
      shape: 'circle',
      glow: params.glow ? 0.5 : 0,
    });
  },
};

/**
 * Optional cursor effects (`keyblaze.cursor.effect`), following the real caret of the active editor:
 * - glow / ring: an aura at every caret, moved on each selection change (throttled). It pulses
 *   while the caret is active and rests as a static image after AURA_REST_MS without activity.
 * - sparks / trail: one-shot effects when the caret is moved by navigation (not by typing, which
 *   already produces bursts). Sparks pop at the new position; trail leaves a fading dot at the old one.
 */
export class CursorEffects implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly auraType = vscode.window.createTextEditorDecorationType({
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
  });
  private readonly pool: DecorationSlotPool;
  private readonly engine = new AnimationEngine();
  private readonly limiter = new RateLimiter();
  private readonly auraUris = new Map<string, vscode.Uri>();
  private readonly lastEditAt = new Map<string, number>();
  private readonly lastCaret = new WeakMap<vscode.TextEditor, vscode.Position>();
  private auraEditor: vscode.TextEditor | undefined;
  private auraTimer: ReturnType<typeof setTimeout> | undefined;
  private auraRestTimer: ReturnType<typeof setTimeout> | undefined;
  private auraAnimated = false;
  private nonce = 0;
  private oneShots = 0;

  constructor(
    private readonly settings: SettingsService,
    private readonly detector: TypingDetector,
    private readonly inlayHints: InlayHintTracker | undefined,
    private readonly logger: Logger,
    private readonly env?: EnvironmentService,
  ) {
    this.pool = new DecorationSlotPool(6, logger);
    if (env) {
      this.disposables.push(
        env.onDidChange(() => {
          this.auraUris.clear(); // animated vs static images
          this.clearAura();
          this.pool.clearAll();
          const editor = vscode.window.activeTextEditor;
          if (editor) this.scheduleAura(editor);
        }),
      );
    }
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) =>
        this.lastEditAt.set(e.document.uri.toString(), Date.now()),
      ),
      // Without this the map keeps one entry per document ever edited (output channels included).
      vscode.workspace.onDidCloseTextDocument((doc) => this.lastEditAt.delete(doc.uri.toString())),
      vscode.window.onDidChangeTextEditorSelection((e) =>
        safely(logger, 'Cursor effect failed', () => this.onSelection(e)),
      ),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.clearAura();
        if (editor) this.scheduleAura(editor);
      }),
      settings.onDidChange(({ changed }) => {
        if (
          changed.has('colors') ||
          changed.has('cursor.effect') ||
          changed.has('performance.quality')
        ) {
          this.auraUris.clear();
        }
        this.clearAura();
        this.pool.clearAll();
        const editor = vscode.window.activeTextEditor;
        if (editor) this.scheduleAura(editor);
      }),
    );
    const editor = vscode.window.activeTextEditor;
    if (editor) this.scheduleAura(editor);
  }

  /** Diagnostics for tests. */
  get stats(): {
    auraVisible: boolean;
    auraAnimated: boolean;
    oneShots: number;
    trackedDocuments: number;
  } {
    return {
      auraVisible: this.auraEditor !== undefined,
      auraAnimated: this.auraEditor !== undefined && this.auraAnimated,
      oneShots: this.oneShots,
      trackedDocuments: this.lastEditAt.size,
    };
  }

  dispose(): void {
    if (this.auraTimer !== undefined) clearTimeout(this.auraTimer);
    this.clearRestTimer();
    for (const d of this.disposables) d.dispose();
    this.auraType.dispose();
    this.pool.dispose();
  }

  private active(editor: vscode.TextEditor): boolean {
    const s = this.settings.get();
    return (
      s.enabled &&
      (this.env?.policy.active ?? true) &&
      s['cursor.effect'] !== 'none' &&
      editor === vscode.window.activeTextEditor &&
      this.detector.isDocumentEligible(editor.document)
    );
  }

  private onSelection(e: vscode.TextEditorSelectionChangeEvent): void {
    const editor = e.textEditor;
    const previous = this.lastCaret.get(editor);
    this.lastCaret.set(editor, editor.selection.active);
    if (!this.active(editor)) return;
    const effect = this.settings.get()['cursor.effect'];
    if (effect === 'glow' || effect === 'ring') {
      this.scheduleAura(editor);
      return;
    }
    // sparks / trail: navigation only, and not under reduced motion.
    if (this.env?.policy.reducedMotion) return;
    const editedAt = this.lastEditAt.get(editor.document.uri.toString()) ?? 0;
    if (Date.now() - editedAt < EDIT_SUPPRESS_MS) return;
    if (e.kind === undefined) return;
    if (!this.limiter.tryAcquire(12)) return;
    if (effect === 'sparks')
      this.oneShot(
        editor,
        e.selections.map((s) => s.active),
        'sparks',
      );
    else if (previous) this.oneShot(editor, [previous], 'trail');
  }

  private oneShot(
    editor: vscode.TextEditor,
    positions: readonly vscode.Position[],
    kind: 'sparks' | 'trail',
  ): void {
    const base = this.settings.get();
    const profile = qualityProfile(base['performance.quality'], base.performanceMode);
    const s: EngineSettings = {
      ...base,
      effect: 'minimal',
      particleCount: kind === 'sparks' ? 4 : 1,
      particleSize: Math.max(1.2, base.particleSize * 0.8),
      particleSpeed: 0.8,
      particleLifetime: kind === 'sparks' ? 380 : 450,
      intensity: 4,
    };
    const images = [];
    for (const position of positions.slice(0, MAX_CURSORS)) {
      if (position.line >= editor.document.lineCount) continue;
      const ctx = caretContext(editor, position, base.placement, this.inlayHints);
      const decision = decideAnchor(ctx, 40);
      const track = this.engine.simulate(s, {
        variant: decision.variant,
        effect: kind === 'sparks' ? MinimalEffect : TrailDot,
      });
      const layout = layoutBurst(track, decision.mode, ctx);
      const svg = renderBurstSvg(track, {
        glow: profile.glow,
        height: layout.height,
        originY: layout.originY,
        nonce: `c${Date.now().toString(36)}.${(++this.nonce).toString(36)}`,
      }).svg;
      images.push({ layout, uri: vscode.Uri.parse(svgToDataUri(svg)) });
    }
    if (this.pool.show(editor, images, s.particleLifetime)) this.oneShots++;
  }

  private scheduleAura(editor: vscode.TextEditor): void {
    if (this.auraTimer !== undefined) return;
    this.auraTimer = setTimeout(() => {
      this.auraTimer = undefined;
      this.renderAura(editor);
    }, AURA_THROTTLE_MS);
  }

  /** Renders the aura at the carets: pulsing after caret activity, static when `resting`. */
  private renderAura(editor: vscode.TextEditor, resting = false): void {
    const s = this.settings.get();
    const kind = s['cursor.effect'];
    if (!this.active(editor) || (kind !== 'glow' && kind !== 'ring')) {
      this.clearAura();
      return;
    }
    const { lineHeight } = editorFontMetrics(editor.document);
    const extents = auraExtents(kind, lineHeight);
    const color = s.colors[0] ?? '#ffb000';
    const animate = !resting && !(this.env?.policy.reducedMotion ?? false);
    const options: vscode.DecorationOptions[] = editor.selections
      .slice(0, MAX_CURSORS)
      .map((sel) => {
        const ctx = caretContext(editor, sel.active, s.placement, this.inlayHints);
        const layout = layoutBurst(extents, decideAnchor(ctx, extents.down).mode, ctx);
        return {
          range: new vscode.Range(
            layout.line,
            layout.startCharacter,
            layout.line,
            layout.endCharacter,
          ),
          renderOptions: {
            after: {
              contentIconPath: this.auraUri(kind, color, lineHeight, layout, animate),
              width: `${layout.width}px`,
              height: `${layout.height}px`,
              margin: layout.margin,
            },
          },
        };
      });
    if (this.auraEditor && this.auraEditor !== editor) this.clearAura();
    editor.setDecorations(this.auraType, options);
    this.auraEditor = editor;
    this.auraAnimated = animate;
    this.clearRestTimer();
    if (animate) {
      this.auraRestTimer = setTimeout(() => {
        this.auraRestTimer = undefined;
        if (this.auraEditor === editor) {
          safely(this.logger, 'Cursor effect failed', () => this.renderAura(editor, true));
        }
      }, AURA_REST_MS);
    }
  }

  private clearRestTimer(): void {
    if (this.auraRestTimer !== undefined) clearTimeout(this.auraRestTimer);
    this.auraRestTimer = undefined;
  }

  /** Aura images are reused per geometry: they loop, so sharing one SMIL timeline is harmless. */
  private auraUri(
    kind: AuraKind,
    color: string,
    lineHeight: number,
    layout: { width: number; height: number; originY: number },
    animate: boolean,
  ): vscode.Uri {
    const key = `${kind}|${color}|${lineHeight}|${layout.width}|${layout.height}|${layout.originY}|${animate}`;
    let uri = this.auraUris.get(key);
    if (!uri) {
      uri = vscode.Uri.parse(svgToDataUri(renderAura(kind, color, lineHeight, layout, animate)));
      this.auraUris.set(key, uri);
    }
    return uri;
  }

  private clearAura(): void {
    this.clearRestTimer();
    const editor = this.auraEditor;
    this.auraEditor = undefined;
    if (!editor) return;
    try {
      editor.setDecorations(this.auraType, []);
    } catch {
      // Editor closed.
    }
  }
}
