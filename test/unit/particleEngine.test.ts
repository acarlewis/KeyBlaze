import * as assert from 'assert';
import type { ParticleElement } from '../../src/core/BurstTrack';
import type { Emitter, SimulationOptions } from '../../src/core/ParticleEngine';
import { ParticleEngine, localLife, measure } from '../../src/core/ParticleEngine';
import { between, mulberry32, pick } from '../../src/core/random';

function options(overrides: Partial<SimulationOptions> = {}): SimulationOptions {
  return {
    durationMs: 600,
    keyframes: 8,
    maxElements: 100,
    maxHalfExtent: 200,
    rng: mulberry32(1),
    ...overrides,
  };
}

function burst(e: Emitter, n = 10): void {
  for (let i = 0; i < n; i++) {
    const a = e.rng() * Math.PI * 2;
    e.particle({
      vx: Math.cos(a) * 100,
      vy: Math.sin(a) * 100,
      size: 3,
      color: '#fff',
      shape: 'circle',
    });
  }
}

suite('random', () => {
  test('mulberry32 is deterministic and in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = a();
      assert.strictEqual(v, b());
      assert.ok(v >= 0 && v < 1);
    }
  });

  test('different seeds diverge', () => {
    assert.notStrictEqual(mulberry32(1)(), mulberry32(2)());
  });

  test('between and pick stay in range', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const v = between(rng, 5, 10);
      assert.ok(v >= 5 && v < 10);
      assert.ok(['a', 'b'].includes(pick(rng, ['a', 'b'])));
    }
    assert.throws(() => pick(rng, []));
  });
});

