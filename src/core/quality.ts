import type { QualityLevel } from '../config/schema';

/**
 * How much renderer work a burst may cost. Budgets come from the rendering spike
 * (docs/SPIKE_REPORT.md §Q6): glow only at high quality, bounded image size and element count.
 * Phase 7's PerformanceManager scales this further.
 */
export interface QualityProfile {
  readonly keyframes: number;
  readonly substeps: number;
  readonly glow: boolean;
  /** Multiplier applied to the requested particle count. */
  readonly particleScale: number;
  /** Hard cap on elements per burst. */
  readonly maxElements: number;
  /** Half-extent cap of the burst image, px. */
  readonly maxHalfExtent: number;
}

const PROFILES: Readonly<Record<QualityLevel, QualityProfile>> = {
  low: {
    keyframes: 5,
    substeps: 3,
    glow: false,
    particleScale: 0.6,
    maxElements: 24,
    maxHalfExtent: 80,
  },
  medium: {
    keyframes: 7,
    substeps: 4,
    glow: false,
    particleScale: 0.85,
    maxElements: 40,
    maxHalfExtent: 100,
  },
  high: {
    keyframes: 10,
    substeps: 4,
    glow: true,
    particleScale: 1,
    maxElements: 60,
    maxHalfExtent: 120,
  },
};

const PERFORMANCE_MODE: QualityProfile = {
  keyframes: 4,
  substeps: 2,
  glow: false,
  particleScale: 0.5,
  maxElements: 16,
  maxHalfExtent: 60,
};

export function qualityProfile(level: QualityLevel, performanceMode: boolean): QualityProfile {
  return performanceMode ? PERFORMANCE_MODE : PROFILES[level];
}
