import * as assert from 'assert';
import { defaultSettings } from '../../src/config/schema';
import type { EngineSettings } from '../../src/core/AnimationEngine';
import { AnimationEngine, RateLimiter, buildEffectParams } from '../../src/core/AnimationEngine';
import { ParticleEngine } from '../../src/core/ParticleEngine';
import { qualityProfile } from '../../src/core/quality';
import { intensityFactor, resolveShape } from '../../src/effects/Effect';
import { getEffect } from '../../src/effects/registry';
import { renderBurstSvg } from '../../src/render/SvgRenderer';
import { assertWellFormed } from './xml';

function settings(overrides: Partial<EngineSettings> = {}): EngineSettings {
  return { ...defaultSettings(), ...overrides };
}

function fakeClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

suite('RateLimiter', () => {
  test('allows at most N per sliding second', () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(clock.now);
    for (let i = 0; i < 3; i++) {
      assert.ok(limiter.tryAcquire(3), `acquire ${i}`);
      clock.advance(260); // above the 250 ms minimum gap for limit 3
    }
    assert.ok(!limiter.tryAcquire(3), 'fourth within the same second');
    clock.advance(1000 - 3 * 260 + 1);
    assert.ok(limiter.tryAcquire(3));
  });

  test('paces acquisitions at least 0.75 × 1000/limit ms apart', () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(clock.now);
    assert.strictEqual(RateLimiter.minGapMs(12), 62.5);
    assert.ok(limiter.tryAcquire(12));
    clock.advance(40);
    assert.ok(!limiter.tryAcquire(12), 'too soon');
    clock.advance(30);
    assert.ok(limiter.tryAcquire(12));
  });

  test('25 keystrokes/s with limit 12 renders every second keystroke', () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(clock.now);
    const rendered: number[] = [];
    for (let i = 0; i < 50; i++) {
      if (limiter.tryAcquire(12)) rendered.push(i);
      clock.advance(40);
    }
    assert.ok(rendered.length <= 26 && rendered.length >= 20, `${rendered.length}`);
    for (let i = 1; i < rendered.length; i++)
      assert.ok((rendered[i] ?? 0) - (rendered[i - 1] ?? 0) >= 2);
  });

  test('reset clears the window', () => {
    const limiter = new RateLimiter(fakeClock().now);
    assert.ok(limiter.tryAcquire(1));
    assert.ok(!limiter.tryAcquire(1));
    limiter.reset();
    assert.ok(limiter.tryAcquire(1));
  });
});

