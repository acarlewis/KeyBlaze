/** Small colour helpers for effects (palette colours are validated `#rgb` / `#rrggbb`). Pure. */

function rgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = Number.parseInt(h, 16);
  if (Number.isNaN(n) || h.length !== 6) return [255, 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const hex2 = (v: number): string =>
  Math.round(Math.min(255, Math.max(0, v)))
    .toString(16)
    .padStart(2, '0');

/** Relative brightness, 0–1 (Rec. 709 weights on gamma-encoded values: good enough for ordering). */
export function brightness(hex: string): number {
  const [r, g, b] = rgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Linear mix of two colours, `t` = 0 → a, 1 → b. */
export function mixColor(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return `#${hex2(x[0] + (y[0] - x[0]) * t)}${hex2(x[1] + (y[1] - x[1]) * t)}${hex2(x[2] + (y[2] - x[2]) * t)}`;
}

export interface FlamePalette {
  /** White-hot centre: the brightest palette colour pushed towards white. */
  readonly core: string;
  /** Flame bodies: the middle of the palette (two variants for natural variation). */
  readonly body: readonly [string, string];
  /** Cool outer edge and tip: the darkest palette colour. */
  readonly edge: string;
  /** Embers and sparks: the brightest palette colour. */
  readonly ember: string;
}

/**
 * Maps any palette to flame colours by brightness, so a custom palette still burns believably
 * (bright centre, darker edges) whatever order the user lists its colours in.
 */
export function flamePalette(colors: readonly string[]): FlamePalette {
  const sorted = [...(colors.length > 0 ? colors : ['#ff8a00'])].sort(
    (a, b) => brightness(b) - brightness(a),
  );
  const hottest = sorted[0] ?? '#ffd23f';
  const coolest = sorted[sorted.length - 1] ?? hottest;
  const mid = sorted[Math.floor((sorted.length - 1) / 2)] ?? hottest;
  const mid2 = sorted[Math.ceil((sorted.length - 1) / 2)] ?? mid;
  return {
    core: mixColor(hottest, '#ffffff', 0.55),
    body: [mid, mid2],
    edge: coolest,
    ember: hottest,
  };
}
