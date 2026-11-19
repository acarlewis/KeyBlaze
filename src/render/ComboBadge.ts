/**
 * The animated combo indicator: a small pill reading "25x COMBO", with a drain bar showing the time
 * left before the combo resets. Pure: no `vscode` import.
 *
 * Layout contract (see services/ComboIndicator): the image is attached after the end of the caret line
 * with zero layout height, so its bottom sits on that line's baseline. The pill is drawn at the bottom-left
 * of the image and is at most one line tall, so it stays within its own line next to the code. The
 * transparent space above it lets the pop/celebration animation grow without being clipped.
 */
import { escapeXml, fmt, shakeAnimation, svgDocument } from './svg';

export interface BadgeOptions {
  readonly count: number;
  /** Line height in px: the pill is sized to fit inside one line. */
  readonly lineHeight: number;
  /** Accent colour (count text, outline, drain bar). */
  readonly color: string;
  /** Time until the combo resets: the drain bar empties over this duration. */
  readonly remainingMs: number;
  /** Milestone celebration: bigger pop and "COMBO!" label. */
  readonly celebrate: boolean;
  readonly shake?: { readonly amplitude: number; readonly durationMs: number };
  readonly nonce: string;
}

export interface RenderedBadge {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
  /** Width/height of the visible pill (for tests and layout). */
  readonly pillWidth: number;
  readonly pillHeight: number;
}

const CHAR_EM = 0.62; // average advance of bold sans-serif digits/caps, in em

export function renderComboBadge(o: BadgeOptions): RenderedBadge {
  const pillHeight = Math.max(10, Math.round(o.lineHeight * 0.72));
  const fontSize = pillHeight * 0.68;
  const labelSize = fontSize * 0.66;
  const countText = `${Math.max(0, Math.floor(o.count))}x`;
  const label = o.celebrate ? 'COMBO!' : 'COMBO';
  const countWidth = countText.length * CHAR_EM * fontSize;
  const labelWidth = label.length * CHAR_EM * labelSize;
  const gap = fontSize * 0.3;
  const padX = pillHeight * 0.45;
  const pillWidth = Math.round(padX * 2 + countWidth + gap + labelWidth);

  const width = Math.round(pillWidth * 1.4) + 4;
  const height = Math.round(pillHeight * 1.8);
  const top = height - pillHeight;
  const color = escapeXml(o.color);
  const baseline = top + pillHeight * 0.5 + fontSize * 0.35;
  const barY = height - 2.5;
  const barWidth = pillWidth - padX;
  const drain = Math.max(0, Math.round(o.remainingMs));

  const pop = o.celebrate
    ? `<animateTransform attributeName="transform" type="scale" values="1.7;0.92;1.06;1" keyTimes="0;0.45;0.75;1" dur="420ms" fill="freeze"/>`
    : `<animateTransform attributeName="transform" type="scale" values="1.22;1" dur="160ms" fill="freeze"/>`;

  const pill =
    `<rect x="0.5" y="${fmt(top + 0.5)}" width="${pillWidth - 1}" height="${pillHeight - 1}" rx="${fmt(pillHeight / 2)}" ` +
    `fill="#16161a" fill-opacity="0.86" stroke="${color}" stroke-opacity="${o.celebrate ? 1 : 0.7}"/>` +
    `<text x="${fmt(padX)}" y="${fmt(baseline)}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-weight="700" ` +
    `font-size="${fmt(fontSize)}" fill="${color}" textLength="${fmt(countWidth)}" lengthAdjust="spacingAndGlyphs">${countText}</text>` +
    `<text x="${fmt(padX + countWidth + gap)}" y="${fmt(baseline)}" font-family="Segoe UI, Helvetica, Arial, sans-serif" ` +
    `font-weight="600" font-size="${fmt(labelSize)}" fill="#ececec" letter-spacing="0.5" textLength="${fmt(labelWidth)}" ` +
    `lengthAdjust="spacingAndGlyphs">${label}</text>` +
    (drain > 0
      ? `<rect x="${fmt(padX / 2)}" y="${fmt(barY)}" width="${fmt(barWidth)}" height="1.5" rx="0.75" fill="${color}">` +
        `<animate attributeName="width" from="${fmt(barWidth)}" to="0" dur="${drain}ms" fill="freeze"/></rect>`
      : '');

  // Scale about the pill's bottom-left corner: translate → scale → translate back.
  const body =
    `<g>${shakeAnimation(o.shake)}<g transform="translate(0 ${height})"><g>${pop}` +
    `<g transform="translate(0 ${-height})">${pill}</g></g></g></g>`;
  return {
    svg: svgDocument(width, height, `<desc>${escapeXml(o.nonce)}</desc>${body}`),
    width,
    height,
    pillWidth,
    pillHeight,
  };
}
