/**
 * Where to attach a burst so that its origin lands on the caret. Pure: no `vscode` import.
 *
 * Facts measured in the rendering spike (docs/SPIKE_REPORT.md §Q2):
 *  - A decoration image (`::after { content: url() }`) has its BOTTOM pinned to the anchor line's text
 *    baseline. Margins never move it vertically.
 *  - margin-top = -height gives it zero layout height. Anything less negative pushes the line's text.
 *  - margin-left/right = -width/2 centres it on the anchor position with zero net width (sub-pixel exact).
 *  - The baseline sits ≈ 0.293em below the line's middle (Consolas: (ascent − descent) / 2).
 *
 * Two anchors follow from that:
 *  - caret: on the caret line. Exact everywhere (VS Code lays it out), but the image can only extend
 *    upward from the baseline, so effects use their `upward` variant.
 *  - below: at column 0 of a line N below the caret, shifted right by the caret's visual column in `ch`,
 *    with the SVG padded so that its origin lands on the caret line. Allows full-circle effects, but it
 *    assumes monospace columns and unwrapped, unfolded, visible lines in between, so it is only used
 *    when those hold.
 */

export type AnchorMode = 'caret' | 'below';
export type EffectVariant = 'full' | 'upward';
export type PlacementSetting = 'auto' | 'cursorLine';
export type WordWrapSetting = 'off' | 'on' | 'wordWrapColumn' | 'bounded';

/** Baseline offset below the line middle, in em (measured for Consolas; within ~1px for common code fonts). */
export const BASELINE_EM = 0.293;
/** Never pad more than this many lines below the caret. */
export const MAX_BELOW_LINES = 8;
/** With `wordWrap: on/bounded` the wrap column is unknown; lines shorter than this are assumed unwrapped. */
export const WRAP_SAFE_COLUMN = 40;

export interface CaretContext {
  readonly line: number;
  readonly character: number;
  /** Text of the caret line. */
  readonly lineText: string;
  readonly lineCount: number;
  readonly tabSize: number;
  /** Rendered line height and font size in px (from editor settings). */
  readonly lineHeight: number;
  readonly fontSize: number;
  readonly wordWrap: WordWrapSetting;
  readonly wordWrapColumn: number;
  /** Visual length of any document line (tabs expanded). */
  lineVisualLength(line: number): number;
  /** Editor visible ranges as [startLine, endLine] (folds split them). */
  readonly visibleRanges: readonly (readonly [number, number])[];
  /** True when an inlay hint is rendered before the caret on the caret line. */
  readonly inlayHintBeforeCaret: boolean;
  readonly placement: PlacementSetting;
}

export type FallbackReason =
  'setting' | 'wideCharacters' | 'inlayHints' | 'endOfDocument' | 'notVisible' | 'wordWrap';

export interface AnchorDecision {
  readonly mode: AnchorMode;
  readonly variant: EffectVariant;
  /** Why `caret` was chosen instead of `below` (absent when below-anchoring was possible). */
  readonly reason?: FallbackReason;
}

export interface Layout {
  readonly mode: AnchorMode;
  /** Decoration range (single line). */
  readonly line: number;
  readonly startCharacter: number;
  readonly endCharacter: number;
  /** Image size in px and the origin's y within the image. The origin's x is always width / 2. */
  readonly width: number;
  readonly height: number;
  readonly originY: number;
  /** CSS margin for the attachment: zero layout height and zero net width. */
  readonly margin: string;
}

export function baselineOffset(fontSize: number): number {
  return BASELINE_EM * fontSize;
}

/** Visual column of `character` in `text`, expanding tabs to tab stops like the editor. */
export function visualColumn(text: string, character: number, tabSize: number): number {
  let col = 0;
  const end = Math.min(character, text.length);
  for (let i = 0; i < end; i++) {
    col = text.charCodeAt(i) === 9 ? col + tabSize - (col % tabSize) : col + 1;
  }
  return col;
}

/**
 * True when `text` contains characters whose rendered width is not one monospace column:
 * CJK/Hangul/emoji and other wide scripts (U+1100 and up), astral characters, combining marks
 * and zero-width characters.
 */
