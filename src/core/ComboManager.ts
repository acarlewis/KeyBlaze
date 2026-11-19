/**
 * Tracks continuous typing streaks. Pure: an injectable clock, no timers (the service schedules resets).
 *
 * - Every genuine keystroke `hit()`s the combo. A gap longer than `resetTimeMs` starts a new combo.
 * - Milestones are the configured counts (e.g. 10, 25, 50, 100). Past the last one, every further
 *   multiple of the last milestone is also a milestone (200, 300, …) at the top tier.
 */

export type Clock = () => number;

export interface ComboConfig {
  readonly resetTimeMs: number;
  /** Sorted ascending, unique, ≥ 2 (as produced by the settings schema). */
  readonly milestones: readonly number[];
}

export interface ComboHit {
  readonly count: number;
  /** Set when this hit reached a milestone. */
  readonly milestone?: Milestone;
  /** True when this hit started a new combo (the previous one expired or was reset). */
  readonly started: boolean;
  /** True when `count` exceeds the best combo so far. */
  readonly newBest: boolean;
}

export interface Milestone {
  readonly count: number;
  /** 0-based index into the milestone list. Repeats past the last one use the last tier. */
  readonly tier: number;
  readonly tierCount: number;
}

export interface ComboSnapshot {
  readonly count: number;
  readonly best: number;
  readonly lastHitAt: number | undefined;
  /** Milliseconds until the current combo expires (0 when there is no combo). */
  readonly remainingMs: number;
}

export class ComboManager {
  private count = 0;
  private best: number;
  private lastHitAt: number | undefined;

  constructor(
    private config: ComboConfig,
    private readonly clock: Clock = Date.now,
    initialBest = 0,
  ) {
    this.best = Math.max(0, initialBest);
  }

  configure(config: ComboConfig): void {
    this.config = config;
  }

  hit(): ComboHit {
    const now = this.clock();
    const started = this.isExpired(now) || this.count === 0;
    if (started) this.count = 0;
    this.count++;
    this.lastHitAt = now;
    const newBest = this.count > this.best;
    if (newBest) this.best = this.count;
    const milestone = milestoneFor(this.count, this.config.milestones);
    return milestone
      ? { count: this.count, milestone, started, newBest }
      : { count: this.count, started, newBest };
  }

  /**
   * Ends the combo if it has expired. Returns the count that just ended, or 0 when nothing changed.
   * The service calls this from its reset timer.
   */
  expire(): number {
    if (this.count === 0 || !this.isExpired(this.clock())) return 0;
    return this.resetCount();
  }

  /** Ends the current combo immediately. Returns the count that ended. */
  reset(): number {
    return this.resetCount();
  }

  snapshot(): ComboSnapshot {
    const now = this.clock();
    const alive = this.count > 0 && !this.isExpired(now);
    return {
      count: alive ? this.count : 0,
      best: this.best,
      lastHitAt: this.lastHitAt,
      remainingMs:
        alive && this.lastHitAt !== undefined
          ? this.config.resetTimeMs - (now - this.lastHitAt)
          : 0,
    };
  }

  private isExpired(now: number): boolean {
    return this.lastHitAt === undefined || now - this.lastHitAt > this.config.resetTimeMs;
  }

  private resetCount(): number {
    const ended = this.count;
    this.count = 0;
    this.lastHitAt = undefined;
    return ended;
  }
}

export function milestoneFor(count: number, milestones: readonly number[]): Milestone | undefined {
  const tierCount = milestones.length;
  if (tierCount === 0) return undefined;
  const index = milestones.indexOf(count);
  if (index >= 0) return { count, tier: index, tierCount };
  const last = milestones[tierCount - 1] ?? 0;
  if (last > 0 && count > last && count % last === 0)
    return { count, tier: tierCount - 1, tierCount };
  return undefined;
}

/** The combo count from which the indicator is shown: the first milestone, capped at 10. */
export function displayThreshold(milestones: readonly number[]): number {
  return Math.min(10, milestones[0] ?? 10);
}
