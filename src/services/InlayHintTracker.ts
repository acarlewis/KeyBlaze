import * as vscode from 'vscode';

const REFRESH_DELAY_MS = 400;

/**
 * Remembers where inlay hints are rendered in the active editor's visible range, so that placement can
 * avoid below-anchoring on lines where hints shift the caret horizontally (their width can't be
 * computed in `ch`).
 *
 * Hint providers are asynchronous and can be costly, so they are queried through the official
 * `vscode.executeInlayHintProvider` command only after typing or scrolling pauses, never per keystroke.
 * Between refreshes the cache can be stale. A stale entry only changes whether a burst is full-circle
 * or rising, never its correctness.
 */
export class InlayHintTracker implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private cacheUri: string | undefined;
  /** line → smallest character position of a hint on that line. */
  private firstHintByLine = new Map<number, number>();
  private generation = 0;

  /**
   * @param isNeeded only query providers when the result can matter: KeyBlaze active and `placement`
   * set to `auto`. Otherwise the tracker does no background work at all.
   */
  constructor(private readonly isNeeded: () => boolean = () => true) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.schedule()),
      vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
        if (e.textEditor === vscode.window.activeTextEditor) this.schedule();
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document === vscode.window.activeTextEditor?.document) this.schedule();
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('editor.inlayHints')) this.schedule();
      }),
    );
    this.schedule();
  }

  hasHintBefore(document: vscode.TextDocument, position: vscode.Position): boolean {
    if (document.uri.toString() !== this.cacheUri) return false;
    const first = this.firstHintByLine.get(position.line);
    return first !== undefined && first < position.character;
  }

  dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    for (const d of this.disposables) d.dispose();
  }

  private schedule(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.isNeeded()) return;
    this.timer = setTimeout(() => void this.refresh(), REFRESH_DELAY_MS);
  }

  private async refresh(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const generation = ++this.generation;
    if (!editor || !hintsEnabled(editor.document)) {
      this.cacheUri = undefined;
      this.firstHintByLine = new Map();
      return;
    }
    const visible = editor.visibleRanges;
    const first = visible[0];
    const last = visible[visible.length - 1];
    if (!first || !last) return;
    const range = new vscode.Range(first.start, last.end);
    try {
      const hints = await vscode.commands.executeCommand<vscode.InlayHint[] | undefined>(
        'vscode.executeInlayHintProvider',
        editor.document.uri,
        range,
      );
      if (generation !== this.generation) return; // a newer refresh superseded this one
      const map = new Map<number, number>();
      for (const hint of hints ?? []) {
        const { line, character } = hint.position;
        map.set(line, Math.min(map.get(line) ?? Number.POSITIVE_INFINITY, character));
      }
      this.cacheUri = editor.document.uri.toString();
      this.firstHintByLine = map;
    } catch {
      // No provider or provider failure: treat as no hints.
    }
  }
}

function hintsEnabled(document: vscode.TextDocument): boolean {
  const value = vscode.workspace
    .getConfiguration('editor.inlayHints', document)
    .get<string>('enabled', 'on');
  return value === 'on' || value === 'onUnlessPressed';
}