export function hasNonColumnCharacters(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0x1100) return true;
    if (c >= 0x0300 && c <= 0x036f) return true;
  }
  return false;
}

/** Lines needed below the caret so that an image extending `down` px below the origin is not clipped. */
export function linesBelowFor(down: number, lineHeight: number, fontSize: number): number {
  const needed = Math.ceil((down - baselineOffset(fontSize)) / Math.max(1, lineHeight));
  return Math.min(MAX_BELOW_LINES, Math.max(0, needed));
}

/**
 * Chooses the anchor before simulating, from the worst-case downward extent (`maxDown`, the quality
 * profile's half-extent cap), so that the actual burst always fits the lines that were checked.
 */
export function decideAnchor(ctx: CaretContext, maxDown: number): AnchorDecision {
  const caretUpward = (reason: FallbackReason): AnchorDecision => ({
    mode: 'caret',
    variant: 'upward',
    reason,
  });
  if (ctx.placement === 'cursorLine') return caretUpward('setting');

  const n = linesBelowFor(maxDown, ctx.lineHeight, ctx.fontSize);
  if (n === 0) return { mode: 'caret', variant: 'full' };

  if (hasNonColumnCharacters(ctx.lineText.slice(0, ctx.character))) {
    return caretUpward('wideCharacters');
  }
  if (ctx.inlayHintBeforeCaret) return caretUpward('inlayHints');

  const last = ctx.line + n;
  if (last > ctx.lineCount - 1) return caretUpward('endOfDocument');

  // The caret line and every line down to the anchor must be in one contiguous visible range:
  // folded lines are not rendered, and off-screen anchor lines are virtualised away.
  const contiguous = ctx.visibleRanges.some(([start, end]) => start <= ctx.line && end >= last);
  if (!contiguous) return caretUpward('notVisible');

  if (ctx.wordWrap !== 'off') {
    const wrapAt = ctx.wordWrap === 'wordWrapColumn' ? ctx.wordWrapColumn : WRAP_SAFE_COLUMN;
    for (let l = ctx.line; l < last; l++) {
      if (ctx.lineVisualLength(l) >= wrapAt) return caretUpward('wordWrap');
    }
  }
  return { mode: 'below', variant: 'full' };
}

/** Computes the decoration geometry for a simulated burst with extents `halfWidth`, `up`, `down`. */
export function layoutBurst(
  extents: { readonly halfWidth: number; readonly up: number; readonly down: number },
  mode: AnchorMode,
  ctx: Pick<
    CaretContext,
    'line' | 'character' | 'lineText' | 'tabSize' | 'lineHeight' | 'fontSize'
  >,
): Layout {
  const hw = extents.halfWidth;
  const width = hw * 2;
  const b = baselineOffset(ctx.fontSize);
  const n = mode === 'below' ? linesBelowFor(extents.down, ctx.lineHeight, ctx.fontSize) : 0;

  if (n === 0) {
    // Caret-anchored: the image bottom sits on the caret line's baseline, b px below the middle.
    // Anything the burst draws more than b px below the origin is clipped by the image bounds.
    const height = Math.max(1, Math.round(extents.up + b));
    const start = ctx.character > 0 ? ctx.character - 1 : 0;
    return {
      mode: 'caret',
      line: ctx.line,
      startCharacter: start,
      endCharacter: ctx.character,
      width,
      height,
      originY: height - b,
      margin: `${-height}px ${px(-hw)} 0 ${px(-hw)}`,
    };
  }

  // Below-anchored: bottom on the baseline of line+n, which is n·lineHeight + b below the origin.
  const height = Math.max(1, Math.round(extents.up + n * ctx.lineHeight + b));
  const v = visualColumn(ctx.lineText, ctx.character, ctx.tabSize);
  return {
    mode: 'below',
    line: ctx.line + n,
    startCharacter: 0,
    endCharacter: 0,
    width,
    height,
    originY: height - n * ctx.lineHeight - b,
    margin: `${-height}px calc(${-v}ch - ${hw}px) 0 calc(${v}ch - ${hw}px)`,
  };
}

function px(n: number): string {
  return `${Math.round(n * 10) / 10}px`;
}
