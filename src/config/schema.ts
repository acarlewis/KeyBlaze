/**
 * Typed model of every `keyblaze.*` setting: defaults, validation and clamping.
 * Pure module (no `vscode` import) so it can be unit-tested in plain Node.
 * Must stay in sync with `contributes.configuration` in package.json (enforced by a unit test).
 */

export const CONFIG_SECTION = 'keyblaze';

export const EFFECT_IDS = [
  'particles',
  'fire',
  'lightning',
  'energy',
  'fireworks',
  'stars',
  'minimal',
] as const;
export type EffectId = (typeof EFFECT_IDS)[number];

export const PRESET_IDS = [
  'classicBurst',
  'firestorm',
  'lightningStrike',
  'neonEnergy',
  'cosmicExplosion',
  'starfall',
  'minimalSparks',
  'rainbowRush',
  'cyberpunk',
  'cleanMode',
  'custom',
] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export const PARTICLE_SHAPES = ['auto', 'circle', 'square', 'triangle', 'star', 'spark'] as const;
export type ParticleShape = (typeof PARTICLE_SHAPES)[number];

export const CURSOR_EFFECT_IDS = ['none', 'glow', 'sparks', 'ring', 'trail'] as const;
export type CursorEffectId = (typeof CURSOR_EFFECT_IDS)[number];

export const SOUND_THEMES = ['soft', 'mechanical', 'arcade', 'chime'] as const;
export type SoundTheme = (typeof SOUND_THEMES)[number];

export const SOUND_MODES = ['milestones', 'everyKeystroke'] as const;
export type SoundMode = (typeof SOUND_MODES)[number];

export const QUALITY_LEVELS = ['low', 'medium', 'high'] as const;
export type QualityLevel = (typeof QUALITY_LEVELS)[number];

/** Flat, fully-resolved settings. Keys are relative to the `keyblaze` section. */
export interface KeyBlazeSettings {
  enabled: boolean;
  preset: PresetId;
  effect: EffectId;
  intensity: number;
  particleCount: number;
  particleSize: number;
  particleSpeed: number;
  particleLifetime: number;
  particleShape: ParticleShape;
  colors: string[];
  triggerOnDelete: boolean;
  'cursor.effect': CursorEffectId;
  'combo.enabled': boolean;
  'combo.resetTime': number;
  'combo.showIndicator': boolean;
  'combo.showInStatusBar': boolean;
  'combo.milestones': number[];
  'screenShake.enabled': boolean;
  'screenShake.intensity': number;
  'screenShake.duration': number;
  'screenShake.flashLine': boolean;
  'sound.enabled': boolean;
  'sound.volume': number;
  'sound.theme': SoundTheme;
  'sound.mode': SoundMode;
  performanceMode: boolean;
  'performance.maxConcurrentBursts': number;
  'performance.maxBurstsPerSecond': number;
  'performance.frameRateLimit': number;
  'performance.quality': QualityLevel;
  'accessibility.respectReducedMotion': boolean;
  'accessibility.disableWithScreenReader': boolean;
  excludeLanguages: string[];
  excludeFiles: string[];
}

export type SettingKey = keyof KeyBlazeSettings;

/** Settings a preset may supply. Explicit user values always win over the preset. */
export const PRESETABLE_KEYS = [
  'effect',
  'intensity',
  'particleCount',
  'particleSize',
  'particleSpeed',
  'particleLifetime',
  'particleShape',
  'colors',
  'cursor.effect',
] as const satisfies readonly SettingKey[];
export type PresetableKey = (typeof PRESETABLE_KEYS)[number];

export interface SettingSpec<T> {
  readonly default: T;
  /** Returns a valid (possibly clamped) value, or `undefined` if `raw` is unusable. */
  validate(raw: unknown): T | undefined;
  /** Metadata used by the package.json consistency test. */
  readonly meta: {
    readonly type: 'boolean' | 'number' | 'integer' | 'string' | 'array';
    readonly enum?: readonly string[];
    readonly minimum?: number;
    readonly maximum?: number;
  };
}

export type SettingSpecs = { readonly [K in SettingKey]: SettingSpec<KeyBlazeSettings[K]> };

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function bool(def: boolean): SettingSpec<boolean> {
  return {
    default: def,
    validate: (raw) => (typeof raw === 'boolean' ? raw : undefined),
    meta: { type: 'boolean' },
  };
}

