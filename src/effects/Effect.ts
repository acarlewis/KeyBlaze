import type { EffectId, ParticleShape } from '../config/schema';
import type { ShapeKind } from '../core/BurstTrack';
import type { Emitter } from '../core/ParticleEngine';

/** Resolved, effect-facing parameters for one burst. */
export interface EffectParams {
  /** Particle count after quality scaling (≥ 1). */
  readonly count: number;
  /** Base particle radius, px. */
  readonly size: number;
  /** Speed multiplier (settings `particleSpeed`). */
  readonly speed: number;
  readonly lifetimeMs: number;
  /** 1–10. */
  readonly intensity: number;
  /** 0.6–1.5, derived from intensity: scales spread and energy. */
  readonly intensityFactor: number;
  readonly colors: readonly string[];
  /** User or preset shape override; `auto` means the effect's natural shape. */
  readonly shape: ParticleShape;
  /** Whether halos are allowed by the quality profile. */
  readonly glow: boolean;
}

/**
 * An effect is a pure spawning strategy. It never touches rendering or VS Code. The same effect
 * drives the editor (SVG) and the Control Panel preview (Canvas).
 */
export interface Effect {
  readonly id: EffectId;
  /** Shape used when `params.shape` is `auto`. */
  readonly naturalShape: ShapeKind;
  spawn(emitter: Emitter, params: EffectParams): void;
}

export function resolveShape(shape: ParticleShape, natural: ShapeKind): ShapeKind {
  return shape === 'auto' ? natural : shape;
}

export function intensityFactor(intensity: number): number {
  return 0.5 + Math.min(10, Math.max(1, intensity)) / 10;
}
