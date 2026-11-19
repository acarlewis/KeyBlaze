import * as vscode from 'vscode';
import { displayThreshold } from '../core/ComboManager';
import { impactAmplitude, impactDuration, tierColor } from '../core/impact';
import { renderComboBadge } from '../render/ComboBadge';
import { svgToDataUri } from '../render/svg';
import type { Logger } from '../utils/logger';
import type { ComboChange, ComboService } from './ComboService';
import { editorFontMetrics } from './EditorMetrics';
import type { SettingsService } from './SettingsService';

/** Minimum time between badge re-renders while typing (each re-render is a new image). */
const UPDATE_INTERVAL_MS = 110;

/**
 * Draws the combo badge after the end of the caret line, next to the code and never over it.
 * Zero layout height: its bottom sits on the line's baseline and the pill fits inside one line.
 */
export class ComboIndicator implements vscode.Disposable {
  private readonly type = vscode.window.createTextEditorDecorationType({
    // OpenOpen: the empty range at the line end widens as you type there, so the badge stays after the text.
    rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
  });
  private readonly disposables: vscode.Disposable[] = [];
  private editor: vscode.TextEditor | undefined;
  private pending: ComboChange | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastRender = 0;
  private nonce = 0;
  private renders = 0;

  constructor(
    private readonly settings: SettingsService,
    combo: ComboService,
    private readonly logger: Logger,
  ) {
    this.disposables.push(
      combo.onDidChange((c) => this.onChange(c)),
      settings.onDidChange(({ settings: s }) => {
        if (!s.enabled || !s['combo.enabled'] || !s['combo.showIndicator']) this.clear();
      }),
      vscode.window.onDidChangeActiveTextEditor((e) => {
        if (e !== this.editor) this.clear();
      }),
    );
  }

  /** Number of badge renders so far (diagnostics/tests). */
  get renderCount(): number {
    return this.renders;
  }

  get visible(): boolean {
    return this.editor !== undefined;
  }

  dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    for (const d of this.disposables) d.dispose();
    this.type.dispose();
  }

  private onChange(change: ComboChange): void {
    const s = this.settings.get();
    if (!s.enabled || !s['combo.enabled'] || !s['combo.showIndicator']) return;
    if (change.count < displayThreshold(s['combo.milestones']) || !change.editor) {
      if (change.count === 0) this.clear();
      return;
    }
    this.pending = change;
    const wait = UPDATE_INTERVAL_MS - (Date.now() - this.lastRender);
    if (change.milestone || wait <= 0) {
      this.flush();
    } else if (this.timer === undefined) {
      this.timer = setTimeout(() => this.flush(), wait);
    }
  }

  private flush(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    const change = this.pending;
    this.pending = undefined;
    if (!change?.editor) return;
    try {
      this.render(change.editor, change);
    } catch (err) {
      this.logger.error('Combo badge failed', err);
    }
  }

  private render(editor: vscode.TextEditor, change: ComboChange): void {
    const s = this.settings.get();
    if (this.editor && this.editor !== editor) this.clear();
    const { lineHeight } = editorFontMetrics(editor.document);
    const milestone = change.milestone;
    const shake =
      milestone && s['screenShake.enabled']
        ? {
            amplitude: impactAmplitude(
              { intensity: s['screenShake.intensity'], durationMs: s['screenShake.duration'] },
              milestone,
            ),
            durationMs: impactDuration(
              { intensity: s['screenShake.intensity'], durationMs: s['screenShake.duration'] },
              milestone,
            ),
          }
        : undefined;
    const badge = renderComboBadge({
      count: change.count,
      lineHeight,
      color: tierColor(change.count, s['combo.milestones'], s.colors),
      remainingMs: change.remainingMs - (Date.now() - change.at),
      celebrate: milestone !== undefined,
      ...(shake ? { shake } : {}),
      nonce: `${Date.now().toString(36)}.${(++this.nonce).toString(36)}`,
    });
    const line = editor.selection.active.line;
    const end = editor.document.lineAt(line).range.end;
    editor.setDecorations(this.type, [
      {
        range: new vscode.Range(end, end),
        renderOptions: {
          after: {
            contentIconPath: vscode.Uri.parse(svgToDataUri(badge.svg)),
            width: `${badge.width}px`,
            height: `${badge.height}px`,
            margin: `${-badge.height}px 0 0 2ch`,
          },
        },
      },
    ]);
    this.editor = editor;
    this.lastRender = Date.now();
    this.renders++;
  }

  private clear(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
    const editor = this.editor;
    this.editor = undefined;
    if (!editor) return;
    try {
      editor.setDecorations(this.type, []);
    } catch {
      // Editor closed.
    }
  }
}
