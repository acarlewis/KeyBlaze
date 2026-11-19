import * as vscode from 'vscode';
import type { Milestone } from '../core/ComboManager';
import { ComboManager } from '../core/ComboManager';
import type { SettingsService } from './SettingsService';
import type { TypingDetector } from './TypingDetector';

export interface ComboChange {
  readonly count: number;
  readonly best: number;
  /** Time left before the combo resets (0 when there is no combo). */
  readonly remainingMs: number;
  /** When this change happened (Date.now()). */
  readonly at: number;
  /** Present when this change reached a milestone. */
  readonly milestone?: Milestone;
  /** The editor typed in (absent for resets). */
  readonly editor?: vscode.TextEditor;
  readonly positions?: readonly vscode.Position[];
}

const BEST_KEY = 'keyblaze.bestCombo';

/**
 * Counts every genuine keystroke into the combo, including keystrokes whose burst was rate-limited.
 * It resets after `combo.resetTime` of inactivity, and persists the best combo in global state.
 */
export class ComboService implements vscode.Disposable {
  private readonly manager: ComboManager;
  private readonly changeEmitter = new vscode.EventEmitter<ComboChange>();
  private readonly milestoneEmitter = new vscode.EventEmitter<
    ComboChange & { milestone: Milestone }
  >();
  private readonly disposables: vscode.Disposable[] = [];
  private resetTimer: ReturnType<typeof setTimeout> | undefined;
  private savedBest: number;

  readonly onDidChange = this.changeEmitter.event;
  readonly onMilestone = this.milestoneEmitter.event;

  constructor(
    private readonly settings: SettingsService,
    detector: TypingDetector,
    private readonly memento?: vscode.Memento,
  ) {
    this.savedBest = memento?.get<number>(BEST_KEY, 0) ?? 0;
    this.manager = new ComboManager(this.config(), Date.now, this.savedBest);
    this.disposables.push(
      detector.onKeystroke((e) => this.onKeystroke(e.editor, e.positions)),
      settings.onDidChange(({ settings: s, changed }) => {
        this.manager.configure(this.config());
        if (
          (changed.has('enabled') && !s.enabled) ||
          (changed.has('combo.enabled') && !s['combo.enabled'])
        ) {
          this.reset();
        }
      }),
    );
  }

  snapshot(): ReturnType<ComboManager['snapshot']> {
    return this.manager.snapshot();
  }

  /** Ends the current combo now (e.g. KeyBlaze disabled). */
  reset(): void {
    if (this.resetTimer !== undefined) clearTimeout(this.resetTimer);
    this.resetTimer = undefined;
    if (this.manager.reset() > 0) this.fireReset();
  }

  dispose(): void {
    if (this.resetTimer !== undefined) clearTimeout(this.resetTimer);
    this.persistBest();
    for (const d of this.disposables) d.dispose();
    this.changeEmitter.dispose();
    this.milestoneEmitter.dispose();
  }

  private onKeystroke(editor: vscode.TextEditor, positions: readonly vscode.Position[]): void {
    const s = this.settings.get();
    if (!s.enabled || !s['combo.enabled']) return;
    const hit = this.manager.hit();
    const snap = this.manager.snapshot();
    const change: ComboChange = {
      count: hit.count,
      best: snap.best,
      remainingMs: snap.remainingMs,
      at: Date.now(),
      editor,
      positions,
      ...(hit.milestone ? { milestone: hit.milestone } : {}),
    };
    this.scheduleReset();
    this.changeEmitter.fire(change);
    if (hit.milestone) this.milestoneEmitter.fire({ ...change, milestone: hit.milestone });
  }

  private scheduleReset(): void {
    if (this.resetTimer !== undefined) clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => {
      this.resetTimer = undefined;
      if (this.manager.expire() > 0) this.fireReset();
      else if (this.manager.snapshot().count > 0) this.scheduleReset(); // clock skew: check again
    }, this.settings.get()['combo.resetTime'] + 25);
  }

  private fireReset(): void {
    this.persistBest();
    this.changeEmitter.fire({
      count: 0,
      best: this.manager.snapshot().best,
      remainingMs: 0,
      at: Date.now(),
    });
  }

  private persistBest(): void {
    const best = this.manager.snapshot().best;
    if (this.memento && best > this.savedBest) {
      this.savedBest = best;
      void this.memento.update(BEST_KEY, best);
    }
  }

  private config(): { resetTimeMs: number; milestones: readonly number[] } {
    const s = this.settings.get();
    return { resetTimeMs: s['combo.resetTime'], milestones: s['combo.milestones'] };
  }
}
