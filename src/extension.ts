import * as vscode from 'vscode';
import { registerCommands } from './commands/registerCommands';
import type { KeyBlazeSettings } from './config/schema';
import { DecorationSlotPool } from './services/DecorationRenderer';
import { EffectsController } from './services/EffectsController';
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
  getStats(): { totalBursts: number; activeBursts: number; poolSize: number; statusText: string };
}

export function activate(context: vscode.ExtensionContext): KeyBlazeApi {
  const logger = new Logger();
  const settings = new SettingsService();
  const pool = new DecorationSlotPool(settings.get()['performance.maxConcurrentBursts'], logger);
  const detector = new TypingDetector(settings);
  const effects = new EffectsController(settings, detector, pool, logger);
  const statusBar = new StatusBarService(settings);

  context.subscriptions.push(
    logger,
    settings,
    pool,
    detector,
    effects,
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
    }),
  };
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
