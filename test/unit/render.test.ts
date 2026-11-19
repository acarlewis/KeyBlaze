import * as assert from 'assert';
import { computeLineHeight } from '../../src/render/geometry';
import { escapeXml, svgToDataUri } from '../../src/render/svg';
import { cycle } from '../../src/utils/cycle';

suite('Render geometry', () => {
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
