import * as assert from 'assert';
import { parseWebviewMessage } from '../../src/config/messages';
import { SOUND_THEMES, defaultSettings } from '../../src/config/schema';
import type { Environment } from '../../src/core/motion';
import {
  computePolicy,
  describeInactive,
  reducedMotionOverrides,
  withMotionPolicy,
} from '../../src/core/motion';
import { KEY_SOUND_MIN_GAP_MS, soundRecipe } from '../../src/core/sound';
import { TypingRate, budgetForRate } from '../../src/core/typingRate';
import { renderComboBadge } from '../../src/render/ComboBadge';
import { renderAura } from '../../src/render/CursorAura';
import { assertWellFormed } from './xml';

const env = (o: Partial<Environment> = {}): Environment => ({
  windowFocused: true,
  reduceMotion: 'auto',
  osPrefersReducedMotion: undefined,
  accessibilitySupport: 'auto',
  ...o,
});
const settings = (o: Partial<ReturnType<typeof defaultSettings>> = {}) => ({
  ...defaultSettings(),
  ...o,
});

suite('Motion policy', () => {
  test('active by default, no reduced motion', () => {
    assert.deepStrictEqual(computePolicy(settings(), env()), {
      active: true,
      reducedMotion: false,
      sound: false,
    });
  });

  test('disabled wins over everything', () => {
    assert.deepStrictEqual(computePolicy(settings({ enabled: false }), env()), {
      active: false,
      reason: 'disabled',
      reducedMotion: false,
      sound: false,
    });
  });

  test('screen reader optimisation pauses effects and sound unless the user opts out', () => {
    const on = env({ accessibilitySupport: 'on' });
    assert.strictEqual(
      computePolicy(settings({ 'sound.enabled': true }), on).reason,
      'screenReader',
    );
    assert.strictEqual(computePolicy(settings({ 'sound.enabled': true }), on).sound, false);
    assert.strictEqual(
      computePolicy(settings({ 'accessibility.disableWithScreenReader': false }), on).active,
      true,
    );
    // 'auto' cannot be resolved by extensions, so it never pauses.
    assert.strictEqual(
      computePolicy(settings(), env({ accessibilitySupport: 'auto' })).active,
      true,
    );
  });

  test('unfocused window pauses effects and sound', () => {
    const p = computePolicy(settings({ 'sound.enabled': true }), env({ windowFocused: false }));
    assert.deepStrictEqual([p.active, p.reason, p.sound], [false, 'unfocused', false]);
  });

  test('reduced motion: on, auto + OS preference, and the opt-out', () => {
    assert.ok(computePolicy(settings(), env({ reduceMotion: 'on' })).reducedMotion);
    assert.ok(
      computePolicy(settings(), env({ reduceMotion: 'auto', osPrefersReducedMotion: true }))
        .reducedMotion,
    );
    assert.ok(
      !computePolicy(settings(), env({ reduceMotion: 'auto', osPrefersReducedMotion: false }))
        .reducedMotion,
    );
    assert.ok(
      !computePolicy(settings(), env({ reduceMotion: 'auto' })).reducedMotion,
      'unknown OS preference',
    );
    assert.ok(
      !computePolicy(settings(), env({ reduceMotion: 'off', osPrefersReducedMotion: true }))
        .reducedMotion,
    );
    assert.ok(
      !computePolicy(
        settings({ 'accessibility.respectReducedMotion': false }),
        env({ reduceMotion: 'on' }),
      ).reducedMotion,
    );
  });

  test('sound follows the setting when active', () => {
    assert.ok(computePolicy(settings({ 'sound.enabled': true }), env()).sound);
  });

  test('reduced-motion overrides are tiny, calm and never exceed the user values', () => {
    const o = reducedMotionOverrides({ particleCount: 30, particleSize: 6 });
    assert.strictEqual(o.effect, 'minimal');
    assert.strictEqual(o.particleCount, 4);
    assert.strictEqual(o.particleSize, 2);
    assert.ok((o.particleLifetime ?? 1000) <= 300);
    assert.strictEqual(
      reducedMotionOverrides({ particleCount: 2, particleSize: 1 }).particleCount,
      2,
    );
  });

  test('withMotionPolicy calms bursts only under reduced motion (Control Panel preview)', () => {
    const s = { particleCount: 30, particleSize: 6, effect: 'fire', particleLifetime: 650 };
    assert.strictEqual(withMotionPolicy(s, false), s);
    assert.deepStrictEqual(withMotionPolicy(s, true), {
      ...s,
      ...reducedMotionOverrides(s),
    });
    assert.strictEqual(withMotionPolicy(s, true).effect, 'minimal');
  });

  test('inactive reasons have readable descriptions', () => {
    assert.strictEqual(describeInactive(undefined), 'Active');
    assert.ok(describeInactive('screenReader').includes('screen reader'));
  });
});

