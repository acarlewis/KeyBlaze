import * as assert from 'assert';
import { defaultSettings } from '../../src/config/schema';
import { PRESETS } from '../../src/config/presets';
import { AnimationEngine, buildEffectParams } from '../../src/core/AnimationEngine';
import type { BurstTrack, FlameElement } from '../../src/core/BurstTrack';
import { ParticleEngine } from '../../src/core/ParticleEngine';
import type { EffectVariant } from '../../src/core/placement';
import { qualityProfile } from '../../src/core/quality';
import { mulberry32 } from '../../src/core/random';
import { heatForRate } from '../../src/core/typingRate';
import { brightness, flamePalette, mixColor } from '../../src/effects/color';
import { FireEffect } from '../../src/effects/FireEffect';
import {
  flameCore,
  flameExtents,
  flameGeometry,
  flamePath,
  flameGlow,
} from '../../src/render/flamePath';
import { sampleFlameShape } from '../../src/render/frameSampler';
import { renderBurstSvg } from '../../src/render/SvgRenderer';
import { assertWellFormed } from './xml';

const FIRESTORM = { ...defaultSettings(), ...PRESETS.firestorm.values };

function fire(variant: EffectVariant, seed = 7, heat = 0, settings = FIRESTORM): BurstTrack {
  const profile = qualityProfile(settings['performance.quality'], settings.performanceMode);
  const p = buildEffectParams(settings, profile, 1, variant, heat);
  return new ParticleEngine().simulate((e) => FireEffect.spawn(e, p), {
    durationMs: settings.particleLifetime,
    keyframes: profile.keyframes,
    maxElements: profile.maxElements,
    maxHalfExtent: profile.maxHalfExtent,
    rng: mulberry32(seed),
  });
}

const flames = (t: BurstTrack): FlameElement[] =>
  t.elements.filter((e): e is FlameElement => e.kind === 'flame');

suite('Fire: flame geometry', () => {
  test('every outline has the same path structure, so SMIL can morph between keyframes', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 50; i++) {
      const d = flamePath({
        w: rng() * 12,
        h: rng() * 40,
        lean: rng() - 0.5,
        wobble: rng() * 2 - 1,
      });
      assert.match(d, /^M[^A-Za-z]+C[^A-Za-z]+C[^A-Za-z]+C[^A-Za-z]+C[^A-Za-z]+Z$/, d);
      assert.strictEqual(d.match(/-?\d+(\.\d+)?/g)?.length, 26, d);
    }
  });

  test('an upright, steady tongue is mirror-symmetric with a tip above a rounded base', () => {
    const g = flameGeometry({ w: 5, h: 20, lean: 0, wobble: 0 });
    assert.deepStrictEqual(g.start, [0, -20]);
    const [a, b, c, d] = g.curves;
    assert.ok(a && b && c && d);
    assert.deepStrictEqual(
      [d[0], d[1], d[2], d[3]].map((v) => +v.toFixed(6)),
      [-a[2], a[3], -a[0], a[1]].map((v) => +v.toFixed(6)),
    );
    assert.ok(g.bottom > 0 && g.top === -20);
  });

  test('leaning moves the tip sideways (the tongue curls)', () => {
    assert.ok(flameGeometry({ w: 5, h: 20, lean: 0.4, wobble: 0 }).start[0] > 7);
    assert.ok(flameGeometry({ w: 5, h: 20, lean: -0.4, wobble: 0 }).start[0] < -7);
  });

  test('core sits low inside the body; the glow surrounds it', () => {
    const shape = { w: 5, h: 20, lean: 0, wobble: 0 };
    const core = flameCore(shape);
    const glow = flameGlow(shape);
    assert.ok(core.rx < shape.w && core.cy < 0 && core.cy > -shape.h / 2);
    assert.ok(glow.rx > shape.w && glow.ry > core.ry);
    const e = flameExtents(shape, true);
    assert.ok(e.half >= glow.rx && e.up >= shape.h);
  });

  test('sampled outlines interpolate between keyframes like SMIL', () => {
    const el = flames(fire('full'))[0];
    assert.ok(el);
    const a = el.shapes[3];
    const b = el.shapes[4];
    assert.ok(a && b);
    const step = 800 / (el.shapes.length - 1);
    const mid = sampleFlameShape(el, step * 3.5, 800);
    assert.ok(mid);
    assert.ok(Math.abs(mid.h - (a.h + b.h) / 2) < 1e-9);
    assert.deepStrictEqual(sampleFlameShape(el, 5000, 800), el.shapes.at(-1));
  });
});

