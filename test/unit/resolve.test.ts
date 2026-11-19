import * as assert from 'assert';
import { PRESETS } from '../../src/config/presets';
import type { InspectLike } from '../../src/config/resolve';
import { explicitValue, overriddenPresetKeys, resolveSettings } from '../../src/config/resolve';
import type { SettingKey } from '../../src/config/schema';
import { defaultSettings } from '../../src/config/schema';

function inspector(values: Partial<Record<SettingKey, InspectLike>>) {
  return (key: SettingKey): InspectLike | undefined => values[key];
}

suite('Settings resolution', () => {
  test('nothing set → defaults', () => {
    assert.deepStrictEqual(resolveSettings(inspector({})), defaultSettings());
  });

  test('preset supplies presetable values', () => {
    const s = resolveSettings(inspector({ preset: { globalValue: 'firestorm' } }));
    assert.strictEqual(s.preset, 'firestorm');
    assert.strictEqual(s.effect, 'fire');
    assert.deepStrictEqual(s.colors, PRESETS.firestorm.values.colors);
    assert.strictEqual(s['cursor.effect'], 'glow');
  });

  test('explicit values override the preset', () => {
    const s = resolveSettings(
      inspector({
        preset: { globalValue: 'firestorm' },
        effect: { globalValue: 'stars' },
        particleCount: { globalValue: 3 },
      }),
    );
    assert.strictEqual(s.effect, 'stars');
    assert.strictEqual(s.particleCount, 3);
    assert.strictEqual(s.particleLifetime, PRESETS.firestorm.values.particleLifetime);
  });

  test('workspace folder > workspace > global', () => {
    assert.strictEqual(
      explicitValue({ globalValue: 1, workspaceValue: 2, workspaceFolderValue: 3 }),
      3,
    );
    assert.strictEqual(explicitValue({ globalValue: 1, workspaceValue: 2 }), 2);
    assert.strictEqual(explicitValue({ globalValue: 1 }), 1);
    assert.strictEqual(explicitValue(undefined), undefined);
  });

  test('invalid explicit values fall back to the preset, not a crash', () => {
    const s = resolveSettings(
      inspector({ preset: { globalValue: 'starfall' }, effect: { globalValue: 'bogus' } }),
    );
    assert.strictEqual(s.effect, 'stars');
  });

  test('invalid preset falls back to the default preset', () => {
    const s = resolveSettings(inspector({ preset: { globalValue: 'nope' } }));
    assert.strictEqual(s.preset, 'classicBurst');
  });

  test('custom preset uses defaults for unset keys', () => {
    const s = resolveSettings(inspector({ preset: { globalValue: 'custom' } }));
    assert.strictEqual(s.effect, defaultSettings().effect);
  });

  test('non-presetable keys are never taken from presets', () => {
    const s = resolveSettings(
      inspector({ preset: { globalValue: 'cleanMode' }, enabled: { globalValue: false } }),
    );
    assert.strictEqual(s.enabled, false);
    assert.strictEqual(s['combo.enabled'], true);
  });

  test('resolved arrays are copies, not preset references', () => {
    const s = resolveSettings(inspector({ preset: { globalValue: 'firestorm' } }));
    s.colors.push('#000000');
    assert.notStrictEqual(PRESETS.firestorm.values.colors?.length, s.colors.length);
  });

  test('overriddenPresetKeys lists explicit presetable keys only', () => {
    const keys = overriddenPresetKeys(
      inspector({
        effect: { globalValue: 'fire' },
        enabled: { globalValue: false },
        colors: { workspaceValue: ['#fff'] },
      }),
    );
    assert.deepStrictEqual(keys.sort(), ['colors', 'effect']);
  });
});
