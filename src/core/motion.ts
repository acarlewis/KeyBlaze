/**
 * Accessibility and environment policy: should effects run at all, and should motion be reduced?
 * Pure: no `vscode` import. The EnvironmentService feeds it live state.
 */
import type { KeyBlazeSettings } from '../config/schema';
import type { EngineSettings } from './AnimationEngine';

export type ReduceMotionSetting = 'on' | 'off' | 'auto';
export type AccessibilitySupportSetting = 'on' | 'off' | 'auto';

export interface Environment {
  /** VS Code window has OS focus. */
  readonly windowFocused: boolean;
  /** `workbench.reduceMotion`. */
  readonly reduceMotion: ReduceMotionSetting;
  /**
   * The OS "reduce motion" preference, as reported by a KeyBlaze webview (`prefers-reduced-motion`).
   * The extension host can't read it directly, so it stays `undefined` until a webview has been shown.
   */
  readonly osPrefersReducedMotion: boolean | undefined;
  /** `editor.accessibilitySupport` ('on' = screen-reader optimised). */
  readonly accessibilitySupport: AccessibilitySupportSetting;
}

export type InactiveReason = 'disabled' | 'screenReader' | 'unfocused';

export interface MotionPolicy {
  /** Effects, combos and cursor effects may run. */
  readonly active: boolean;
  readonly reason?: InactiveReason;
  /** Use calm, low-motion variants (no shake, no flash, no pulsing, tiny bursts). */
  readonly reducedMotion: boolean;
  /** Sounds may play. */
  readonly sound: boolean;
}

export type PolicySettings = Pick<
  KeyBlazeSettings,
  | 'enabled'
  | 'sound.enabled'
  | 'accessibility.respectReducedMotion'
  | 'accessibility.disableWithScreenReader'
>;

export function computePolicy(s: PolicySettings, env: Environment): MotionPolicy {
  if (!s.enabled) return { active: false, reason: 'disabled', reducedMotion: false, sound: false };
  if (s['accessibility.disableWithScreenReader'] && env.accessibilitySupport === 'on') {
    return { active: false, reason: 'screenReader', reducedMotion: false, sound: false };
  }
  if (!env.windowFocused)
    return { active: false, reason: 'unfocused', reducedMotion: false, sound: false };
  const reducedMotion =
    s['accessibility.respectReducedMotion'] &&
    (env.reduceMotion === 'on' ||
      (env.reduceMotion === 'auto' && env.osPrefersReducedMotion === true));
  return { active: true, reducedMotion, sound: s['sound.enabled'] };
}

/**
 * Engine overrides under reduced motion: a few tiny, short-lived sparks that barely travel, whatever
 * the selected effect or preset.
 */
export function reducedMotionOverrides(
  s: Pick<EngineSettings, 'particleCount' | 'particleSize'>,
): Partial<EngineSettings> {
  return {
    effect: 'minimal',
    particleCount: Math.min(4, s.particleCount),
    particleSize: Math.min(2, s.particleSize),
    particleSpeed: 0.5,
    particleLifetime: 300,
    intensity: 2,
    particleShape: 'circle',
  };
}

export function describeInactive(reason: InactiveReason | undefined): string {
  switch (reason) {
    case 'disabled':
      return 'Disabled';
    case 'screenReader':
      return 'Paused: screen reader optimisation is on';
    case 'unfocused':
      return 'Paused: VS Code is not focused';
    default:
      return 'Active';
  }
}
