import * as assert from 'assert';
import { anchorRange, attachmentMargin, computeLineHeight } from '../../src/render/geometry';
import { interimBurstSvg } from '../../src/render/interimBurst';
import { escapeXml, svgToDataUri } from '../../src/render/svg';
import { cycle } from '../../src/utils/cycle';

suite('Render geometry', () => {
  test('attachment margin has zero net horizontal width and is vertically centred', () => {
    const margin = attachmentMargin(96, 96, 20);
    const [top, right, bottom, left] = margin.split(' ').map((p) => parseFloat(p));
    assert.strictEqual(top, 0);
    assert.strictEqual(96 + (right ?? 0) + (left ?? 0), 0);
    assert.strictEqual(bottom, -(48 - 0.22 * 20));
  });

  test('anchor range covers the character before the caret', () => {
    assert.deepStrictEqual(anchorRange({ line: 3, character: 5 }), {
      start: { line: 3, character: 4 },
      end: { line: 3, character: 5 },
    });
  });

  test('anchor range at column 0 is empty', () => {
    assert.deepStrictEqual(anchorRange({ line: 3, character: 0 }), {
      start: { line: 3, character: 0 },
      end: { line: 3, character: 0 },
    });
  });

  test('line height follows editor.lineHeight semantics', () => {
    assert.strictEqual(computeLineHeight(14, 0, false), 19);
    assert.strictEqual(computeLineHeight(14, 0, true), 21);
    assert.strictEqual(computeLineHeight(14, 1.5, false), 21);
    assert.strictEqual(computeLineHeight(14, 24, false), 24);
    assert.strictEqual(computeLineHeight(0, 0, false), 19);
  });
});

suite('SVG helpers', () => {
  test('data URI round-trips', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const uri = svgToDataUri(svg);
    assert.ok(uri.startsWith('data:image/svg+xml;base64,'));
    assert.strictEqual(Buffer.from(uri.split(',')[1] ?? '', 'base64').toString('utf8'), svg);
  });

  test('escapeXml escapes all special characters', () => {
    assert.strictEqual(
      escapeXml(`<a href="x">'&'</a>`),
      '&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;',
    );
  });

  test('interim burst renders the requested particle count', () => {
    const svg = interimBurstSvg({
      colors: ['#fff'],
      count: 7,
      size: 3,
      speed: 1,
      lifetimeMs: 500,
      canvas: 96,
    });
    assert.strictEqual(svg.match(/<circle /g)?.length, 7);
    assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"'));
  });
});

suite('cycle', () => {
  const items = ['a', 'b', 'c'];
  test('wraps forwards and backwards', () => {
    assert.strictEqual(cycle(items, 'c', 1), 'a');
    assert.strictEqual(cycle(items, 'a', -1), 'c');
    assert.strictEqual(cycle(items, 'b', 1), 'c');
  });
  test('unknown current starts at the ends', () => {
    assert.strictEqual(cycle(items, 'z', 1), 'a');
    assert.strictEqual(cycle(items, 'z', -1), 'c');
  });
  test('throws on empty list', () => {
    assert.throws(() => cycle([], 'a', 1));
  });
});

suite('anchorRange with getter-based positions', () => {
  test('reads line/character through getters (like vscode.Position)', () => {
    class GetterPosition {
      constructor(
        private readonly l: number,
        private readonly c: number,
      ) {}
      get line(): number {
        return this.l;
      }
      get character(): number {
        return this.c;
      }
    }
    assert.deepStrictEqual(anchorRange(new GetterPosition(2, 0)), {
      start: { line: 2, character: 0 },
      end: { line: 2, character: 0 },
    });
    assert.deepStrictEqual(anchorRange(new GetterPosition(2, 4)).end, { line: 2, character: 4 });
  });
});
