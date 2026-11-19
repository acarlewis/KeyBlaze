import * as vscode from 'vscode';
import type { ChangeReasonLike, Keystroke } from '../core/TypingClassifier';
import { classifyChange } from '../core/TypingClassifier';
import type { SettingsService } from './SettingsService';

/** URI schemes for real, user-editable text. Output, git, debug consoles etc. are excluded. */
export const TYPING_SCHEMES: ReadonlySet<string> = new Set([
  'file',
  'untitled',
  'vscode-remote',
  'vscode-userdata',
  'vscode-notebook-cell',
  'vscode-vfs',
]);

export interface KeystrokeEvent {
  readonly editor: vscode.TextEditor;
  readonly keystroke: Keystroke;
  readonly positions: readonly vscode.Position[];
}

/**
 * Turns `onDidChangeTextDocument` into a stream of genuine-looking keystrokes in the active editor.
 */
export class TypingDetector implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<KeystrokeEvent>();
  private readonly subscription: vscode.Disposable;

  readonly onKeystroke = this.emitter.event;

  constructor(private readonly settings: SettingsService) {
    this.subscription = vscode.workspace.onDidChangeTextDocument((e) => this.handle(e));
  }

  /** Returns true when effects are allowed for the document (scheme, language and file exclusions). */
  isDocumentEligible(document: vscode.TextDocument): boolean {
    if (!TYPING_SCHEMES.has(document.uri.scheme)) return false;
    const s = this.settings.get();
    if (s.excludeLanguages.includes(document.languageId)) return false;
    for (const pattern of s.excludeFiles) {
      if (vscode.languages.match({ pattern }, document) > 0) return false;
    }
    return true;
  }

  dispose(): void {
    this.subscription.dispose();
    this.emitter.dispose();
  }

  private handle(e: vscode.TextDocumentChangeEvent): void {
    const editor = vscode.window.activeTextEditor;
    // Typing always happens in the focused editor. Changes elsewhere are programmatic.
    if (!editor || editor.document !== e.document) return;
    if (e.contentChanges.length === 0) return;
    if (!this.isDocumentEligible(e.document)) return;

    const keystroke = classifyChange(e.contentChanges, toReason(e.reason), {
      maxCursors: 32,
      triggerOnDelete: this.settings.get().triggerOnDelete,
    });
    if (!keystroke) return;

    const positions = keystroke.positions.map((p) =>
      e.document.validatePosition(new vscode.Position(p.line, p.character)),
    );
    this.emitter.fire({ editor, keystroke, positions });
  }
}

function toReason(reason: vscode.TextDocumentChangeReason | undefined): ChangeReasonLike {
  if (reason === vscode.TextDocumentChangeReason.Undo) return 'undo';
  if (reason === vscode.TextDocumentChangeReason.Redo) return 'redo';
  return undefined;
}
