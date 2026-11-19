import * as assert from 'assert';
import { ComboManager, displayThreshold, milestoneFor } from '../../src/core/ComboManager';
import {
  flashSteps,
  impactAmplitude,
  impactDuration,
  tierColor,
  withAlpha,
} from '../../src/core/impact';
import { renderComboBadge } from '../../src/render/ComboBadge';
import { auraExtents, auraRadius, renderAura } from '../../src/render/CursorAura';
import { renderBurstSvg } from '../../src/render/SvgRenderer';
import { shakeAnimation, shakeValues } from '../../src/render/svg';
import { assertWellFormed } from './xml';

function clock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const MILESTONES = [10, 25, 50, 100];

suite('ComboManager', () => {
  test('counts consecutive hits', () => {
    const c = clock();
    const combo = new ComboManager({ resetTimeMs: 3000, milestones: MILESTONES }, c.now);
    const first = combo.hit();
    assert.deepStrictEqual([first.count, first.started], [1, true]);
    c.advance(100);
    const second = combo.hit();
    assert.deepStrictEqual([second.count, second.started], [2, false]);
  });

  test('a gap longer than resetTime starts a new combo', () => {
    const c = clock();
    const combo = new ComboManager({ resetTimeMs: 500, milestones: MILESTONES }, c.now);
    combo.hit();
    combo.hit();
    c.advance(501);
    const hit = combo.hit();
    assert.strictEqual(hit.count, 1);
    assert.ok(hit.started);
  });

  test('a gap of exactly resetTime keeps the combo', () => {
    const c = clock();
    const combo = new ComboManager({ resetTimeMs: 500, milestones: MILESTONES }, c.now);
    combo.hit();
    c.advance(500);
    assert.strictEqual(combo.hit().count, 2);
  });

  test('expire() ends an expired combo once and reports the ended count', () => {
    const c = clock();
    const combo = new ComboManager({ resetTimeMs: 500, milestones: MILESTONES }, c.now);
    combo.hit();
    combo.hit();
    assert.strictEqual(combo.expire(), 0, 'not expired yet');
    c.advance(600);
    assert.strictEqual(combo.expire(), 2);
    assert.strictEqual(combo.expire(), 0);
    assert.strictEqual(combo.snapshot().count, 0);
  });

  test('reset() ends the combo immediately', () => {
    const combo = new ComboManager({ resetTimeMs: 5000, milestones: MILESTONES }, clock().now);
    combo.hit();
    assert.strictEqual(combo.reset(), 1);
    assert.strictEqual(combo.hit().count, 1);
  });

  test('milestones fire exactly at the configured counts', () => {
    const c = clock();
    const combo = new ComboManager({ resetTimeMs: 3000, milestones: MILESTONES }, c.now);
    const hits: number[] = [];
    for (let i = 1; i <= 120; i++) {
      c.advance(50);
      const h = combo.hit();
      if (h.milestone) hits.push(h.milestone.count);
    }
    assert.deepStrictEqual(hits, [10, 25, 50, 100]);
  });

  test('past the last milestone, every multiple of it is a top-tier milestone', () => {
    assert.deepStrictEqual(milestoneFor(200, MILESTONES), { count: 200, tier: 3, tierCount: 4 });
    assert.strictEqual(milestoneFor(150, MILESTONES), undefined);
    assert.deepStrictEqual(milestoneFor(25, MILESTONES), { count: 25, tier: 1, tierCount: 4 });
    assert.strictEqual(milestoneFor(10, []), undefined);
  });

  test('tracks the best combo, seeded from persisted state', () => {
    const c = clock();
    const combo = new ComboManager({ resetTimeMs: 500, milestones: MILESTONES }, c.now, 3);
    combo.hit();
    combo.hit();
    assert.strictEqual(combo.snapshot().best, 3);
    const third = combo.hit();
    assert.ok(!third.newBest);
    assert.ok(combo.hit().newBest);
    assert.strictEqual(combo.snapshot().best, 4);
  });

  test('snapshot reports the remaining time', () => {
    const c = clock();
    const combo = new ComboManager({ resetTimeMs: 1000, milestones: MILESTONES }, c.now);
    combo.hit();
    c.advance(300);
    assert.strictEqual(combo.snapshot().remainingMs, 700);
    c.advance(800);
    assert.deepStrictEqual([combo.snapshot().count, combo.snapshot().remainingMs], [0, 0]);
  });

  test('configure() applies a new reset time', () => {
    const c = clock();
    const combo = new ComboManager({ resetTimeMs: 1000, milestones: MILESTONES }, c.now);
    combo.hit();
    combo.configure({ resetTimeMs: 100, milestones: MILESTONES });
    c.advance(200);
    assert.strictEqual(combo.hit().count, 1);
  });

  test('display threshold is the first milestone capped at 10', () => {
    assert.strictEqual(displayThreshold([10, 25]), 10);
    assert.strictEqual(displayThreshold([5, 25]), 5);
    assert.strictEqual(displayThreshold([50]), 10);
    assert.strictEqual(displayThreshold([]), 10);
  });
});

