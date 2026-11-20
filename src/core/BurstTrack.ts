/**
 * Renderer-independent description of one simulated burst.
 *
 * Every element has the same number of keyframes, evenly spaced over `durationMs`. Renderers
 * interpolate linearly between them: the SVG renderer turns them into SMIL `values` lists, and the
 * Canvas preview renderer samples them per frame. The editor and the preview therefore show the
 * same motion.
 *
 * Coordinates are in CSS pixels relative to the burst origin (the caret). +y points down.
 */

export interface Frame {
  /** Offset from the origin. */
  readonly x: number;
  readonly y: number;
  /** Particle: size multiplier. Ring: radius in px. Bolt: scale multiplier. Flame: unused (1). */
  readonly s: number;
  /** Opacity, 0–1. */
  readonly o: number;
  /** Rotation in degrees. */
  readonly r: number;
}

export type ShapeKind = 'circle' | 'square' | 'triangle' | 'star' | 'spark';

interface ElementBase {
  readonly color: string;
  /** 0 = none. Otherwise renderers add a soft halo (when the quality profile allows). */
  readonly glow: number;
  readonly frames: readonly Frame[];
}

export interface ParticleElement extends ElementBase {
  readonly kind: 'particle';
  readonly shape: ShapeKind;
  /** Base radius in px (frame `s` multiplies it). */
  readonly size: number;
}

export interface RingElement extends ElementBase {
  readonly kind: 'ring';
  readonly strokeWidth: number;
}

export interface BoltElement extends ElementBase {
  readonly kind: 'bolt';
  readonly width: number;
  /** Flat list of x,y pairs relative to the frame position. */
  readonly points: readonly number[];
}

/**
 * Outline of a flame tongue at one keyframe, relative to the centre of its rounded base (+y down).
 * Renderers build the same Bézier outline from it (render/flamePath.ts), so the editor and the
 * preview draw identical flames, and SMIL can morph between keyframes (constant path structure).
 */
export interface FlameShape {
  /** Half width of the body, px. */
  readonly w: number;
  /** Height from the base centre to the tip, px. */
  readonly h: number;
  /** Horizontal tip offset as a fraction of `h` (the tongue leans and curls), about −0.6…0.6. */
  readonly lean: number;
  /** Side asymmetry, −1…1 (flicker). */
  readonly wobble: number;
}

export interface FlameElement extends ElementBase {
  readonly kind: 'flame';
  /** Hot core colour (inner layer). `color` is the body colour. */
  readonly core: string;
  /** Cool edge colour (tip and outer glow). */
  readonly edge: string;
  /** Draw the white-hot core layer (false for small tongues, where it would be a pixel or two). */
  readonly hotCore: boolean;
  /** One outline per keyframe, parallel to `frames` (frame x/y = base position, o = opacity). */
  readonly shapes: readonly FlameShape[];
}

export type BurstElement = ParticleElement | RingElement | BoltElement | FlameElement;

export interface BurstTrack {
  readonly durationMs: number;
  readonly keyframes: number;
  /** Horizontal half extent of the box containing every visible element over the whole animation. */
  readonly halfWidth: number;
  /** Extent above the origin (px). */
  readonly up: number;
  /** Extent below the origin (px). Decoration images are baseline-pinned, so this decides the anchor. */
  readonly down: number;
  readonly elements: readonly BurstElement[];
}
