/**
 * Impact Pulse: the supported stand-in for screen shake (see docs/ARCHITECTURE.md §3).
 * At a combo milestone, the effect layer (the celebration burst and the combo badge) jitters, and the
 * cursor line can flash briefly. Editor text never moves. Pure: no `vscode` import.
 */
import type { Milestone } from './ComboManager';

export interface ImpactSettings {
  readonly intensity: number; // 1–10
  readonly durationMs: number; // 50–1000
}

/** Jitter amplitude in px: scales with intensity and milestone tier (bigger milestones shake harder). */
export function impactAmplitude(settings: ImpactSettings, milestone: Milestone): number {
  const tierBoost = 1 + 0.5 * milestone.tier;
  return Math.min(12, Math.max(1, Math.round(settings.intensity * 0.6 * tierBoost * 10) / 10));
}

/** Duration in ms: the configured duration, slightly longer for higher tiers. */
export function impactDuration(settings: ImpactSettings, milestone: Milestone): number {
  return Math.round(Math.min(1000, settings.durationMs * (1 + 0.15 * milestone.tier)));
}

export interface FlashStep {
  /** Delay from the start of the pulse, ms. */
  readonly atMs: number;
  /** Background alpha for this step (0 = clear). */
  readonly alpha: number;
}

/**
 * Background alpha steps for the cursor-line flash. Decorations can't animate opacity, so the flash
 * is a few discrete steps ending with a clear.
 */
export function flashSteps(durationMs: number, milestone: Milestone): FlashStep[] {
  const peak = Math.min(0.42, 0.26 + 0.05 * milestone.tier);
  const third = durationMs / 3;
  return [
    { atMs: 0, alpha: peak },
    { atMs: Math.round(third), alpha: peak * 0.55 },
    { atMs: Math.round(third * 2), alpha: peak * 0.22 },
    { atMs: Math.round(durationMs), alpha: 0 },
  ];
}

/** `#rgb`/`#rrggbb` + alpha → `rgba(...)`. */
export function withAlpha(hex: string, alpha: number): string {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = Number.parseInt(h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 1000) / 1000})`;
}

/** Accent colour for a combo count: the palette entry of the highest milestone reached. */
export function tierColor(
  count: number,
  milestones: readonly number[],
  colors: readonly string[],
): string {
  let tier = -1;
  for (let i = 0; i < milestones.length; i++) if (count >= (milestones[i] ?? Infinity)) tier = i;
  const index = Math.max(0, Math.min(colors.length - 1, tier));
  return colors[index] ?? '#ffb000';
}
