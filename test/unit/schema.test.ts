import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { PRESETS } from '../../src/config/presets';
import {
  PRESETABLE_KEYS,
  PRESET_IDS,
  SETTING_KEYS,
  SETTING_SPECS,
  defaultSettings,
  validateSetting,
} from '../../src/config/schema';

interface PackageProperty {
  type: string;
  default: unknown;
  enum?: string[];
  minimum?: number;
  maximum?: number;
}

const pkgPath = path.resolve(__dirname, '../../../package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
  contributes: { configuration: { properties: Record<string, PackageProperty> } };
};
const properties = pkg.contributes.configuration.properties;

suite('Settings schema', () => {
  test('every default value passes its own validation unchanged', () => {
    const defaults = defaultSettings() as unknown as Record<string, unknown>;
    for (const key of SETTING_KEYS) {
      assert.deepStrictEqual(validateSetting(key, defaults[key]), defaults[key], key);
    }
  });

  test('defaultSettings() returns fresh array copies', () => {
    const a = defaultSettings();
    a.colors.push('#000000');
    assert.notDeepStrictEqual(defaultSettings().colors, a.colors);
  });

  test('numbers are clamped and integers rounded', () => {
    assert.strictEqual(validateSetting('intensity', 99), 10);
    assert.strictEqual(validateSetting('intensity', -3), 1);
    assert.strictEqual(validateSetting('intensity', 4.6), 5);
    assert.strictEqual(validateSetting('particleSpeed', 0.1), 0.25);
    assert.strictEqual(validateSetting('particleSize', 2.5), 2.5);
    assert.strictEqual(validateSetting('particleCount', Number.NaN), undefined);
    assert.strictEqual(validateSetting('particleCount', '10'), undefined);
  });

  test('enums reject unknown values', () => {
    assert.strictEqual(validateSetting('effect', 'fire'), 'fire');
    assert.strictEqual(validateSetting('effect', 'plasma'), undefined);
    assert.strictEqual(validateSetting('preset', 42), undefined);
  });

  test('colours keep only valid hex values, normalised to lower case', () => {
    assert.deepStrictEqual(validateSetting('colors', ['#FFAA00', 'red', ' #abc ', 5]), [
      '#ffaa00',
      '#abc',
    ]);
    assert.strictEqual(validateSetting('colors', ['nope']), undefined);
    assert.strictEqual(validateSetting('colors', []), undefined);
  });

  test('milestones are de-duplicated, sorted and filtered', () => {
    assert.deepStrictEqual(
      validateSetting('combo.milestones', [50, 10, 10, 1, 'x', 25.4]),
      [10, 25, 50],
    );
  });

  test('string lists drop blanks and trim', () => {
    assert.deepStrictEqual(validateSetting('excludeLanguages', [' markdown ', '', 3]), [
      'markdown',
    ]);
  });
});

suite('package.json configuration is in sync with the schema', () => {
  test('every schema key is contributed and vice versa', () => {
    const contributed = Object.keys(properties).map((k) => k.replace(/^keyblaze\./, ''));
    assert.deepStrictEqual([...contributed].sort(), [...SETTING_KEYS].sort());
  });

  for (const key of SETTING_KEYS) {
    test(`keyblaze.${key} matches`, () => {
      const prop = properties[`keyblaze.${key}`];
      assert.ok(prop, 'missing in package.json');
      const spec = SETTING_SPECS[key];
      assert.deepStrictEqual(prop.default, spec.default, 'default');
      assert.strictEqual(prop.type, spec.meta.type, 'type');
      if (spec.meta.enum) assert.deepStrictEqual(prop.enum, [...spec.meta.enum], 'enum');
      if (spec.meta.minimum !== undefined)
        assert.strictEqual(prop.minimum, spec.meta.minimum, 'minimum');
      if (spec.meta.maximum !== undefined)
        assert.strictEqual(prop.maximum, spec.meta.maximum, 'maximum');
    });
  }
});

suite('Presets', () => {
  test('every preset id has a definition', () => {
    for (const id of PRESET_IDS) assert.strictEqual(PRESETS[id].id, id);
  });

  test('every non-custom preset defines every presetable key with valid values', () => {
    for (const id of PRESET_IDS) {
      if (id === 'custom') continue;
      const values = PRESETS[id].values as Record<string, unknown>;
      for (const key of PRESETABLE_KEYS) {
        assert.notStrictEqual(values[key], undefined, `${id}.${key} missing`);
        assert.deepStrictEqual(
          validateSetting(key, values[key]),
          values[key],
          `${id}.${key} invalid`,
        );
      }
    }
  });

  test('presets are visually distinct (no two share effect + palette + shape)', () => {
    const signatures = PRESET_IDS.filter((id) => id !== 'custom').map((id) => {
      const v = PRESETS[id].values;
      return JSON.stringify([v.effect, v.colors, v.particleShape]);
    });
    assert.strictEqual(new Set(signatures).size, signatures.length);
  });

  test('defaults match the default preset so Settings UI defaults are truthful', () => {
    const defaults = defaultSettings() as unknown as Record<string, unknown>;
    const preset = PRESETS[SETTING_SPECS.preset.default].values as Record<string, unknown>;
    for (const key of PRESETABLE_KEYS) assert.deepStrictEqual(preset[key], defaults[key], key);
  });
});
