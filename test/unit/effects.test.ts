import * as assert from 'assert';
import type { EffectId } from '../../src/config/schema';
import { EFFECT_IDS, defaultSettings } from '../../src/config/schema';
import { PRESETS } from '../../src/config/presets';
import { buildEffectParams } from '../../src/core/AnimationEngine';
import type { BurstTrack } from '../../src/core/BurstTrack';
import { ParticleEngine } from '../../src/core/ParticleEngine';
import type { EffectVariant } from '../../src/core/placement';
import { qualityProfile } from '../../src/core/quality';
import { mulberry32 } from '../../src/core/random';
import type { EffectParams } from '../../src/effects/Effect';
import { launchAngle, paletteColor } from '../../src/effects/Effect';
import { FIREWORK_PATTERNS } from '../../src/effects/FireworksEffect';
import { jaggedPath } from '../../src/effects/LightningEffect';
import { MINIMAL_MAX_PARTICLES } from '../../src/effects/MinimalEffect';
import { allEffects, getEffect } from '../../src/effects/registry';
import { renderBurstSvg } from '../../src/render/SvgRenderer';
import { assertWellFormed } from './xml';

function params(
  effect: EffectId,
  variant: EffectVariant,
  overrides: Partial<EffectParams> = {},
): EffectParams {
  const s = { ...defaultSettings(), effect };
  return { ...buildEffectParams(s, qualityProfile('high', false), 1, variant), ...overrides };
}

function run(
  effect: EffectId,
  variant: EffectVariant,
  seed = 7,
  overrides: Partial<EffectParams> = {},
): BurstTrack {
  const p = params(effect, variant, overrides);
  return new ParticleEngine().simulate((e) => getEffect(effect).spawn(e, p), {
    durationMs: 650,
    keyframes: 10,
    maxElements: 60,
    maxHalfExtent: 120,
    rng: mulberry32(seed),
  });
}

/** Fraction of visible samples (frame centres, plus every bolt vertex) more than `px` below the origin. */
function belowFraction(track: BurstTrack, px: number): number {
  let visible = 0;
  let below = 0;
  for (const el of track.elements) {
    for (const f of el.frames) {
      if (f.o <= 0.02) continue;
      const ys =
        el.kind === 'bolt'
          ? el.points.filter((_, i) => i % 2 === 1).map((y) => f.y + y * f.s)
          : [f.y];
      for (const y of ys) {
        visible++;
        if (y > px) below++;
      }
    }
  }
  return visible === 0 ? 0 : below / visible;
}