suite('Typing-rate budget', () => {
  test('measures keystrokes per second over a sliding window', () => {
    let t = 0;
    const rate = new TypingRate(() => t);
    for (let i = 0; i < 10; i++) {
      rate.hit();
      t += 50;
    }
    assert.strictEqual(rate.rate(), 10);
    t += 1000;
    assert.strictEqual(rate.rate(), 0);
  });

  test('budget is 1 up to 12/s and 0.5 from 24/s', () => {
    assert.strictEqual(budgetForRate(8), 1);
    assert.strictEqual(budgetForRate(12), 1);
    assert.strictEqual(budgetForRate(18), 0.75);
    assert.strictEqual(budgetForRate(30), 0.5);
  });
});

suite('Sound recipes', () => {
  for (const theme of SOUND_THEMES) {
    test(`${theme}: keystroke sounds are short and quiet; milestones rise with tier`, () => {
      const key = soundRecipe(theme, 'key');
      assert.ok(key.length > 0);
      for (const s of key) {
        assert.ok(s.durationMs <= 100, `${s.durationMs}`);
        assert.ok(s.gain > 0 && s.gain <= 0.4);
      }
      const low = soundRecipe(theme, 'milestone', 0).filter((s) => s.wave !== 'noise');
      const high = soundRecipe(theme, 'milestone', 3).filter((s) => s.wave !== 'noise');
      assert.ok((high[0]?.from ?? 0) > (low[0]?.from ?? 0), 'higher tier → higher pitch');
      assert.ok(high.length >= low.length);
    });
  }

  test('keystroke sounds are rate-limited', () => {
    assert.ok(KEY_SOUND_MIN_GAP_MS >= 40);
  });
});

suite('Reduced-motion rendering', () => {
  test('badge without animation has no pop or shake but keeps the drain bar', () => {
    const b = renderComboBadge({
      count: 25,
      lineHeight: 19,
      color: '#ff8a00',
      remainingMs: 2000,
      celebrate: true,
      shake: { amplitude: 4, durationMs: 200 },
      nonce: 'n',
      animate: false,
    });
    assertWellFormed(b.svg);
    assert.ok(!b.svg.includes('type="scale"'));
    assert.ok(!b.svg.includes('type="translate"'));
    assert.ok(b.svg.includes('attributeName="width"'), 'drain bar kept');
  });

  test('static aura has no looping animation', () => {
    for (const kind of ['glow', 'ring'] as const) {
      const svg = renderAura(kind, '#00f5d4', 19, { width: 40, height: 70, originY: 26 }, false);
      assertWellFormed(svg);
      assert.ok(!svg.includes('<animate'));
    }
  });

  test('panel environment message is validated', () => {
    assert.deepStrictEqual(
      parseWebviewMessage({ type: 'environment', prefersReducedMotion: true }),
      {
        type: 'environment',
        prefersReducedMotion: true,
      },
    );
    assert.strictEqual(
      parseWebviewMessage({ type: 'environment', prefersReducedMotion: 'yes' }),
      undefined,
    );
  });
});
