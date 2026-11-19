/**
 * INTERIM (Phase 2 only): a simple radial burst used to validate the decoration rendering path.
 * Phase 3 replaces this with the ParticleEngine + SvgRenderer. It is intentionally minimal.
 */
import { fmt, svgDocument } from './svg';

export interface InterimBurstOptions {
  readonly colors: readonly string[];
  readonly count: number;
  readonly size: number;
  readonly speed: number;
  readonly lifetimeMs: number;
  readonly canvas: number;
  readonly random?: () => number;
}

export function interimBurstSvg(opts: InterimBurstOptions): string {
  const rnd = opts.random ?? Math.random;
  const c = opts.canvas / 2;
  const dur = `${opts.lifetimeMs}ms`;
  const maxReach = c * 0.9;
  let body = '';
  for (let i = 0; i < opts.count; i++) {
    const angle = rnd() * Math.PI * 2;
    const reach = maxReach * (0.4 + 0.6 * rnd()) * Math.min(1, opts.speed);
    const x = c + Math.cos(angle) * reach;
    const y = c + Math.sin(angle) * reach;
    const r = opts.size * (0.5 + rnd() * 0.7);
    const color = opts.colors[i % opts.colors.length] ?? '#ffffff';
    body +=
      `<circle cx="${c}" cy="${c}" r="${fmt(r)}" fill="${color}">` +
      `<animate attributeName="cx" from="${c}" to="${fmt(x)}" dur="${dur}" fill="freeze" calcMode="spline" keySplines="0.2 0.8 0.3 1" keyTimes="0;1"/>` +
      `<animate attributeName="cy" from="${c}" to="${fmt(y)}" dur="${dur}" fill="freeze" calcMode="spline" keySplines="0.2 0.8 0.3 1" keyTimes="0;1"/>` +
      `<animate attributeName="r" from="${fmt(r)}" to="0" dur="${dur}" fill="freeze"/>` +
      `<animate attributeName="opacity" from="1" to="0" dur="${dur}" fill="freeze"/>` +
      `</circle>`;
  }
  return svgDocument(opts.canvas, opts.canvas, body);
}