suite('Effects', () => {
  test('registry covers every effect id with a matching effect', () => {
    assert.deepStrictEqual(
      allEffects().map((e) => e.id),
      [...EFFECT_IDS],
    );
  });

  for (const id of EFFECT_IDS) {
    for (const variant of ['full', 'upward'] as const) {
      suite(`${id} (${variant})`, () => {
        test('produces visible elements that end invisible', () => {
          const track = run(id, variant);
          assert.ok(track.elements.length > 0);
          for (const el of track.elements)
            assert.strictEqual(el.frames.at(-1)?.o ?? 0, 0, `${el.kind} still visible`);
          assert.ok(
            track.elements.some((el) => el.frames.some((f) => f.o > 0.3)),
            'nothing visible',
          );
        });

        test('is deterministic for a seed', () => {
          assert.deepStrictEqual(run(id, variant, 42), run(id, variant, 42));
        });

        test('renders well-formed SVG within the size budget', () => {
          const track = run(id, variant);
          const { svg } = renderBurstSvg(track, { glow: true, nonce: 'x' });
          assertWellFormed(svg);
          assert.ok(svg.length < 24_000, `${svg.length} bytes`);
        });

        test('uses only palette colours (plus the palette itself for flashes)', () => {
          const colors = ['#112233', '#445566'];
          const track = run(id, variant, 3, { colors });
          for (const el of track.elements) assert.ok(colors.includes(el.color), `${el.color}`);
        });

        test('respects the glow switch', () => {
          const track = run(id, variant, 3, { glow: false });
          for (const el of track.elements) assert.strictEqual(el.glow, 0);
        });

        if (variant === 'upward') {
          test('stays above the caret baseline (caret-anchored placement clips below it)', () => {
            for (const seed of [1, 2, 3, 4, 5]) {
              const frac = belowFraction(run(id, variant, seed), 6);
              assert.ok(
                frac < 0.08,
                `seed ${seed}: ${(frac * 100).toFixed(1)}% of visible frames below`,
              );
            }
          });
        }
      });
    }
  }

  test('full variants of radial effects use the space below the caret', () => {
    for (const id of ['particles', 'lightning', 'energy', 'fireworks', 'stars'] as const) {
      assert.ok(belowFraction(run(id, 'full'), 8) > 0.1, id);
    }
  });

  test('fire rises in both variants', () => {
    for (const variant of ['full', 'upward'] as const) {
      const track = run('fire', variant);
      assert.ok(track.up > track.down * 1.5, `${variant}: up ${track.up} down ${track.down}`);
    }
  });

  test('minimal never exceeds its particle cap and has no glow', () => {
    const track = run('minimal', 'full', 1, { count: 40 });
    assert.ok(track.elements.length <= MINIMAL_MAX_PARTICLES);
    assert.ok(track.elements.every((e) => e.glow === 0));
  });

  test('lightning draws bolts; energy draws rings; stars default to star shapes', () => {
    assert.ok(run('lightning', 'full').elements.some((e) => e.kind === 'bolt'));
    assert.ok(run('energy', 'full').elements.some((e) => e.kind === 'ring'));
    assert.ok(
      run('stars', 'full').elements.some((e) => e.kind === 'particle' && e.shape === 'star'),
    );
  });

  test('fireworks vary their explosion pattern across keystrokes', () => {
    // Spread of particle distances from the shell centroid (gravity shifts all particles equally):
    // ring patterns are uniform (low variation), sphere/star/double are not.
    const variations: number[] = [];
    for (let seed = 0; seed < 40; seed++) {
      const t = run('fireworks', 'full', seed);
      const pts = t.elements
        .map((e) => e.frames[4])
        .filter((f): f is NonNullable<typeof f> => !!f && f.o > 0);
      const cx = pts.reduce((a, f) => a + f.x, 0) / pts.length;
      const cy = pts.reduce((a, f) => a + f.y, 0) / pts.length;
      const r = pts.map((f) => Math.hypot(f.x - cx, f.y - cy));
      const mean = r.reduce((a, v) => a + v, 0) / r.length;
      const sd = Math.sqrt(r.reduce((a, v) => a + (v - mean) ** 2, 0) / r.length);
      variations.push(sd / mean);
    }
    assert.strictEqual(FIREWORK_PATTERNS.length, 4);
    assert.ok(
      variations.some((v) => v < 0.08),
      'no ring-like burst',
    );
    assert.ok(
      variations.some((v) => v > 0.25),
      'no irregular burst',
    );
  });

  test('every preset produces a valid burst in both variants', () => {
    for (const preset of Object.values(PRESETS)) {
      const s = { ...defaultSettings(), ...preset.values };
      for (const variant of ['full', 'upward'] as const) {
        const p = buildEffectParams(s, qualityProfile('high', false), 1, variant);
        const track = new ParticleEngine().simulate((e) => getEffect(s.effect).spawn(e, p), {
          durationMs: s.particleLifetime,
          keyframes: 10,
          maxElements: 60,
          maxHalfExtent: 120,
          rng: mulberry32(9),
        });
        assert.ok(track.elements.length > 0, preset.id);
      }
    }
  });
});

suite('Effect helpers', () => {
  test('upward launch angles point up', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 500; i++) assert.ok(Math.sin(launchAngle(rng, 'upward')) < -0.2);
  });

  test('paletteColor bias prefers early colours', () => {
    const rng = mulberry32(5);
    let first = 0;
    for (let i = 0; i < 1000; i++) if (paletteColor(rng, ['a', 'b', 'c', 'd'], 2) === 'a') first++;
    assert.ok(first > 400, `${first}`);
  });

  test('jaggedPath starts at the origin and ends at the target', () => {
    const pts = jaggedPath(mulberry32(1), 0, 0, 0, 40, 5, 6);
    assert.strictEqual(pts.length, 12);
    assert.deepStrictEqual(pts.slice(0, 2), [0, 0]);
    assert.deepStrictEqual(pts.slice(-2), [40, 0]);
  });
});
