import type * as vscode from 'vscode';
import { KEY_SOUND_MIN_GAP_MS } from '../core/sound';
import type { SoundViewProvider } from '../providers/SoundViewProvider';
import type { ComboService } from './ComboService';
import type { SettingsService } from './SettingsService';
import type { TypingDetector } from './TypingDetector';

/**
 * Decides when to play sounds: milestone chimes (default mode), or a subtle sound on every keystroke
 * (`sound.mode: everyKeystroke`, at most one per 45 ms). Gating by accessibility, focus and the enabled
 * setting happens in SoundViewProvider through the motion policy.
 */
export class SoundService implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private lastKeyAt = 0;

  constructor(
    private readonly settings: SettingsService,
    detector: TypingDetector,
    combo: ComboService,
    private readonly view: SoundViewProvider,
  ) {
    this.disposables.push(
      combo.onMilestone((m) => {
        this.view.play('milestone', m.milestone.tier);
      }),
      detector.onKeystroke(() => {
        if (this.settings.get()['sound.mode'] !== 'everyKeystroke') return;
        const now = Date.now();
        if (now - this.lastKeyAt < KEY_SOUND_MIN_GAP_MS) return;
        this.lastKeyAt = now;
        this.view.play('key');
      }),
    );
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
