/** Seeded pseudo-random numbers, so bursts are reproducible in tests and previews. */

export type Random = () => number;

/** mulberry32: tiny, fast, good enough for visuals. Returns values in [0, 1). */
export function mulberry32(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

export function between(rng: Random, min: number, max: number): number {
  return min + (max - min) * rng();
}

export function pick<T>(rng: Random, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick() requires a non-empty list');
  return items[Math.floor(rng() * items.length) % items.length] as T;
}

export function chance(rng: Random, probability: number): boolean {
  return rng() < probability;
}
