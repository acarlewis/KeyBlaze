/**
 * Flame tongue geometry and layering, shared by the SVG renderer (editor) and the Canvas preview.
 * Pure: no `vscode` import, no DOM.
 *
 * A tongue is a closed outline of four cubic Béziers: a pointed tip that leans and curls, two
 * shoulders and a rounded base. The command structure never changes, so SMIL can morph `d` between
 * keyframes smoothly. Three layers give depth: a soft outer glow (edge colour), the body (a vertical
 * gradient from the edge colour at the tip to the hot colour at the base) and a small, bright core
 * low in the flame.
 */
import type { FlameShape } from '../core/BurstTrack';
import { fmt } from './svg';

export interface FlameGeometry {
  readonly start: readonly [number, number];
  /** Four segments: [c1x, c1y, c2x, c2y, x, y]. */
  readonly curves: readonly (readonly [number, number, number, number, number, number])[];
  /** Bounding box of the outline (control points included, so it is conservative). */
  readonly top: number;
  readonly bottom: number;
}

/** Base radius of the rounded bottom relative to the half width. */
const BULB = 0.62;

export function flameGeometry(shape: FlameShape): FlameGeometry {
  const w = Math.max(0.1, shape.w);
  const h = Math.max(0.2, shape.h);
  const lean = shape.lean * h;
  const wob = shape.wobble;
  const bulb = w * BULB;
  const shoulderY = -h * 0.18;
  // The upper body bends the other way a little, which turns a lean into a curl.
  const counter = -lean * 0.18;
  return {
    start: [lean, -h],
    curves: [
      [
        lean * 0.55 + w * (0.22 + 0.18 * wob),
        -h * 0.62,
        w * (1.04 + 0.14 * wob) + counter,
        -h * 0.4,
        w,
        shoulderY,
      ],
      [w, bulb * 0.6, w * 0.55, bulb, 0, bulb],
      [-w * 0.55, bulb, -w, bulb * 0.6, -w, shoulderY],
      [
        -w * (1.04 - 0.14 * wob) + counter,
        -h * 0.4,
        lean * 0.55 - w * (0.22 - 0.18 * wob),
        -h * 0.62,
        lean,
        -h,
      ],
    ],
    top: -h,
    bottom: bulb,
  };
}

/** Compact number: one decimal below 10 px, whole pixels above (sub-pixel there is invisible). */
function num(n: number): string {
  const v = Math.abs(n) < 10 ? Math.round(n * 10) / 10 : Math.round(n);
  return fmt(v === 0 ? 0 : v);
}

/** Joins numbers SVG-style: no separator is needed before a minus sign. */
function join(values: readonly number[]): string {
  let out = '';
  for (const v of values) {
    const s = num(v);
    out += out === '' || s.startsWith('-') ? s : ` ${s}`;
  }
  return out;
}

/** SVG path data for a shape. The command structure is constant: M C C C C Z. */
export function flamePath(shape: FlameShape): string {
  const g = flameGeometry(shape);
  let d = `M${join(g.start)}`;
  for (const c of g.curves) d += `C${join(c)}`;
  return `${d}Z`;
}

/** Colour keys of the three flame colours. */
export type FlameColorKey = 'core' | 'body' | 'edge';

/** Gradient stops, top (tip) → bottom (base): [offset, colour, opacity]. */
export type FlameStop = readonly [number, FlameColorKey, number];

export const FLAME_BODY_STOPS: readonly FlameStop[] = [
  [0, 'edge', 0],
  [0.2, 'edge', 0.75],
  [0.52, 'body', 0.95],
  [0.8, 'core', 0.95],
  [1, 'body', 0.3],
];

/** Radial stops, centre → rim: [offset, colour, opacity]. */
export const FLAME_CORE_STOPS: readonly FlameStop[] = [
  [0, 'core', 0.95],
  [0.55, 'core', 0.6],
  [1, 'core', 0],
];

export const FLAME_GLOW_STOPS: readonly FlameStop[] = [
  [0, 'edge', 0.42],
  [0.6, 'edge', 0.16],
  [1, 'edge', 0],
];

export interface Ellipse {
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
}

/** Soft halo around the tongue (high quality only): an ellipse with a radial gradient. */
export function flameGlow(shape: FlameShape): Ellipse {
  return {
    cx: 0,
    cy: -shape.h * 0.4,
    rx: shape.w * 1.55,
    ry: shape.h * 0.62,
  };
}

/** White-hot core low in the tongue: an ellipse with a radial gradient. */
export function flameCore(shape: FlameShape): Ellipse {
  return {
    cx: 0,
    cy: -shape.h * 0.2,
    rx: shape.w * 0.55,
    ry: Math.max(shape.w * 0.65, shape.h * 0.26),
  };
}

/** Extents of a tongue including its glow (for burst bounds). Conservative. */
export function flameExtents(
  shape: FlameShape,
  glow: boolean,
): { half: number; up: number; down: number } {
  const g = flameGeometry(shape);
  const xs = [g.start[0], ...g.curves.flatMap((c) => [c[0], c[2], c[4]])];
  let half = Math.max(...xs.map(Math.abs));
  let up = -g.top;
  let down = g.bottom;
  if (glow) {
    const e = flameGlow(shape);
    half = Math.max(half, Math.abs(e.cx) + e.rx);
    up = Math.max(up, -(e.cy - e.ry));
    down = Math.max(down, e.cy + e.ry);
  }
  return { half, up, down };
}
