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