function num(def: number, minimum: number, maximum: number, integer = false): SettingSpec<number> {
  return {
    default: def,
    validate: (raw) => {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
      const v = clamp(raw, minimum, maximum);
      return integer ? Math.round(v) : v;
    },
    meta: { type: integer ? 'integer' : 'number', minimum, maximum },
  };
}

function oneOf<T extends string>(values: readonly T[], def: T): SettingSpec<T> {
  return {
    default: def,
    validate: (raw) =>
      typeof raw === 'string' && (values as readonly string[]).includes(raw)
        ? (raw as T)
        : undefined,
    meta: { type: 'string', enum: values },
  };
}

function colorList(def: string[], maxItems: number): SettingSpec<string[]> {
  return {
    default: def,
    validate: (raw) => {
      if (!Array.isArray(raw)) return undefined;
      const colors = raw
        .filter((c): c is string => typeof c === 'string' && HEX_COLOR.test(c.trim()))
        .map((c) => c.trim().toLowerCase())
        .slice(0, maxItems);
      // An empty or fully-invalid list falls back to the preset/default palette.
      return colors.length > 0 ? colors : undefined;
    },
    meta: { type: 'array' },
  };
}

function stringList(def: string[]): SettingSpec<string[]> {
  return {
    default: def,
    validate: (raw) =>
      Array.isArray(raw)
        ? raw
            .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
            .map((s) => s.trim())
        : undefined,
    meta: { type: 'array' },
  };
}

function milestoneList(def: number[]): SettingSpec<number[]> {
  return {
    default: def,
    validate: (raw) => {
      if (!Array.isArray(raw)) return undefined;
      const values = raw
        .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 2)
        .map((n) => Math.round(n));
      return [...new Set(values)].sort((a, b) => a - b).slice(0, 20);
    },
    meta: { type: 'array' },
  };
}

export const SETTING_SPECS: SettingSpecs = {
  enabled: bool(true),
  preset: oneOf(PRESET_IDS, 'classicBurst'),
  effect: oneOf(EFFECT_IDS, 'particles'),
  intensity: num(5, 1, 10, true),
  particleCount: num(14, 1, 100, true),
  particleSize: num(3, 1, 12),
  particleSpeed: num(1, 0.25, 3),
  particleLifetime: num(650, 150, 3000, true),
  particleShape: oneOf(PARTICLE_SHAPES, 'auto'),
  colors: colorList(['#ff8a00', '#ffd23f', '#ff5e3a', '#fff3b0'], 12),
  triggerOnDelete: bool(true),
  'cursor.effect': oneOf(CURSOR_EFFECT_IDS, 'none'),
  'combo.enabled': bool(true),
  'combo.resetTime': num(3000, 500, 60000, true),
  'combo.showIndicator': bool(true),
  'combo.showInStatusBar': bool(true),
  'combo.milestones': milestoneList([10, 25, 50, 100]),
  'screenShake.enabled': bool(false),
  'screenShake.intensity': num(3, 1, 10, true),
  'screenShake.duration': num(250, 50, 1000, true),
  'screenShake.flashLine': bool(true),
  'sound.enabled': bool(false),
  'sound.volume': num(0.3, 0, 1),
  'sound.theme': oneOf(SOUND_THEMES, 'soft'),
  'sound.mode': oneOf(SOUND_MODES, 'milestones'),
  performanceMode: bool(false),
  'performance.maxConcurrentBursts': num(16, 1, 48, true),
  'performance.maxBurstsPerSecond': num(24, 1, 60, true),
  'performance.frameRateLimit': num(60, 15, 144, true),
  'performance.quality': oneOf(QUALITY_LEVELS, 'high'),
  'accessibility.respectReducedMotion': bool(true),
  'accessibility.disableWithScreenReader': bool(true),
  excludeLanguages: stringList([]),
  excludeFiles: stringList([]),
};

export const SETTING_KEYS = Object.keys(SETTING_SPECS) as SettingKey[];

export function defaultSettings(): KeyBlazeSettings {
  const out: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    const def: unknown = SETTING_SPECS[key].default;
    out[key] = Array.isArray(def) ? [...(def as unknown[])] : def;
  }
  return out as unknown as KeyBlazeSettings;
}

export function validateSetting<K extends SettingKey>(
  key: K,
  raw: unknown,
): KeyBlazeSettings[K] | undefined {
  return SETTING_SPECS[key].validate(raw);
}
