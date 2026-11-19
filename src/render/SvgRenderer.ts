/**
 * Renders a BurstTrack as a self-contained animated SVG (SMIL), sized to the burst's bounds with
 * the origin at the centre. Pure: no `vscode` import.
 *
 * Keyframes are evenly spaced, so `keyTimes` is omitted and linear interpolation spreads the
 * `values` evenly over `dur`. Every animation uses `fill="freeze"`, so the burst ends invisible.
 */
import type {
  BoltElement,
  BurstElement,
  BurstTrack,
  Frame,
  ParticleElement,
  RingElement,
  ShapeKind,
} from '../core/BurstTrack';
import { escapeXml, fmt, shakeAnimation, svgDocument } from './svg';

export interface RenderedSvg {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
}

export interface SvgRenderOptions {
  /** Draw halos for elements with glow > 0. */
  readonly glow: boolean;
  /**
   * Image height and the origin's y within it (from the placement layout). Defaults to the burst's
   * own extents (up + down, origin at `up`). Content outside the image is clipped.
   */
  readonly height?: number;
  readonly originY?: number;
  /**
   * Makes the document unique. Chromium shares one SMIL timeline per image URL, so two bursts with
   * byte-identical SVGs would show the same animation frame (spike report §Q5).
   */
  readonly nonce?: string;
  /** Impact Pulse: jitter the whole burst at the start (milestone celebrations). */
  readonly shake?: { readonly amplitude: number; readonly durationMs: number };
}

/** Unit shapes (radius 1) centred on the origin. */
const SHAPE_PATHS: Readonly<Record<Exclude<ShapeKind, 'circle'>, string>> = {
  square: 'M-0.8-0.8H0.8V0.8H-0.8Z',
  triangle: 'M0-1L0.87 0.5H-0.87Z',
  star: 'M0-1L0.24-0.32L0.95-0.31L0.38 0.12L0.59 0.81L0 0.4L-0.59 0.81L-0.38 0.12L-0.95-0.31L-0.24-0.32Z',
  spark: 'M-1.6-0.25H1.6V0.25H-1.6Z',
};

export function renderBurstSvg(track: BurstTrack, options: SvgRenderOptions): RenderedSvg {
  const width = track.halfWidth * 2;
  const height = Math.max(1, Math.round(options.height ?? track.up + track.down));
  const originY = options.originY ?? track.up;
  const dur = `${Math.round(track.durationMs)}ms`;
  const defs = new Map<string, string>();
  let body = '';
  for (const el of track.elements) body += renderElement(el, dur, options, defs);
  const defsXml = defs.size > 0 ? `<defs>${[...defs.values()].join('')}</defs>` : '';
  const nonce = options.nonce ? `<desc>${escapeXml(options.nonce)}</desc>` : '';
  const shaken = options.shake ? `<g>${shakeAnimation(options.shake)}${body}</g>` : body;
  const content = `${nonce}${defsXml}<g transform="translate(${track.halfWidth} ${fmt(originY)})">${shaken}</g>`;
  return { svg: svgDocument(width, height, content), width, height };
}

function renderElement(
  el: BurstElement,
  dur: string,
  options: SvgRenderOptions,
  defs: Map<string, string>,
): string {
  switch (el.kind) {
    case 'particle':
      return renderParticle(el, dur, options, defs);
    case 'ring':
      return renderRing(el, dur, options);
    case 'bolt':
      return renderBolt(el, dur, options);
  }
}