suite('Fire: effect', () => {
  test('draws flame tongues (not dots), plus a few embers', () => {
    const t = fire('full');
    const f = flames(t);
    assert.ok(f.length >= 3, `${f.length} tongues`);
    assert.ok(f.length > t.elements.length / 2, 'mostly flames');
    for (const el of f) {
      assert.strictEqual(el.shapes.length, el.frames.length);
      // At its fullest a tongue is clearly taller than wide.
      const peak = el.shapes.reduce((m, s) => (s.h > m.h ? s : m));
      assert.ok(peak.h > peak.w * 2.5, `h ${peak.h} w ${peak.w}`);
    }
  });

  test('tongues have different sizes, timings and sway together', () => {
    const f = flames(fire('full', 11));
    const heights = f.map((el) => Math.max(...el.shapes.map((s) => s.h)));
    assert.ok(Math.max(...heights) > Math.min(...heights) * 1.5);
    const births = f.map((el) => el.frames.findIndex((fr) => fr.o > 0));
    assert.ok(new Set(births).size > 1, 'staggered');
  });

  test('flames swell in, flicker and die down', () => {
    for (const el of flames(fire('full', 2))) {
      const visible = el.shapes.filter((_, i) => (el.frames[i]?.o ?? 0) > 0);
      if (visible.length < 4) continue;
      const peak = Math.max(...visible.map((s) => s.h));
      assert.ok((visible[0]?.h ?? 0) < peak, 'swells in');
      assert.ok(
        (visible.at(-1)?.w ?? 0) < Math.max(...visible.map((s) => s.w)),
        'narrows at the end',
      );
    }
  });

  test('rising variant keeps every tongue base above the caret baseline', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      for (const el of flames(fire('upward', seed))) {
        el.frames.forEach((f, i) => {
          const s = el.shapes[i];
          if (f.o <= 0.02 || !s) return;
          assert.ok(f.y + s.w * 0.62 <= 4.5, `seed ${seed}: base reaches ${f.y + s.w * 0.62}`);
        });
      }
    }
  });

  test('burst bounds contain every visible flame and its glow', () => {
    const t = fire('full', 9, 1);
    for (const el of flames(t)) {
      el.frames.forEach((f, i) => {
        const s = el.shapes[i];
        if (f.o <= 0 || !s) return;
        const e = flameExtents(s, el.glow > 0);
        assert.ok(Math.abs(f.x) + e.half <= t.halfWidth + 0.5, 'width');
        assert.ok(-f.y + e.up <= t.up + 0.5, 'height');
        assert.ok(f.y + e.down <= t.down + 0.5, 'below');
      });
    }
  });

  test('typing heat makes the fire burn higher without exceeding the element budget', () => {
    const peak = (t: BurstTrack): number =>
      Math.max(...flames(t).flatMap((el) => el.shapes.map((s) => s.h)));
    let cool = 0;
    let hot = 0;
    for (let seed = 1; seed <= 10; seed++) {
      cool += peak(fire('full', seed, 0));
      const t = fire('full', seed, 1);
      hot += peak(t);
      assert.ok(t.elements.length <= qualityProfile('high', false).maxElements);
    }
    assert.ok(hot > cool * 1.3, `hot ${hot} cool ${cool}`);
  });

  test('performance mode: fewer, simpler tongues without glow', () => {
    const t = fire('full', 4, 0, { ...FIRESTORM, performanceMode: true });
    assert.ok(t.elements.length <= 16);
    assert.ok(flames(t).every((el) => el.glow === 0 && el.shapes.length === 4));
  });

  test('colours: bodies use palette colours; the core is the brightest one pushed to white', () => {
    const colors = ['#ff3d00', '#ff8f00', '#ffd600', '#fff176'];
    const t = fire('full', 5, 0, { ...FIRESTORM, colors });
    for (const el of flames(t)) {
      assert.ok(colors.includes(el.color));
      assert.strictEqual(el.edge, '#ff3d00');
      assert.ok(brightness(el.core) > brightness('#fff176'));
    }
  });
});

