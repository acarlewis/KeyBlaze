import * as vscode from 'vscode';
import { computeLineHeight } from '../render/geometry';

/** Reads font metrics from editor settings. Line height is needed for vertical centring. */
export function editorLineHeight(document?: vscode.TextDocument): number {
  const config = vscode.workspace.getConfiguration('editor', document);
  const fontSize = config.get<number>('fontSize', 14);
  const lineHeight = config.get<number>('lineHeight', 0);
  return computeLineHeight(fontSize, lineHeight, process.platform === 'darwin');
}
