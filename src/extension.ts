import * as vscode from 'vscode';
import { registerCommands } from './commands/registerCommands';
import type { KeyBlazeSettings } from './config/schema';
import { ComboIndicator } from './services/ComboIndicator';
import { ComboService } from './services/ComboService';
import { CursorEffects } from './services/CursorEffects';
import { DecorationSlotPool } from './services/DecorationRenderer';
import type { LastBurstInfo } from './services/EffectsController';
import { EffectsController } from './services/EffectsController';
import { ImpactPulse } from './services/ImpactPulse';
import { InlayHintTracker } from './services/InlayHintTracker';
import { SettingsService } from './services/SettingsService';
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
  };
}

export function activate(context: vscode.ExtensionContext): KeyBlazeApi {
  const logger = new Logger();
  const settings = new SettingsService();
  const pool = new DecorationSlotPool(settings.get()['performance.maxConcurrentBursts'], logger);
  const detector = new TypingDetector(settings);
  const inlayHints = new InlayHintTracker();
  const effects = new EffectsController(settings, detector, pool, logger, inlayHints);
  const combo = new ComboService(settings, detector, context.globalState);
  const comboIndicator = new ComboIndicator(settings, combo, logger);
  const impact = new ImpactPulse(settings, combo, effects, logger);
  const cursorEffects = new CursorEffects(settings, detector, inlayHints, logger);
  const statusBar = new StatusBarService(settings, combo);

  context.subscriptions.push(
    logger,
    settings,
    pool,
    detector,
    inlayHints,
    effects,
    combo,
    comboIndicator,
    impact,
    cursorEffects,
    statusBar,
    ...registerCommands({ context, settings, effects, pool, logger }),
  );

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
    }),
  };
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
