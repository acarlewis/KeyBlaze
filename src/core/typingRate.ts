/**
 * Measures the current typing rate and turns it into a render budget. Pure, injectable clock.
 *
 * The rendering spike (docs/SPIKE_REPORT.md §Q6) showed that renderer cost scales with bursts and
 * elements per second. Above ~12 keystrokes/s the paced rate limiter already skips keystrokes. This
 * also shrinks each burst so that fast typists stay well inside the renderer budget.
 */

export type Clock = () => number;

export class TypingRate {
  private readonly stamps: number[] = [];

  constructor(
    private readonly clock: Clock = Date.now,
    private readonly windowMs = 1000,
  ) {}

  hit(): void {
    const now = this.clock();
    this.stamps.push(now);
    this.trim(now);
  }

  /** Keystrokes per second over the last window. */
  rate(): number {
    this.trim(this.clock());
    return (this.stamps.length * 1000) / this.windowMs;
  }

  private trim(now: number): void {
    while (this.stamps.length > 0 && now - (this.stamps[0] ?? 0) > this.windowMs)
      this.stamps.shift();
  }
}

/** 1 up to 12 keystrokes/s, falling linearly to 0.5 at 24 keystrokes/s and above. */
export function budgetForRate(keystrokesPerSecond: number): number {
  if (keystrokesPerSecond <= 12) return 1;
  if (keystrokesPerSecond >= 24) return 0.5;
  return 1 - ((keystrokesPerSecond - 12) / 12) * 0.5;
}

/** Typing heat for effects: 0 at 2 keystrokes/s or slower, rising linearly to 1 at 10/s. */
export function heatForRate(keystrokesPerSecond: number): number {
  return Math.min(1, Math.max(0, (keystrokesPerSecond - 2) / 8));
}
