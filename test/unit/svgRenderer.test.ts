import * as assert from 'assert';
import type { BurstTrack, Frame, ShapeKind } from '../../src/core/BurstTrack';
import { renderBurstSvg } from '../../src/render/SvgRenderer';
import { assertWellFormed } from './xml';

const frames = (n: number, f: Partial<Frame> = {}): Frame[] =>
  Array.from({ length: n }, (_, i) => ({ x: i, y: -i, s: 1, o: 1 - i / (n - 1), r: 0, ...f }));

function track(elements: BurstTrack['elements'], half = 40): BurstTrack {
  return { durationMs: 500, keyframes: 4, halfWidth: half, up: half / 2, down: half / 2, elements };
}

suite('SvgRenderer', () => {
  test('dimensions are twice the half extents, origin at centre', () => {
    const out = renderBurstSvg(track([]), { glow: true });
    assert.strictEqual(out.width, 80);
    assert.strictEqual(out.height, 40);
    assert.ok(out.svg.includes('width="80" height="40"'));
    assert.ok(out.svg.includes('translate(40 20)'));
    assertWellFormed(out.svg);
  });

  test('explicit layout sets image height and origin; nonce makes documents unique', () => {
    const a = renderBurstSvg(track([]), { glow: false, height: 57, originY: 31.5, nonce: 'n1' });
    const b = renderBurstSvg(track([]), { glow: false, height: 57, originY: 31.5, nonce: 'n2' });
    assert.strictEqual(a.height, 57);
    assert.ok(a.svg.includes('height="57"'));
    assert.ok(a.svg.includes('translate(40 31.5)'));
    assert.ok(a.svg.includes('<desc>n1</desc>'));
    assert.notStrictEqual(a.svg, b.svg);
    assertWellFormed(a.svg);
  });

  test('particles animate translate, scale and opacity with one value per keyframe', () => {
    const out = renderBurstSvg(
      track([
        {
          kind: 'particle',
          shape: 'circle',
          size: 3,
          color: '#ff0000',
          glow: 0,
          frames: frames(4),
        },
      ]),
      { glow: true },
    );
    assertWellFormed(out.svg);
    assert.ok(out.svg.includes('type="translate" values="0,0;1,-1;2,-2;3,-3"'));
    assert.ok(out.svg.includes('attributeName="opacity" values="1;0.67;0.33;0"'));
    assert.ok(out.svg.includes('dur="500ms"'));
    assert.ok(out.svg.includes('fill="freeze"'));
    assert.ok(!out.svg.includes('type="rotate"'), 'circles never rotate');
  });

  for (const shape of ['circle', 'square', 'triangle', 'star', 'spark'] as ShapeKind[]) {
    test(`renders ${shape} particles as valid SVG`, () => {
      const out = renderBurstSvg(
        track([
          {
            kind: 'particle',
            shape,
            size: 2,
            color: '#00ff00',
            glow: 0,
            frames: frames(4, { r: 45 }),
          },
        ]),
        { glow: false },
      );
      assertWellFormed(out.svg);
      if (shape !== 'circle') assert.ok(out.svg.includes('type="rotate"'));
    });
  }

  test('glow adds a shared radial gradient only when allowed', () => {
    const el = {
      kind: 'particle' as const,
      shape: 'circle' as const,
      size: 2,
      color: '#abcdef',
      glow: 0.8,
      frames: frames(4),
    };
    const withGlow = renderBurstSvg(track([el, { ...el }]), { glow: true });
    assertWellFormed(withGlow.svg);
    assert.strictEqual(withGlow.svg.match(/<radialGradient/g)?.length, 1);
    assert.ok(withGlow.svg.includes('url(#gabcdef)'));
    const without = renderBurstSvg(track([el]), { glow: false });
    assert.ok(!without.svg.includes('radialGradient'));
  });

  test('rings animate radius', () => {
    const out = renderBurstSvg(
      track([
        {
          kind: 'ring',
          strokeWidth: 2,
          color: '#00ffff',
          glow: 1,
          frames: frames(4).map((f, i) => ({ ...f, s: 5 + i * 10 })),
        },
      ]),
      { glow: true },
    );
    assertWellFormed(out.svg);
    assert.ok(out.svg.includes('attributeName="r" values="5;15;25;35"'));
  });

  test('bolts render a polyline with flickering opacity', () => {
    const out = renderBurstSvg(
      track([
        {
          kind: 'bolt',
          width: 1.5,
          color: '#ffffff',
          glow: 0.5,
          points: [0, 0, 4, 8, -2, 16],
          frames: frames(4),
        },
      ]),
      { glow: true },
    );
    assertWellFormed(out.svg);
    assert.ok(out.svg.includes('points="0,0 4,8 -2,16"'));
    assert.strictEqual(out.svg.match(/<polyline/g)?.length, 3, 'halo + bolt + white core');
  });

  test('colour strings are escaped', () => {
    const out = renderBurstSvg(
      track([
        {
          kind: 'particle',
          shape: 'circle',
          size: 2,
          color: '"><script>',
          glow: 0,
          frames: frames(4),
        },
      ]),
      { glow: false },
    );
    assert.ok(!out.svg.includes('<script>'));
    assertWellFormed(out.svg);
  });
});