suite('AnimationEngine', () => {
  test('returns a burst and counts stats', () => {
    const engine = new AnimationEngine(new ParticleEngine(), fakeClock().now, () => 1);
    const track = engine.requestBurst(settings());
    assert.ok(track);
    assert.strictEqual(track.durationMs, 650);
    assert.deepStrictEqual(engine.getStats(), { requested: 1, rendered: 1, throttled: 0 });
  });

  test('rate limit throttles, bypass ignores it', () => {
    const clock = fakeClock();
    const engine = new AnimationEngine(new ParticleEngine(), clock.now, () => 1);
    const s = settings({ 'performance.maxBurstsPerSecond': 2 });
    assert.ok(engine.requestBurst(s));
    clock.advance(400);
    assert.ok(engine.requestBurst(s));
    clock.advance(400);
    assert.strictEqual(engine.requestBurst(s), undefined);
    assert.ok(engine.requestBurst(s, { bypassRateLimit: true }));
    assert.deepStrictEqual(engine.getStats(), { requested: 4, rendered: 3, throttled: 1 });
  });

  test('same seed → same burst', () => {
    const engine = new AnimationEngine(new ParticleEngine(), fakeClock().now);
    assert.deepStrictEqual(
      engine.requestBurst(settings(), { seed: 5, bypassRateLimit: true }),
      engine.requestBurst(settings(), { seed: 5, bypassRateLimit: true }),
    );
  });

  test('particle count follows settings and quality scaling', () => {
    const engine = new AnimationEngine(new ParticleEngine(), fakeClock().now, () => 3);
    const high = engine.requestBurst(settings({ particleCount: 20 }), { bypassRateLimit: true });
    const low = engine.requestBurst(settings({ particleCount: 20, 'performance.quality': 'low' }), {
      bypassRateLimit: true,
    });
    assert.strictEqual(high?.elements.length, 20);
    assert.strictEqual(low?.elements.length, 12);
    assert.strictEqual(high?.keyframes, 10);
    assert.strictEqual(low?.keyframes, 5);
  });

  test('performance mode applies the strictest budget', () => {
    const engine = new AnimationEngine(new ParticleEngine(), fakeClock().now, () => 3);
    const track = engine.requestBurst(settings({ particleCount: 40, performanceMode: true }), {
      bypassRateLimit: true,
    });
    assert.ok((track?.elements.length ?? 0) <= qualityProfile('high', true).maxElements);
    assert.strictEqual(track?.keyframes, 4);
    assert.ok((track?.halfWidth ?? 0) <= 60);
  });

  test('budgetScale reduces work', () => {
    const engine = new AnimationEngine(new ParticleEngine(), fakeClock().now, () => 3);
    const full = engine.requestBurst(settings({ particleCount: 40 }), { bypassRateLimit: true });
    const half = engine.requestBurst(settings({ particleCount: 40 }), {
      bypassRateLimit: true,
      budgetScale: 0.5,
    });
    assert.ok((half?.elements.length ?? 0) < (full?.elements.length ?? 0));
  });

  test('buildEffectParams derives intensity factor and never returns an empty palette', () => {
    const p = buildEffectParams(
      settings({ colors: [], intensity: 10 }),
      qualityProfile('high', false),
    );
    assert.deepStrictEqual(p.colors, ['#ffffff']);
    assert.strictEqual(p.intensityFactor, 1.5);
    assert.strictEqual(intensityFactor(1), 0.6);
    assert.strictEqual(
      buildEffectParams(settings({ particleCount: 1 }), qualityProfile('low', false)).count,
      1,
    );
  });

  test('effect registry resolves every effect id', () => {
    assert.strictEqual(getEffect('particles').id, 'particles');
    assert.strictEqual(getEffect('fireworks').id, 'fireworks');
    assert.strictEqual(resolveShape('auto', 'star'), 'star');
    assert.strictEqual(resolveShape('square', 'star'), 'square');
  });

  test('explicit shape overrides the natural shape', () => {
    const engine = new AnimationEngine(new ParticleEngine(), fakeClock().now, () => 3);
    const track = engine.requestBurst(settings({ particleShape: 'triangle' }), {
      bypassRateLimit: true,
    });
    for (const el of track?.elements ?? [])
      if (el.kind === 'particle') assert.strictEqual(el.shape, 'triangle');
  });
});

suite('Performance budget', () => {
  test('1000 high-quality 40-particle bursts simulate and render in under 1.5 s', () => {
    const engine = new AnimationEngine(new ParticleEngine(), fakeClock().now);
    const s = settings({ particleCount: 40 });
    const start = process.hrtime.bigint();
    for (let i = 0; i < 1000; i++) {
      const track = engine.requestBurst(s, { bypassRateLimit: true, seed: i });
      if (track) renderBurstSvg(track, { glow: true });
    }
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    // ≈ <1 ms per keystroke budget; generous bound to avoid flakiness on slow CI machines.
    assert.ok(ms < 1500, `took ${ms.toFixed(0)} ms`);
  });

  test('default burst SVG stays small', () => {
    const engine = new AnimationEngine(new ParticleEngine(), fakeClock().now);
    const track = engine.requestBurst(settings(), { bypassRateLimit: true, seed: 1 });
    assert.ok(track);
    const { svg } = renderBurstSvg(track, { glow: true });
    assertWellFormed(svg);
    assert.ok(svg.length < 16_000, `${svg.length} bytes`);
  });
});
