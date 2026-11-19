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
  /** Particle: size multiplier. Ring: radius in px. Bolt: scale multiplier. */
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

export type BurstElement = ParticleElement | RingElement | BoltElement;

export interface BurstTrack {
  readonly durationMs: number;
  readonly keyframes: number;
  /** Half extents of the box that contains every element over the whole animation. */
  readonly halfWidth: number;
  readonly halfHeight: number;
  readonly elements: readonly BurstElement[];
}
