/**
 * Live preview: a themed mini editor that "types" a code snippet by itself. It renders bursts with
 * the same AnimationEngine, effects and rate limits as the editor, counts combos with the same
 * ComboManager, and shows the same combo badge. Clicking the canvas fires a burst at the pointer.
 */
import type { KeyBlazeSettings } from '../config/schema';
import { AnimationEngine } from '../core/AnimationEngine';
import type { BurstTrack } from '../core/BurstTrack';
import { ComboManager, displayThreshold } from '../core/ComboManager';
import { tierColor } from '../core/impact';
import { ParticleEngine } from '../core/ParticleEngine';
import type { EffectVariant } from '../core/placement';
import { qualityProfile } from '../core/quality';
import { renderComboBadge } from '../render/ComboBadge';
import { svgToUtf8DataUri } from '../render/svg';
import { drawTrack } from './draw';

const SNIPPET = [
  'function blaze(keys) {',
  '  const combo = keys.length;',
  "  return combo > 10 ? 'on fire' : 'warming up';",
  '}',
];

interface LiveBurst {
  track: BurstTrack;
  start: number;
  x: number;
  y: number;
  glow: boolean;
}

export class Preview {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly engine = new AnimationEngine(new ParticleEngine(), () => performance.now());
  private readonly combo: ComboManager;
  private bursts: LiveBurst[] = [];
  private typedLines: string[] = [''];
  private cursor = { line: 0, col: 0 };
  private nextKeyAt = 0;
  private lastFrame = 0;
  private raf = 0;
  private running = false;
  private variant: EffectVariant = 'full';
  private override: Partial<KeyBlazeSettings> | undefined;
  private overrideUntil = 0;
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private badgeKey = '';

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly badge: HTMLImageElement,
    private getSettings: () => KeyBlazeSettings,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    const s = getSettings();
    this.combo = new ComboManager({
      resetTimeMs: s['combo.resetTime'],
      milestones: s['combo.milestones'],
    });
    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      this.burstAt(e.clientX - rect.left, e.clientY - rect.top, true);
    });
    document.addEventListener('visibilitychange', () =>
      document.hidden ? this.stop() : this.start(),
    );
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  start(): void {
    if (this.running || document.hidden) return;
    this.running = true;
    this.lastFrame = 0;
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  setVariant(variant: EffectVariant): void {
    this.variant = variant;
  }

  /** Temporarily preview other values (e.g. a preset card) without applying them. */
  previewValues(values: Partial<KeyBlazeSettings>, ms = 3500): void {
    this.override = values;
    this.overrideUntil = performance.now() + ms;
    this.burstAtCaret(true);
  }

  /** Fire a burst at the caret now (the "Burst" button). */
  burstNow(): void {
    this.burstAtCaret(true);
  }

  private settings(): KeyBlazeSettings {
    const base = this.getSettings();
    if (this.override && performance.now() > this.overrideUntil) this.override = undefined;
    return this.override ? { ...base, ...this.override } : base;
  }

  private metrics(): {
    font: string;
    size: number;
    lineHeight: number;
    charWidth: number;
    padX: number;
    padY: number;
  } {
    const style = getComputedStyle(document.body);
    const size = Number.parseFloat(style.getPropertyValue('--vscode-editor-font-size')) || 14;
    const family = style.getPropertyValue('--vscode-editor-font-family').trim() || 'monospace';
    const font = `${size}px ${family}`;
    this.ctx.font = font;
    const charWidth = this.ctx.measureText('0').width || size * 0.6;
    return { font, size, lineHeight: Math.round(size * 1.35), charWidth, padX: 18, padY: 28 };
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private frame(now: number): void {
    if (!this.running) return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const s = this.settings();
    const minFrame = 1000 / s['performance.frameRateLimit'];
    if (this.lastFrame && now - this.lastFrame < minFrame - 1) return;
    this.lastFrame = now;
    this.combo.configure({ resetTimeMs: s['combo.resetTime'], milestones: s['combo.milestones'] });
    if (now >= this.nextKeyAt) this.typeNext(now, s);
    this.draw(now, s);
  }

  private typeNext(now: number, s: KeyBlazeSettings): void {
    const target = SNIPPET[this.cursor.line] ?? '';
    if (this.cursor.col < target.length) {
      this.cursor.col++;
      this.typedLines[this.cursor.line] = target.slice(0, this.cursor.col);
      this.keystroke(s);
      const slow = this.reducedMotion.matches ? 2.5 : 1;
      this.nextKeyAt = now + (70 + Math.random() * 90) * slow;
    } else if (this.cursor.line < SNIPPET.length - 1) {
      this.cursor = { line: this.cursor.line + 1, col: 0 };
      this.typedLines.push('');
      this.nextKeyAt = now + 260;
    } else {
      this.typedLines = [''];
      this.cursor = { line: 0, col: 0 };
      this.nextKeyAt = now + 1600;
    }
  }

  private keystroke(s: KeyBlazeSettings): void {
    if (!s.enabled) return;
    let celebrated = false;
    if (s['combo.enabled']) {
      const hit = this.combo.hit();
      if (hit.milestone) {
        celebrated = true;
        this.burstAtCaret(true, {
          particleCount: Math.min(40, Math.round(s.particleCount * 1.6)),
          intensity: Math.min(10, s.intensity + 1 + hit.milestone.tier),
          particleLifetime: Math.min(2000, Math.round(s.particleLifetime * 1.25)),
        });
      }
    }
    if (!celebrated) this.burstAtCaret(false);
  }

  private caretPoint(): { x: number; y: number } {
    const m = this.metrics();
    return {
      x: m.padX + this.cursor.col * m.charWidth,
      y: m.padY + this.cursor.line * m.lineHeight + m.lineHeight / 2,
    };
  }

  private burstAtCaret(bypass: boolean, overrides: Partial<KeyBlazeSettings> = {}): void {
    const p = this.caretPoint();
    this.burstAt(p.x, p.y, bypass, overrides);
  }

  private burstAt(
    x: number,
    y: number,
    bypass: boolean,
    overrides: Partial<KeyBlazeSettings> = {},
  ): void {
    const s = { ...this.settings(), ...overrides };
    if (!this.engine.admit(s, bypass)) return;
    const profile = qualityProfile(s['performance.quality'], s.performanceMode);
    const track = this.engine.simulate(s, { variant: this.variant });
    this.bursts.push({ track, start: performance.now(), x, y, glow: profile.glow });
    if (this.bursts.length > s['performance.maxConcurrentBursts']) this.bursts.shift();
  }

  private draw(now: number, s: KeyBlazeSettings): void {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const style = getComputedStyle(document.body);
    const m = this.metrics();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = style.getPropertyValue('--vscode-editor-background').trim() || '#1e1e1e';
    ctx.fillRect(0, 0, w, h);

    ctx.font = m.font;
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 1;
    ctx.fillStyle = style.getPropertyValue('--vscode-editor-foreground').trim() || '#d4d4d4';
    this.typedLines.forEach((line, i) =>
      ctx.fillText(line, m.padX, m.padY + i * m.lineHeight + m.lineHeight / 2),
    );

    const caret = this.caretPoint();
    ctx.fillStyle = style.getPropertyValue('--vscode-editorCursor-foreground').trim() || '#aeafad';
    ctx.fillRect(caret.x, caret.y - m.lineHeight / 2 + 1, 2, m.lineHeight - 2);

    this.bursts = this.bursts.filter((b) => now - b.start < b.track.durationMs);
    for (const b of this.bursts) drawTrack(ctx, b.track, now - b.start, b.x, b.y, b.glow);
    ctx.globalAlpha = 1;

    this.updateBadge(s, m);
  }

  private updateBadge(
    s: KeyBlazeSettings,
    m: { padX: number; padY: number; lineHeight: number; charWidth: number },
  ): void {
    const snap = this.combo.snapshot();
    const show =
      s.enabled &&
      s['combo.enabled'] &&
      s['combo.showIndicator'] &&
      snap.count >= displayThreshold(s['combo.milestones']);
    if (!show) {
      this.badge.hidden = true;
      this.badgeKey = '';
      return;
    }
    const key = `${snap.count}|${s.colors.join()}`;
    if (key === this.badgeKey) return;
    this.badgeKey = key;
    const celebrate = s['combo.milestones'].includes(snap.count);
    const badge = renderComboBadge({
      count: snap.count,
      lineHeight: m.lineHeight,
      color: tierColor(snap.count, s['combo.milestones'], s.colors),
      remainingMs: snap.remainingMs,
      celebrate,
      nonce: `${performance.now()}`,
    });
    const line = this.typedLines[this.cursor.line] ?? '';
    this.badge.src = svgToUtf8DataUri(badge.svg);
    this.badge.width = badge.width;
    this.badge.height = badge.height;
    this.badge.style.left = `${m.padX + (line.length + 2) * m.charWidth}px`;
    this.badge.style.top = `${m.padY + this.cursor.line * m.lineHeight + m.lineHeight * 0.78 - badge.height}px`;
    this.badge.hidden = false;
  }
}