suite('ParticleEngine', () => {
  test('every element has exactly `keyframes` frames', () => {
    const track = new ParticleEngine().simulate(
      (e) => {
        burst(e, 5);
        e.ring({ radiusFrom: 2, radiusTo: 30, strokeWidth: 2, color: '#0ff' });
        e.bolt({ points: [0, 0, 10, 10], width: 2, color: '#fff' });
      },
      options({ keyframes: 7 }),
    );
    assert.strictEqual(track.elements.length, 7);
    for (const el of track.elements) assert.strictEqual(el.frames.length, 7);
    assert.strictEqual(track.keyframes, 7);
  });

  test('keyframes are clamped to at least 2', () => {
    const track = new ParticleEngine().simulate((e) => burst(e, 1), options({ keyframes: 0 }));
    assert.strictEqual(track.elements[0]?.frames.length, 2);
  });

  test('same seed → identical track', () => {
    const a = new ParticleEngine().simulate((e) => burst(e), options({ rng: mulberry32(99) }));
    const b = new ParticleEngine().simulate((e) => burst(e), options({ rng: mulberry32(99) }));
    assert.deepStrictEqual(a, b);
  });

  test('maxElements caps spawned elements', () => {
    const track = new ParticleEngine().simulate((e) => burst(e, 50), options({ maxElements: 12 }));
    assert.strictEqual(track.elements.length, 12);
  });

  test('particles start at the origin, move outward and end invisible', () => {
    const track = new ParticleEngine().simulate((e) => burst(e, 20), options());
    for (const el of track.elements) {
      const first = el.frames[0];
      const last = el.frames[el.frames.length - 1];
      assert.strictEqual(first?.x, 0);
      assert.strictEqual(first?.y, 0);
      assert.strictEqual(first?.o, 1);
      assert.strictEqual(last?.o, 0);
      assert.ok(Math.hypot(last?.x ?? 0, last?.y ?? 0) > 10);
    }
  });

  test('gravity pulls particles down', () => {
    const track = new ParticleEngine().simulate(
      (e) => e.particle({ vx: 0, vy: 0, ay: 500, size: 2, color: '#fff', shape: 'circle' }),
      options(),
    );
    const ys = track.elements[0]?.frames.map((f) => f.y) ?? [];
    for (let i = 1; i < ys.length; i++) assert.ok((ys[i] ?? 0) > (ys[i - 1] ?? 0));
  });

  test('drag shortens travel', () => {
    const travel = (drag: number): number => {
      const t = new ParticleEngine().simulate(
        (e) => e.particle({ vx: 200, vy: 0, drag, size: 2, color: '#fff', shape: 'circle' }),
        options(),
      );
      return t.elements[0]?.frames.at(-1)?.x ?? 0;
    };
    assert.ok(travel(4) < travel(0));
  });

  test('delayed particles stay hidden at the origin until born', () => {
    const track = new ParticleEngine().simulate(
      (e) => e.particle({ vx: 100, vy: 0, delay: 0.5, size: 2, color: '#fff', shape: 'circle' }),
      options({ keyframes: 11 }),
    );
    const frames = track.elements[0]?.frames ?? [];
    for (let k = 0; k < 5; k++) {
      assert.strictEqual(frames[k]?.o, 0, `frame ${k}`);
      assert.strictEqual(frames[k]?.x, 0, `frame ${k}`);
    }
    assert.ok((frames[6]?.o ?? 0) > 0);
  });

  test('short-lived particles fade out before the burst ends', () => {
    const track = new ParticleEngine().simulate(
      (e) => e.particle({ vx: 10, vy: 0, life: 0.4, size: 2, color: '#fff', shape: 'circle' }),
      options({ keyframes: 11 }),
    );
    const frames = track.elements[0]?.frames ?? [];
    assert.strictEqual(frames[5]?.o, 0);
    assert.strictEqual(frames[10]?.o, 0);
  });

  test('spark particles rotate to face their velocity', () => {
    const track = new ParticleEngine().simulate(
      (e) =>
        e.particle({
          vx: 0,
          vy: 100,
          size: 2,
          color: '#fff',
          shape: 'spark',
          alignToVelocity: true,
        }),
      options(),
    );
    const el = track.elements[0] as ParticleElement;
    assert.strictEqual(Math.round(el.frames.at(-1)?.r ?? 0), 90);
  });

  test('rings expand from radiusFrom to radiusTo and fade', () => {
    const track = new ParticleEngine().simulate(
      (e) => e.ring({ radiusFrom: 2, radiusTo: 40, strokeWidth: 2, color: '#0ff' }),
      options(),
    );
    const frames = track.elements[0]?.frames ?? [];
    assert.strictEqual(frames[0]?.s, 2);
    assert.strictEqual(frames.at(-1)?.s, 40);
    for (let i = 1; i < frames.length; i++)
      assert.ok((frames[i]?.s ?? 0) >= (frames[i - 1]?.s ?? 0));
    assert.strictEqual(frames.at(-1)?.o, 0);
  });

  test('bolts are invisible after their life', () => {
    const track = new ParticleEngine().simulate(
      (e) => e.bolt({ points: [0, 0, 5, 5], width: 1, color: '#fff', life: 0.3 }),
      options({ keyframes: 11 }),
    );
    const frames = track.elements[0]?.frames ?? [];
    assert.ok((frames[0]?.o ?? 0) > 0);
    for (let k = 4; k < 11; k++) assert.strictEqual(frames[k]?.o, 0);
  });

  test('simulation state is pooled and reused across bursts', () => {
    const engine = new ParticleEngine();
    engine.simulate((e) => burst(e, 30), options());
    const created = engine.statesCreated;
    for (let i = 0; i < 50; i++)
      engine.simulate((e) => burst(e, 30), options({ rng: mulberry32(i) }));
    assert.strictEqual(engine.statesCreated, created);
    assert.strictEqual(engine.pooledStates, 30);
  });

  test('pool capacity bounds retained objects', () => {
    const engine = new ParticleEngine(10);
    engine.simulate((e) => burst(e, 40), options());
    assert.strictEqual(engine.pooledStates, 10);
  });

  test('bounds contain every visible element and respect the clamp', () => {
    const track = new ParticleEngine().simulate((e) => burst(e, 20), options());
    for (const el of track.elements) {
      for (const f of el.frames) {
        if (f.o <= 0) continue;
        assert.ok(Math.abs(f.x) <= track.halfWidth);
        assert.ok(Math.abs(f.y) <= track.halfHeight);
      }
    }
    const clamped = new ParticleEngine().simulate(
      (e) => e.particle({ vx: 5000, vy: 5000, size: 2, color: '#fff', shape: 'circle' }),
      options({ maxHalfExtent: 50 }),
    );
    assert.strictEqual(clamped.halfWidth, 50);
    assert.strictEqual(clamped.halfHeight, 50);
  });

  test('measure has a minimum extent for empty bursts', () => {
    assert.deepStrictEqual(measure([], 100), { halfWidth: 4, halfHeight: 4 });
  });

  test('localLife maps burst time to element life', () => {
    assert.strictEqual(localLife(0.5), 0.5);
    assert.strictEqual(localLife(0.25, 0.5), -0.5);
    assert.strictEqual(localLife(0.5, 0, 0.5), 1);
    assert.strictEqual(localLife(1, 0.5, 1), 1); // life is clipped to the remaining time
  });
});