suite('Fire: colours and heat', () => {
  test('flamePalette orders any palette by brightness', () => {
    const p = flamePalette(['#fff176', '#ff3d00', '#ffd600', '#ff8f00']);
    assert.strictEqual(p.edge, '#ff3d00');
    assert.strictEqual(p.ember, '#fff176');
    assert.deepStrictEqual(p.body, ['#ffd600', '#ff8f00']);
    const blue = flamePalette(['#001f5c', '#00b4ff', '#bdf3ff']);
    assert.strictEqual(blue.edge, '#001f5c');
    assert.strictEqual(flamePalette(['#ff0000']).edge, '#ff0000');
  });

  test('mixColor blends linearly', () => {
    assert.strictEqual(mixColor('#000000', '#ffffff', 0.5), '#808080');
    assert.strictEqual(mixColor('#f00', '#00f', 1), '#0000ff');
  });

  test('heat rises with the typing rate and is clamped', () => {
    assert.strictEqual(heatForRate(0), 0);
    assert.strictEqual(heatForRate(2), 0);
    assert.strictEqual(heatForRate(6), 0.5);
    assert.strictEqual(heatForRate(10), 1);
    assert.strictEqual(heatForRate(40), 1);
    const profile = qualityProfile('high', false);
    assert.strictEqual(buildEffectParams(FIRESTORM, profile).heat, 0);
    assert.strictEqual(buildEffectParams(FIRESTORM, profile, 1, 'full', 7).heat, 1);
  });

  test('AnimationEngine passes heat through to the effect', () => {
    const engine = new AnimationEngine();
    const h = (heat: number): number =>
      Math.max(
        ...flames(engine.simulate(FIRESTORM, { seed: 3, heat })).flatMap((el) =>
          el.shapes.map((s) => s.h),
        ),
      );
    assert.ok(h(1) > h(0));
  });
});

suite('Fire: SVG', () => {
  test('renders well-formed, morphing flames with shared gradients', () => {
    const t = fire('full', 6);
    const { svg } = renderBurstSvg(t, { glow: true, nonce: 'x' });
    assertWellFormed(svg);
    const morphs = svg.match(/<animate attributeName="d" values="([^"]*)"/g) ?? [];
    assert.strictEqual(morphs.length, flames(t).length, 'one outline morph per tongue');
    for (const m of morphs) assert.strictEqual(m.split(';').length, t.keyframes);
    // One body gradient per colour combination, not per tongue.
    const bodies = new Set(flames(t).map((el) => el.edge + el.color + el.core));
    assert.strictEqual(svg.match(/<linearGradient /g)?.length, bodies.size);
    assert.ok(svg.length < 30_000, `${svg.length} bytes`);
  });

  test('glow layers appear only when the quality profile allows them', () => {
    const t = fire('full', 6);
    assert.ok(/id="fg/.test(renderBurstSvg(t, { glow: true }).svg));
    assert.ok(!/id="fg/.test(renderBurstSvg(t, { glow: false }).svg));
  });

  test('stays within the size budget at full heat', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { svg } = renderBurstSvg(fire('full', seed, 1), { glow: true, nonce: 'x' });
      assert.ok(svg.length < 36_000, `seed ${seed}: ${svg.length} bytes`);
    }
  });
});
