import * as vscode from 'vscode';
import { registerCommands } from './commands/registerCommands';
import type { KeyBlazeSettings } from './config/schema';
import type { Environment, MotionPolicy } from './core/motion';
import { ControlPanelProvider } from './providers/ControlPanelProvider';
import { SOUND_VIEW_ID, SoundViewProvider } from './providers/SoundViewProvider';
import { ComboIndicator } from './services/ComboIndicator';
import { ComboService } from './services/ComboService';
import { CursorEffects } from './services/CursorEffects';
import { DecorationSlotPool } from './services/DecorationRenderer';
import type { LastBurstInfo } from './services/EffectsController';
import { EffectsController } from './services/EffectsController';
import { EnvironmentService } from './services/EnvironmentService';
import { ImpactPulse } from './services/ImpactPulse';
import { InlayHintTracker } from './services/InlayHintTracker';
import { SettingsService } from './services/SettingsService';
import { SoundService } from './services/SoundService';
import { StatusBarService } from './services/StatusBarService';
import type { KeystrokeEvent } from './services/TypingDetector';
import { TypingDetector } from './services/TypingDetector';
import { Logger } from './utils/logger';

/**
 * Small diagnostic API returned from `activate`. It's intended for the integration tests and is
 * not a stable public API.
 */
export interface KeyBlazeApi {
  getSettings(): Readonly<KeyBlazeSettings>;
  onKeystroke: vscode.Event<KeystrokeEvent>;
  getStats(): {
    totalBursts: number;
    activeBursts: number;
    poolSize: number;
    statusText: string;
    lastBurst: LastBurstInfo | undefined;
    combo: { count: number; best: number; remainingMs: number };
    comboBadgeVisible: boolean;
    comboBadgeRenders: number;
    celebrations: number;
    cursorEffects: { auraVisible: boolean; oneShots: number };
    controlPanel: ControlPanelProvider['stats'];
    policy: MotionPolicy;
    sound: SoundViewProvider['stats'];
  };
  /** Test hook: pin parts of the environment (window focus, reduce motion, screen reader). */
  setEnvironmentOverride(override: Partial<Environment>): void;
  /** Test hook: feed a raw message to the Control Panel host handler. */
  sendControlPanelMessage(message: unknown): Promise<boolean>;
}

export interface CreateOptions {
  /**
   * Register process-wide contributions (commands and the Sound view provider). Only one instance may
   * do this. Tests create extra, isolated instances with `false` to verify disposal.
   */
  readonly registerGlobals?: boolean;
  /** Output channel name (isolated test instances use their own). */
  readonly logName?: string;
}

/** Context members KeyBlaze needs: lets tests build an isolated instance with a fake context. */
export type KeyBlazeContext = Pick<
  vscode.ExtensionContext,
  'subscriptions' | 'globalState' | 'extensionUri' | 'extension'
>;

export function activate(context: vscode.ExtensionContext): KeyBlazeApi {
  return createKeyBlaze(context);
}

/**
 * Composition root. Everything created here is pushed onto `context.subscriptions`, so disposing them
 * (which VS Code does on deactivation) removes every listener, timer, decoration, status bar item and
 * webview.
 */
export function createKeyBlaze(context: KeyBlazeContext, options: CreateOptions = {}): KeyBlazeApi {
  const registerGlobals = options.registerGlobals ?? true;
  const logger = new Logger(options.logName);
  const settings = new SettingsService();
  const env = new EnvironmentService(settings, context.globalState);
  const pool = new DecorationSlotPool(settings.get()['performance.maxConcurrentBursts'], logger);
  const detector = new TypingDetector(settings);
  const inlayHints = new InlayHintTracker(
    () => env.policy.active && settings.get().placement === 'auto',
  );
  const effects = new EffectsController(settings, detector, pool, logger, inlayHints, env);
  const combo = new ComboService(settings, detector, context.globalState, env);
  const comboIndicator = new ComboIndicator(settings, combo, logger, env);
  const impact = new ImpactPulse(settings, combo, effects, logger, env);
  const cursorEffects = new CursorEffects(settings, detector, inlayHints, logger, env);
  const statusBar = new StatusBarService(settings, combo, env);
  const controlPanel = new ControlPanelProvider(context, settings, combo, logger, env);
  const soundView = new SoundViewProvider(context, settings, env, logger);
  const sound = new SoundService(settings, detector, combo, soundView);

  context.subscriptions.push(
    logger,
    settings,
    env,
    pool,
    detector,
    inlayHints,
    effects,
    combo,
    comboIndicator,
    impact,
    cursorEffects,
    statusBar,
    controlPanel,
    soundView,
    sound,
  );
  if (registerGlobals) {
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(SOUND_VIEW_ID, soundView, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
      ...registerCommands({ context, settings, effects, pool, logger, controlPanel, soundView }),
    );
  }

  logger.info(`KeyBlaze activated (VS Code ${vscode.version}).`);

  return {
    getSettings: () => settings.get(),
    onKeystroke: detector.onKeystroke,
    getStats: () => ({
      totalBursts: effects.totalBursts,
      activeBursts: pool.activeCount,
      poolSize: pool.size,
      statusText: statusBar.text,
      lastBurst: effects.lastBurst,
      combo: combo.snapshot(),
      comboBadgeVisible: comboIndicator.visible,
      comboBadgeRenders: comboIndicator.renderCount,
      celebrations: impact.celebrationCount,
      cursorEffects: cursorEffects.stats,
      controlPanel: controlPanel.stats,
      policy: env.policy,
      sound: soundView.stats,
    }),
    setEnvironmentOverride: (override) => env.setTestOverride(override),
    sendControlPanelMessage: (message) => controlPanel.onMessage(message),
  };
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions (see createKeyBlaze).
}
