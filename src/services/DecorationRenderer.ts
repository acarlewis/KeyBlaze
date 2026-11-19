import * as vscode from 'vscode';
import { anchorRange, attachmentMargin } from '../render/geometry';
import type { Logger } from '../utils/logger';

export interface EffectImage {
  readonly uri: vscode.Uri;
  readonly width: number;
  readonly height: number;
}

export interface BurstPlacement {
  readonly position: vscode.Position;
  readonly image: EffectImage;
}

interface Slot {
  readonly type: vscode.TextEditorDecorationType;
  editor: vscode.TextEditor | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
  startedAt: number;
}

/**
 * A fixed ring of decoration types ("slots"). Each burst occupies one slot for its lifetime.
 * Setting decorations on one slot never re-renders another slot's burst, the number of live DOM
 * nodes and CSS rules is capped, and the oldest burst is recycled when the pool is full.
 */
export class DecorationSlotPool implements vscode.Disposable {
  private slots: Slot[] = [];
  private disposed = false;

  constructor(
    size: number,
    private readonly logger: Logger,
  ) {
    this.resize(size);
  }

  get size(): number {
    return this.slots.length;
  }

  get activeCount(): number {
    return this.slots.filter((s) => s.editor !== undefined).length;
  }

  /** Shows one burst (possibly at several cursors) in `editor` for `lifetimeMs`. */
  show(
    editor: vscode.TextEditor,
    placements: readonly BurstPlacement[],
    lifetimeMs: number,
    lineHeight: number,
  ): boolean {
    if (this.disposed || placements.length === 0) return false;
    const slot = this.acquire();
    if (!slot) return false;

    const options: vscode.DecorationOptions[] = placements.map(({ position, image }) => {
      const r = anchorRange(position);
      return {
        range: new vscode.Range(r.start.line, r.start.character, r.end.line, r.end.character),
        renderOptions: {
          after: {
            contentIconPath: image.uri,
            width: `${image.width}px`,
            height: `${image.height}px`,
            margin: attachmentMargin(image.width, image.height, lineHeight),
          },
        },
      };
    });

    try {
      editor.setDecorations(slot.type, options);
    } catch (err) {
      this.logger.error('Failed to set effect decoration', err);
      return false;
    }
    slot.editor = editor;
    slot.startedAt = Date.now();
    slot.timer = setTimeout(() => this.release(slot), lifetimeMs);
    return true;
  }

  /** Changes the pool size. Shrinking disposes surplus slots (and their bursts). */
  resize(size: number): void {
    const target = Math.max(1, Math.floor(size));
    while (this.slots.length < target) {
      this.slots.push({
        type: vscode.window.createTextEditorDecorationType({
          rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
        }),
        editor: undefined,
        timer: undefined,
        startedAt: 0,
      });
    }
    while (this.slots.length > target) {
      const slot = this.slots.pop();
      if (slot) {
        this.release(slot);
        slot.type.dispose();
      }
    }
  }

  clearAll(): void {
    for (const slot of this.slots) this.release(slot);
  }

  dispose(): void {
    this.disposed = true;
    for (const slot of this.slots) {
      this.release(slot);
      slot.type.dispose();
    }
    this.slots = [];
  }

  private acquire(): Slot | undefined {
    const free = this.slots.find((s) => s.editor === undefined);
    if (free) return free;
    let oldest: Slot | undefined;
    for (const s of this.slots) if (!oldest || s.startedAt < oldest.startedAt) oldest = s;
    if (oldest) this.release(oldest);
    return oldest;
  }

  private release(slot: Slot): void {
    if (slot.timer !== undefined) clearTimeout(slot.timer);
    slot.timer = undefined;
    const editor = slot.editor;
    slot.editor = undefined;
    if (!editor) return;
    try {
      editor.setDecorations(slot.type, []);
    } catch {
      // The editor may have been closed. Nothing is rendered there any more.
    }
  }
}
