import * as vscode from 'vscode';
import type { CaretContext, PlacementSetting, WordWrapSetting } from '../core/placement';
import { visualColumn } from '../core/placement';
import { computeLineHeight } from '../render/geometry';
import type { InlayHintTracker } from './InlayHintTracker';

export interface FontMetrics {
  readonly fontSize: number;
  readonly lineHeight: number;
}

/** Font metrics from editor settings. Editor font zoom is not observable through the API. */
export function editorFontMetrics(document?: vscode.TextDocument): FontMetrics {
  const config = vscode.workspace.getConfiguration('editor', document);
  const fontSize = config.get<number>('fontSize', 14);
  const lineHeight = config.get<number>('lineHeight', 0);
  return {
    fontSize,
    lineHeight: computeLineHeight(fontSize, lineHeight, process.platform === 'darwin'),
  };
}

/** Builds the placement context for one caret. Cheap and synchronous: called per keystroke and cursor. */
export function caretContext(
  editor: vscode.TextEditor,
  position: vscode.Position,
  placement: PlacementSetting,
  inlayHints: InlayHintTracker | undefined,
): CaretContext {
  const document = editor.document;
  const config = vscode.workspace.getConfiguration('editor', document);
  const tabSize = typeof editor.options.tabSize === 'number' ? editor.options.tabSize : 4;
  const { fontSize, lineHeight } = editorFontMetrics(document);
  const lineText = document.lineAt(position.line).text;
  return {
    line: position.line,
    character: position.character,
    lineText,
    lineCount: document.lineCount,
    tabSize,
    lineHeight,
    fontSize,
    wordWrap: config.get<WordWrapSetting>('wordWrap', 'off'),
    wordWrapColumn: config.get<number>('wordWrapColumn', 80),
    lineVisualLength: (line) => {
      if (line < 0 || line >= document.lineCount) return 0;
      const text = document.lineAt(line).text;
      return visualColumn(text, text.length, tabSize);
    },
    visibleRanges: editor.visibleRanges.map((r) => [r.start.line, r.end.line] as const),
    inlayHintBeforeCaret: inlayHints?.hasHintBefore(document, position) ?? false,
    placement,
  };
}
