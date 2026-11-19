/**
 * Turns "a keystroke happened" into a simulated burst, applying rate limits and quality budgets.
 * Pure: no `vscode` import, and an injectable clock and seed source make it deterministic in tests.
 */
import type { KeyBlazeSettings } from '../config/schema';
import type { Effect, EffectParams } from '../effects/Effect';
import { intensityFactor } from '../effects/Effect';
import { getEffect } from '../effects/registry';
import type { BurstTrack } from './BurstTrack';
import { ParticleEngine } from './ParticleEngine';
import type { QualityProfile } from './quality';
import { qualityProfile } from './quality';
import { mulberry32, randomSeed } from './random';

export type Clock = () => number;

/** Sliding one-second window limiter. */
export class RateLimiter {
  private readonly stamps: number[] = [];

  constructor(private readonly clock: Clock = Date.now) {}

  tryAcquire(limitPerSecond: number): boolean {
    const now = this.clock();
    while (this.stamps.length > 0 && now - (this.stamps[0] ?? 0) >= 1000) this.stamps.shift();
    if (this.stamps.length >= limitPerSecond) return false;
    this.stamps.push(now);
    return true;
  }

  reset(): void {
    this.stamps.length = 0;
  }
}

export type EngineSettings = Pick<
  KeyBlazeSettings,
  | 'effect'
  | 'intensity'
  | 'particleCount'
  | 'particleSize'
  | 'particleSpeed'
  | 'particleLifetime'
  | 'particleShape'
  | 'colors'
  | 'performanceMode'
  | 'performance.quality'
  | 'performance.maxBurstsPerSecond'
>;

export interface BurstRequestOptions {
  /** Skip the rate limiter (previews). */
  readonly bypassRateLimit?: boolean;
  readonly seed?: number;
  /** Override the effect (previews of a specific effect). */
  readonly effect?: Effect;
  /** Extra multiplier on the quality profile, e.g. from PerformanceManager. 0–1. */
  readonly budgetScale?: number;
}

export interface EngineStats {
  requested: number;
  rendered: number;
  throttled: number;
}

export class AnimationEngine {
  private readonly limiter: RateLimiter;
  private readonly stats: EngineStats = { requested: 0, rendered: 0, throttled: 0 };

  constructor(
    private readonly particles = new ParticleEngine(),
    clock: Clock = Date.now,
    private readonly seeds: () => number = randomSeed,
  ) {
    this.limiter = new RateLimiter(clock);
  }

  getStats(): Readonly<EngineStats> {
    return { ...this.stats };
  }

  /** Returns a burst to render, or `undefined` when rate-limited. */
  requestBurst(
    settings: EngineSettings,
    options: BurstRequestOptions = {},
  ): BurstTrack | undefined {
    this.stats.requested++;
    if (
      !options.bypassRateLimit &&
      !this.limiter.tryAcquire(settings['performance.maxBurstsPerSecond'])
    ) {
      this.stats.throttled++;
      return undefined;
    }
    const profile = qualityProfile(settings['performance.quality'], settings.performanceMode);
    const effect = options.effect ?? getEffect(settings.effect);
    const params = buildEffectParams(settings, profile, options.budgetScale ?? 1);
    const rng = mulberry32(options.seed ?? this.seeds());
    const track = this.particles.simulate((emitter) => effect.spawn(emitter, params), {
      durationMs: settings.particleLifetime,
      keyframes: profile.keyframes,
      substeps: profile.substeps,
      maxElements: Math.max(1, Math.round(profile.maxElements * clampScale(options.budgetScale))),
      maxHalfExtent: profile.maxHalfExtent,
      rng,
    });
    this.stats.rendered++;
    return track;
  }
}

function clampScale(scale: number | undefined): number {
  return Math.min(1, Math.max(0.1, scale ?? 1));
}

export function buildEffectParams(
  settings: EngineSettings,
  profile: QualityProfile,
  budgetScale = 1,
): EffectParams {
  const scale = profile.particleScale * clampScale(budgetScale);
  return {
    count: Math.max(1, Math.round(settings.particleCount * scale)),
    size: settings.particleSize,
    speed: settings.particleSpeed,
    lifetimeMs: settings.particleLifetime,
    intensity: settings.intensity,
    intensityFactor: intensityFactor(settings.intensity),
    colors: settings.colors.length > 0 ? settings.colors : ['#ffffff'],
    shape: settings.particleShape,
    glow: profile.glow,
  };
}
