import * as vscode from 'vscode';
import type {
  AccessibilitySupportSetting,
  Environment,
  MotionPolicy,
  ReduceMotionSetting,
} from '../core/motion';
import { computePolicy } from '../core/motion';
import type { SettingsService } from './SettingsService';

const OS_REDUCED_MOTION_KEY = 'keyblaze.osPrefersReducedMotion';

/**
 * Tracks window focus, `workbench.reduceMotion`, `editor.accessibilitySupport` and the OS reduced-motion
 * preference (reported by KeyBlaze webviews, remembered across sessions), and publishes the resulting
 * MotionPolicy. Every effect service consults `policy` before doing any work.
 */
export class EnvironmentService implements vscode.Disposable {
  private env: Environment;
  private current: MotionPolicy;
  private osPrefersReducedMotion: boolean | undefined;
  private testOverride: Partial<Environment> = {};
  private readonly emitter = new vscode.EventEmitter<MotionPolicy>();
  private readonly disposables: vscode.Disposable[] = [];

  readonly onDidChange = this.emitter.event;

  constructor(
    private readonly settings: SettingsService,
    private readonly memento?: vscode.Memento,
  ) {
    this.osPrefersReducedMotion = memento?.get<boolean>(OS_REDUCED_MOTION_KEY);
    this.env = this.read();
    this.current = this.compute();
    this.disposables.push(
      vscode.window.onDidChangeWindowState(() => this.refresh()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration('workbench.reduceMotion') ||
          e.affectsConfiguration('editor.accessibilitySupport')
        ) {
          this.refresh();
        }
      }),
      settings.onDidChange(() => this.refresh()),
    );
  }

  get policy(): MotionPolicy {
    return this.current;
  }

  get environment(): Environment {
    return { ...this.env, ...this.testOverride };
  }

  /** Called by webviews, which can evaluate `prefers-reduced-motion`. */
  setOsPrefersReducedMotion(value: boolean): void {
    if (this.osPrefersReducedMotion === value) return;
    this.osPrefersReducedMotion = value;
    void this.memento?.update(OS_REDUCED_MOTION_KEY, value);
    this.refresh();
  }

  /** Test hook: pin parts of the environment (e.g. window focus in a headless test window). */
  setTestOverride(override: Partial<Environment>): void {
    this.testOverride = { ...override };
    this.refresh();
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.emitter.dispose();
  }

  private read(): Environment {
    return {
      windowFocused: vscode.window.state.focused,
      reduceMotion: vscode.workspace
        .getConfiguration('workbench')
        .get<ReduceMotionSetting>('reduceMotion', 'auto'),
      osPrefersReducedMotion: this.osPrefersReducedMotion,
      accessibilitySupport: vscode.workspace
        .getConfiguration('editor')
        .get<AccessibilitySupportSetting>('accessibilitySupport', 'auto'),
    };
  }

  private refresh(): void {
    this.env = this.read();
    this.publish();
  }

  private publish(): void {
    const next = this.compute();
    const changed = JSON.stringify(next) !== JSON.stringify(this.current);
    this.current = next;
    if (changed) this.emitter.fire(next);
  }

  private compute(): MotionPolicy {
    return computePolicy(this.settings.get(), this.environment);
  }
}
