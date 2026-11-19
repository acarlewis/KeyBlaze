/**
 * Persistent cursor effects (glow, energy ring): small looping SVGs that follow the caret.
 * Pure: no `vscode` import.
 *
 * Loops are the one case where reusing an identical image URL is fine. Chromium shares one SMIL
 * timeline per URL, and for an endless loop that only means every copy pulses in sync.
 */
import { escapeXml, fmt, svgDocument } from './svg';

export type AuraKind = 'glow' | 'ring';

export interface AuraGeometry {
  readonly width: number;
  readonly height: number;
  readonly originY: number;
}

/** Radius of the aura for a given line height. */
export function auraRadius(kind: AuraKind, lineHeight: number): number {
  return Math.round(lineHeight * (kind === 'glow' ? 0.95 : 0.8));
}

/** Extents for placement (see core/placement.layoutBurst). */
export function auraExtents(
  kind: AuraKind,
  lineHeight: number,
): { halfWidth: number; up: number; down: number } {
  const r = auraRadius(kind, lineHeight) + 3;
  return { halfWidth: r, up: r, down: r };
}

export function renderAura(
  kind: AuraKind,
  color: string,
  lineHeight: number,
  geometry: AuraGeometry,
): string {
  const c = escapeXml(color);
  const r = auraRadius(kind, lineHeight);
  const cx = geometry.width / 2;
  const cy = geometry.originY;
  let body: string;
  if (kind === 'glow') {
    body =
      `<defs><radialGradient id="a"><stop offset="0" stop-color="${c}" stop-opacity="0.85"/>` +
      `<stop offset="0.5" stop-color="${c}" stop-opacity="0.4"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient></defs>` +
      `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${r}" fill="url(#a)">` +
      `<animate attributeName="opacity" values="0.7;1;0.7" dur="1600ms" repeatCount="indefinite"/></circle>`;
  } else {
    body =
      `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r * 0.8)}" fill="none" stroke="${c}" stroke-width="2.2">` +
      `<animate attributeName="r" values="${fmt(r * 0.7)};${fmt(r)};${fmt(r * 0.7)}" dur="1400ms" repeatCount="indefinite"/>` +
      `<animate attributeName="stroke-opacity" values="1;0.45;1" dur="1400ms" repeatCount="indefinite"/></circle>`;
  }
  return svgDocument(geometry.width, geometry.height, body);
}