suite('Impact Pulse', () => {
  const m = (tier: number) => ({ count: 1, tier, tierCount: 4 });

  test('amplitude grows with intensity and tier and is clamped', () => {
    const a = impactAmplitude({ intensity: 3, durationMs: 250 }, m(0));
    const b = impactAmplitude({ intensity: 3, durationMs: 250 }, m(3));
    const c = impactAmplitude({ intensity: 10, durationMs: 250 }, m(3));
    assert.ok(b > a);
    assert.strictEqual(c, 12);
    assert.ok(impactAmplitude({ intensity: 1, durationMs: 250 }, m(0)) >= 1);
  });

  test('duration grows with tier and stays ≤ 1000 ms', () => {
    assert.strictEqual(impactDuration({ intensity: 3, durationMs: 200 }, m(0)), 200);
    assert.ok(impactDuration({ intensity: 3, durationMs: 200 }, m(2)) > 200);
    assert.strictEqual(impactDuration({ intensity: 3, durationMs: 1000 }, m(3)), 1000);
  });

  test('flash steps fade out and end clear', () => {
    const steps = flashSteps(300, m(1));
    assert.strictEqual(steps[0]?.atMs, 0);
    assert.strictEqual(steps.at(-1)?.alpha, 0);
    assert.strictEqual(steps.at(-1)?.atMs, 300);
    for (let i = 1; i < steps.length; i++)
      assert.ok((steps[i]?.alpha ?? 1) < (steps[i - 1]?.alpha ?? 0));
  });

  test('withAlpha converts hex colours', () => {
    assert.strictEqual(withAlpha('#ff8000', 0.5), 'rgba(255, 128, 0, 0.5)');
    assert.strictEqual(withAlpha('#abc', 0.25), 'rgba(170, 187, 204, 0.25)');
  });

  test('tier colour follows the highest milestone reached', () => {
    const colors = ['#000001', '#000002', '#000003'];
    assert.strictEqual(tierColor(5, MILESTONES, colors), '#000001');
    assert.strictEqual(tierColor(10, MILESTONES, colors), '#000001');
    assert.strictEqual(tierColor(30, MILESTONES, colors), '#000002');
    assert.strictEqual(tierColor(500, MILESTONES, colors), '#000003');
  });

  test('shake values decay and end at rest', () => {
    const values = shakeValues(6).split(';');
    assert.strictEqual(values.at(-1), '0,0');
    assert.strictEqual(values[0], '6,-3');
    assert.strictEqual(shakeAnimation(undefined), '');
    assert.strictEqual(shakeAnimation({ amplitude: 0, durationMs: 100 }), '');
    assert.ok(shakeAnimation({ amplitude: 3, durationMs: 250 }).includes('dur="250ms"'));
  });

  test('burst SVG carries the jitter only when shaking', () => {
    const track = { durationMs: 500, keyframes: 2, halfWidth: 10, up: 10, down: 10, elements: [] };
    const shaken = renderBurstSvg(track, {
      glow: false,
      shake: { amplitude: 4, durationMs: 200 },
    }).svg;
    assertWellFormed(shaken);
    assert.ok(shaken.includes('type="translate" values="4,-2'));
    assert.ok(!renderBurstSvg(track, { glow: false }).svg.includes('type="translate" values='));
  });
});

suite('Combo badge SVG', () => {
  const base = {
    count: 25,
    lineHeight: 19,
    color: '#ff8a00',
    remainingMs: 2500,
    celebrate: false,
    nonce: 'n',
  };

  test('pill fits within one line and the image leaves room for the pop', () => {
    const b = renderComboBadge(base);
    assertWellFormed(b.svg);
    assert.ok(b.pillHeight <= 19 * 0.75);
    assert.ok(b.height > b.pillHeight);
    assert.ok(b.width > b.pillWidth);
    assert.ok(b.svg.includes('>25x<'));
    assert.ok(b.svg.includes('>COMBO<'));
  });

  test('drain bar empties over the remaining time', () => {
    const b = renderComboBadge(base);
    assert.ok(b.svg.includes('dur="2500ms"'));
    assert.ok(!renderComboBadge({ ...base, remainingMs: 0 }).svg.includes('attributeName="width"'));
  });

  test('celebration uses a bigger pop and an exclamation', () => {
    const b = renderComboBadge({
      ...base,
      celebrate: true,
      shake: { amplitude: 3, durationMs: 250 },
    });
    assertWellFormed(b.svg);
    assert.ok(b.svg.includes('COMBO!'));
    assert.ok(b.svg.includes('values="1.7;'));
    assert.ok(b.svg.includes('type="translate" values="3,'));
  });

  test('width grows with the number of digits; nonce makes it unique', () => {
    assert.ok(
      renderComboBadge({ ...base, count: 1000 }).pillWidth >
        renderComboBadge({ ...base, count: 10 }).pillWidth,
    );
    assert.notStrictEqual(
      renderComboBadge(base).svg,
      renderComboBadge({ ...base, nonce: 'm' }).svg,
    );
  });

  test('colour strings are escaped', () => {
    const b = renderComboBadge({ ...base, color: '"/><script>' });
    assert.ok(!b.svg.includes('<script>'));
    assertWellFormed(b.svg);
  });
});

suite('Cursor aura SVG', () => {
  for (const kind of ['glow', 'ring'] as const) {
    test(`${kind} renders a looping, well-formed SVG centred on the origin`, () => {
      const svg = renderAura(kind, '#00f5d4', 19, { width: 40, height: 70, originY: 26 });
      assertWellFormed(svg);
      assert.ok(svg.includes('repeatCount="indefinite"'));
      assert.ok(svg.includes('cx="20" cy="26"'));
    });
  }

  test('extents cover the radius', () => {
    const e = auraExtents('glow', 19);
    assert.ok(e.halfWidth > auraRadius('glow', 19));
    assert.strictEqual(e.up, e.down);
  });
});
