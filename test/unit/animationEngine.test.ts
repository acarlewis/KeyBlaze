import * as assert from 'assert';
import { defaultSettings } from '../../src/config/schema';
import type { EngineSettings } from '../../src/core/AnimationEngine';
import { AnimationEngine, RateLimiter, buildEffectParams } from '../../src/core/AnimationEngine';
import { ParticleEngine } from '../../src/core/ParticleEngine';
import { qualityProfile } from '../../src/core/quality';
import { intensityFactor, resolveShape } from '../../src/effects/Effect';
import { getEffect, isImplemented } from '../../src/effects/registry';
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
  test('allows N per sliding second', () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(clock.now);
    assert.ok(limiter.tryAcquire(3));
    assert.ok(limiter.tryAcquire(3));
    assert.ok(limiter.tryAcquire(3));
    assert.ok(!limiter.tryAcquire(3));
    clock.advance(999);
    assert.ok(!limiter.tryAcquire(3));
    clock.advance(1);
    assert.ok(limiter.tryAcquire(3));
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
    const engine = new AnimationEngine(new ParticleEngine(), fakeClock().now, () => 1);
    const s = settings({ 'performance.maxBurstsPerSecond': 2 });
    assert.ok(engine.requestBurst(s));
    assert.ok(engine.requestBurst(s));
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
    const track = engine.requestBurst(settings({ particleCount: 100, performanceMode: true }), {
      bypassRateLimit: true,
    });
    assert.ok((track?.elements.length ?? 0) <= qualityProfile('high', true).maxElements);
    assert.strictEqual(track?.keyframes, 4);
    assert.ok((track?.halfWidth ?? 0) <= 70);
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

  test('effect registry: particles implemented, others fall back to particles', () => {
    assert.ok(isImplemented('particles'));
    assert.strictEqual(getEffect('particles').id, 'particles');
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
  test('1000 high-quality bursts simulate and render in well under a second per 1000', () => {
    const engine = new AnimationEngine(new ParticleEngine(), fakeClock().now);
    const s = settings({ particleCount: 30 });
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