function renderParticle(
  el: ParticleElement,
  dur: string,
  options: SvgRenderOptions,
  defs: Map<string, string>,
): string {
  const color = escapeXml(el.color);
  const glowing = options.glow && el.glow > 0;
  const f0 = el.frames[0] ?? ZERO;
  const motion =
    animateTransform(
      'translate',
      el.frames.map((f) => `${fmt(f.x)},${fmt(f.y)}`),
      dur,
    ) +
    (hasRotation(el)
      ? animateTransform(
          'rotate',
          el.frames.map((f) => fmt(f.r)),
          dur,
          true,
        )
      : '') +
    animateTransform(
      'scale',
      el.frames.map((f) => fmt(el.size * f.s)),
      dur,
      true,
    ) +
    animate(
      'opacity',
      el.frames.map((f) => fmt(f.o)),
      dur,
    );

  const transform = `translate(${fmt(f0.x)} ${fmt(f0.y)}) scale(${fmt(el.size * f0.s)})`;
  let halo = '';
  if (glowing) {
    const id = gradientId(el.color);
    if (!defs.has(id)) {
      defs.set(
        id,
        `<radialGradient id="${id}"><stop offset="0" stop-color="${color}" stop-opacity="0.9"/>` +
          `<stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`,
      );
    }
    halo = `<circle r="2.5" fill="url(#${id})" opacity="${fmt(el.glow)}"/>`;
  }
  const shape =
    el.shape === 'circle'
      ? `<circle r="1" fill="${color}"/>`
      : `<path d="${SHAPE_PATHS[el.shape]}" fill="${color}"/>`;
  return `<g transform="${transform}" opacity="${fmt(f0.o)}">${halo}${shape}${motion}</g>`;
}

function renderRing(el: RingElement, dur: string, options: SvgRenderOptions): string {
  const color = escapeXml(el.color);
  const f0 = el.frames[0] ?? ZERO;
  const radii = el.frames.map((f) => fmt(f.s));
  const opacity = el.frames.map((f) => fmt(f.o));
  const ring = (strokeWidth: number, alpha: number): string =>
    `<circle cx="${fmt(f0.x)}" cy="${fmt(f0.y)}" r="${fmt(f0.s)}" fill="none" stroke="${color}" ` +
    `stroke-width="${fmt(strokeWidth)}" stroke-opacity="${fmt(alpha)}">${animate('r', radii, dur)}</circle>`;
  const halo = options.glow && el.glow > 0 ? ring(el.strokeWidth * 3, 0.25 * el.glow) : '';
  return `<g opacity="${fmt(f0.o)}">${halo}${ring(el.strokeWidth, 1)}${animate('opacity', opacity, dur)}</g>`;
}

function renderBolt(el: BoltElement, dur: string, options: SvgRenderOptions): string {
  const color = escapeXml(el.color);
  const f0 = el.frames[0] ?? ZERO;
  const pts: string[] = [];
  for (let i = 0; i + 1 < el.points.length; i += 2)
    pts.push(`${fmt(el.points[i] ?? 0)},${fmt(el.points[i + 1] ?? 0)}`);
  const line = (width: number, alpha: number): string =>
    `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="${fmt(width)}" ` +
    `stroke-opacity="${fmt(alpha)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const glowing = options.glow && el.glow > 0;
  const halo = glowing ? line(el.width * 3, 0.3 * el.glow) : '';
  // A thin white-hot core makes bolts read as electric rather than as coloured lines.
  const core = glowing
    ? `<polyline points="${pts.join(' ')}" fill="none" stroke="#ffffff" stroke-width="${fmt(el.width * 0.4)}" ` +
      `stroke-opacity="0.85" stroke-linecap="round" stroke-linejoin="round"/>`
    : '';
  return (
    `<g transform="translate(${fmt(f0.x)} ${fmt(f0.y)})" opacity="${fmt(f0.o)}">${halo}${line(el.width, 1)}${core}` +
    `${animate(
      'opacity',
      el.frames.map((f) => fmt(f.o)),
      dur,
    )}</g>`
  );
}

const ZERO: Frame = { x: 0, y: 0, s: 1, o: 0, r: 0 };

function hasRotation(el: ParticleElement): boolean {
  return el.shape !== 'circle' && el.frames.some((f) => f.r !== 0);
}

function animate(attribute: string, values: string[], dur: string): string {
  return `<animate attributeName="${attribute}" values="${values.join(';')}" dur="${dur}" fill="freeze"/>`;
}

function animateTransform(type: string, values: string[], dur: string, additive = false): string {
  return (
    `<animateTransform attributeName="transform" type="${type}" values="${values.join(';')}" dur="${dur}" ` +
    `fill="freeze"${additive ? ' additive="sum"' : ''}/>`
  );
}

function gradientId(color: string): string {
  return `g${color.replace(/[^0-9a-zA-Z]/g, '')}`;
}
