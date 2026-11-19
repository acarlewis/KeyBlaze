/**
 * Pure layout maths for placing an effect image on a decoration attachment.
 *
 * The image is an `after` attachment `width × height` px. We want it centred on the caret and on the
 * line's vertical middle, with zero net horizontal layout width so that text and caret don't move:
 *  - horizontal: margin-left = margin-right = -width/2 (net width 0, centred on the caret)
 *  - vertical:   an inline box's bottom sits on the text baseline, which is roughly 0.22 × lineHeight
 *                below the line's middle. A negative bottom margin drops the box so that it is centred.
 */

/** Fraction of the line height between the line's middle and the text baseline (empirical). */
export const BASELINE_BELOW_MIDDLE = 0.22;

export function attachmentMargin(width: number, height: number, lineHeight: number): string {
  const half = round(width / 2);
  const drop = round(height / 2 - BASELINE_BELOW_MIDDLE * lineHeight);
  return `0 ${-half}px ${-drop}px ${-half}px`;
}

export interface SimplePosition {
  line: number;
  character: number;
}

/**
 * The range an effect decoration anchors to: the character just before the caret, so that the
 * `after` attachment renders exactly at the caret. At column 0 an empty range is used.
 */
export function anchorRange(pos: SimplePosition): { start: SimplePosition; end: SimplePosition } {
  // Copy fields explicitly: `vscode.Position` exposes line/character as getters, which spread drops.
  const { line, character } = pos;
  if (character > 0) {
    return { start: { line, character: character - 1 }, end: { line, character } };
  }
  return { start: { line, character }, end: { line, character } };
}

/** Mirrors VS Code's line-height computation (`editor.lineHeight` semantics). */
export function computeLineHeight(
  fontSize: number,
  lineHeightSetting: number,
  isMac: boolean,
): number {
  const size = fontSize > 0 ? fontSize : 14;
  if (lineHeightSetting <= 0) return Math.round(size * (isMac ? 1.5 : 1.35));
  if (lineHeightSetting < 8) return Math.round(size * lineHeightSetting);
  return Math.round(lineHeightSetting);
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
