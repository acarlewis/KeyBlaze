/**
 * Decides whether a document change looks like genuine user typing, and where each cursor ended up.
 * Pure module: no `vscode` import, so it is fully unit-testable.
 *
 * VS Code cannot tell a real keystroke from a small edit made by an extension, so this is a
 * deliberately conservative heuristic. It accepts the edit shapes that keyboard input produces and
 * rejects pastes, formatting, completions, refactors, undo/redo and bulk edits.
 */

export interface PositionLike {
  readonly line: number;
  readonly character: number;
}

export interface RangeLike {
  readonly start: PositionLike;
  readonly end: PositionLike;
}

export interface ChangeLike {
  readonly range: RangeLike;
  readonly rangeOffset: number;
  readonly rangeLength: number;
  readonly text: string;
}

export type ChangeReasonLike = 'undo' | 'redo' | undefined;

export type KeystrokeKind = 'insert' | 'delete';

export interface Keystroke {
  readonly kind: KeystrokeKind;
  /** Post-edit cursor position for every cursor that typed (multi-cursor aware). */
  readonly positions: PositionLike[];
}

export interface ClassifyOptions {
  /** Maximum simultaneous cursors treated as typing. More ranges are treated as a bulk edit. */
  readonly maxCursors: number;
  readonly triggerOnDelete: boolean;
}

export const DEFAULT_CLASSIFY_OPTIONS: ClassifyOptions = { maxCursors: 32, triggerOnDelete: true };

/** Longest deletion still treated as a keystroke (Backspace over indentation, Ctrl+Backspace on a word). */
export const MAX_DELETE_LENGTH = 24;

const AUTO_CLOSE_PAIRS = new Set(['()', '[]', '{}', '""', "''", '``', '<>']);
// Enter (optionally with auto-indent), or Enter between brackets (two newlines plus indentation).
const ENTER_PATTERN = /^\r?\n[ \t]*(\r?\n[ \t]*)?$/;
// Tab key with "insert spaces" enabled.
const TAB_AS_SPACES = /^ {2,8}$/;

type ChangeShape = 'insert' | 'delete' | 'invalid';

export function classifyChangeShape(change: ChangeLike): ChangeShape {
  const { text, rangeLength } = change;
  if (text.length === 0) {
    return rangeLength > 0 && rangeLength <= MAX_DELETE_LENGTH ? 'delete' : 'invalid';
  }
  if (isTypedText(text)) return 'insert';
  return 'invalid';
}

export function isTypedText(text: string): boolean {
  // Count code points so astral characters (emoji, some IME output) are a single keystroke.
  const codePoints = [...text];
  if (codePoints.length === 1) return true;
  if (AUTO_CLOSE_PAIRS.has(text)) return true;
  if (ENTER_PATTERN.test(text)) return true;
  if (TAB_AS_SPACES.test(text)) return true;
  return false;
}

/**
 * Classifies a whole `onDidChangeTextDocument` event.
 * Returns `undefined` when the change should not trigger effects.
 */
export function classifyChange(
  changes: readonly ChangeLike[],
  reason: ChangeReasonLike,
  options: ClassifyOptions = DEFAULT_CLASSIFY_OPTIONS,
): Keystroke | undefined {
  if (reason === 'undo' || reason === 'redo') return undefined;
  if (changes.length === 0 || changes.length > options.maxCursors) return undefined;

  let sawInsert = false;
  let firstText: string | undefined;
  for (const change of changes) {
    const shape = classifyChangeShape(change);
    if (shape === 'invalid') return undefined;
    if (shape === 'insert') {
      sawInsert = true;
      // Multi-cursor typing inserts the same text at every cursor. Different texts at different
      // ranges usually mean a programmatic edit (e.g. rename, code action).
      if (firstText === undefined) firstText = change.text;
      else if (firstText !== change.text) return undefined;
    }
  }

  const kind: KeystrokeKind = sawInsert ? 'insert' : 'delete';
  if (kind === 'delete' && !options.triggerOnDelete) return undefined;
  return { kind, positions: mapPostEditPositions(changes) };
}

/**
 * Maps each change to the caret position it produces in the post-edit document.
 *
 * `contentChanges` ranges are expressed in pre-edit coordinates, so changes earlier in the document
 * shift the later ones. For an auto-closed pair such as `()` the caret sits between the characters.
 */
export function mapPostEditPositions(changes: readonly ChangeLike[]): PositionLike[] {
  const sorted = [...changes].sort((a, b) => a.rangeOffset - b.rangeOffset);
  const positions: PositionLike[] = [];

  let lineDelta = 0;
  let colDelta = 0;
  let lastEndLine = -1;

  for (const change of sorted) {
    const { start, end } = change.range;
    if (start.line !== lastEndLine) colDelta = 0;

    const newStartLine = start.line + lineDelta;
    const newStartCol = start.character + colDelta;

    const text = change.text.replace(/\r\n/g, '\n');
    const lines = text.split('\n');
    const insertedLineBreaks = lines.length - 1;
    const lastLine = lines[lines.length - 1] ?? '';

    const endLine = newStartLine + insertedLineBreaks;
    const endCol = insertedLineBreaks > 0 ? lastLine.length : newStartCol + text.length;

    if (AUTO_CLOSE_PAIRS.has(text)) {
      positions.push({ line: newStartLine, character: newStartCol + 1 });
    } else if (text.length === 0) {
      positions.push({ line: newStartLine, character: newStartCol });
    } else {
      positions.push({ line: endLine, character: endCol });
    }

    lineDelta += insertedLineBreaks - (end.line - start.line);
    colDelta = endCol - end.character;
    lastEndLine = end.line;
  }
  return positions;
}
