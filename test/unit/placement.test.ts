import * as assert from 'assert';
import type { CaretContext } from '../../src/core/placement';
import {
  BASELINE_EM,
  MAX_BELOW_LINES,
  decideAnchor,
  hasNonColumnCharacters,
  layoutBurst,
  linesBelowFor,
  visualColumn,
} from '../../src/core/placement';

const LH = 19;
const FS = 14;
const B = BASELINE_EM * FS; // ≈ 4.1 px

function ctx(overrides: Partial<CaretContext> = {}): CaretContext {
  return {
    line: 10,
    character: 8,
    lineText: 'const value = 1;',
    lineCount: 100,
    tabSize: 4,
    lineHeight: LH,
    fontSize: FS,
    wordWrap: 'off',
    wordWrapColumn: 80,
    lineVisualLength: () => 20,
    visibleRanges: [[0, 60]],
    inlayHintBeforeCaret: false,
    placement: 'auto',
    ...overrides,
  };
}

suite('placement: helpers', () => {
  test('visualColumn expands tabs to tab stops', () => {
    assert.strictEqual(visualColumn('abc', 2, 4), 2);
    assert.strictEqual(visualColumn('\t\tx', 2, 4), 8);
    assert.strictEqual(visualColumn('ab\tx', 3, 4), 4);
    assert.strictEqual(visualColumn('ab\tx', 3, 2), 4);
    assert.strictEqual(visualColumn('short', 99, 4), 5);
  });

  test('non-column characters are detected', () => {
    assert.ok(!hasNonColumnCharacters('const x = "héllo";\t// ascii + latin-1'));
    assert.ok(hasNonColumnCharacters('const 名前'));
    assert.ok(hasNonColumnCharacters('emoji 🎉'));
    assert.ok(hasNonColumnCharacters('é')); // combining accent
  });

  test('linesBelowFor accounts for the baseline offset and clamps', () => {
    assert.strictEqual(linesBelowFor(3, LH, FS), 0);
    assert.strictEqual(linesBelowFor(B + 1, LH, FS), 1);
    assert.strictEqual(linesBelowFor(B + LH, LH, FS), 1);
    assert.strictEqual(linesBelowFor(B + LH + 0.5, LH, FS), 2);
    assert.strictEqual(linesBelowFor(10_000, LH, FS), MAX_BELOW_LINES);
  });
});

suite('placement: decideAnchor', () => {
  test('normal code → below-anchored full-circle', () => {
    assert.deepStrictEqual(decideAnchor(ctx(), 120), { mode: 'below', variant: 'full' });
  });

  test('a burst that fits above the baseline needs no lines below', () => {
    assert.deepStrictEqual(decideAnchor(ctx(), 3), { mode: 'caret', variant: 'full' });
  });

  test('cursorLine setting forces caret/upward', () => {
    assert.deepStrictEqual(decideAnchor(ctx({ placement: 'cursorLine' }), 120), {
      mode: 'caret',
      variant: 'upward',
      reason: 'setting',
    });
  });

  test('wide characters before the caret fall back', () => {
    const d = decideAnchor(ctx({ lineText: 'const 名前 = 1;', character: 9 }), 120);
    assert.strictEqual(d.reason, 'wideCharacters');
  });

  test('wide characters after the caret do not matter', () => {
    const d = decideAnchor(ctx({ lineText: 'abc // 名前', character: 3 }), 120);
    assert.strictEqual(d.mode, 'below');
  });

  test('inlay hints before the caret fall back', () => {
    assert.strictEqual(decideAnchor(ctx({ inlayHintBeforeCaret: true }), 120).reason, 'inlayHints');
  });

  test('too few lines below fall back', () => {
    assert.strictEqual(
      decideAnchor(ctx({ line: 97, lineCount: 100 }), 120).reason,
      'endOfDocument',
    );
  });

  test('a fold or the viewport edge between caret and anchor falls back', () => {
    assert.strictEqual(
      decideAnchor(
        ctx({
          visibleRanges: [
            [0, 11],
            [40, 60],
          ],
        }),
        120,
      ).reason,
      'notVisible',
    );
    assert.strictEqual(decideAnchor(ctx({ visibleRanges: [[0, 12]] }), 120).reason, 'notVisible');
  });

  test('when the anchor is off-screen and a spanned line could wrap, the reason is notVisible', () => {
    // Regression: CI windows (1024x768 with side bars) showed too few lines; both fallbacks apply and
    // visibility is checked first. Either way the burst rises from the caret line.
    const d = decideAnchor(
      ctx({ wordWrap: 'on', lineVisualLength: () => 120, visibleRanges: [[0, 12]] }),
      120,
    );
    assert.deepStrictEqual(d, { mode: 'caret', variant: 'upward', reason: 'notVisible' });
  });

  test('word wrap falls back only when a spanned line could wrap', () => {
    assert.strictEqual(
      decideAnchor(ctx({ wordWrap: 'on', lineVisualLength: () => 30 }), 120).mode,
      'below',
    );
    assert.strictEqual(
      decideAnchor(ctx({ wordWrap: 'on', lineVisualLength: () => 45 }), 120).reason,
      'wordWrap',
    );
    assert.strictEqual(
      decideAnchor(
        ctx({ wordWrap: 'wordWrapColumn', wordWrapColumn: 120, lineVisualLength: () => 100 }),
        120,
      ).mode,
      'below',
    );
    assert.strictEqual(
      decideAnchor(ctx({ wordWrap: 'off', lineVisualLength: () => 500 }), 120).mode,
      'below',
    );
  });
});

suite('placement: layoutBurst', () => {
  const extents = { halfWidth: 48, up: 50, down: 40 };

  test('caret layout: zero layout height, zero net width, origin at line middle', () => {
    const l = layoutBurst(extents, 'caret', ctx());
    assert.strictEqual(l.mode, 'caret');
    assert.deepStrictEqual([l.line, l.startCharacter, l.endCharacter], [10, 7, 8]);
    assert.strictEqual(l.width, 96);
    assert.strictEqual(l.height, Math.round(50 + B));
    assert.ok(Math.abs(l.originY - (l.height - B)) < 1e-9);
    assert.strictEqual(l.margin, `${-l.height}px -48px 0 -48px`);
  });

  test('caret layout at column 0 uses an empty range', () => {
    const l = layoutBurst(extents, 'caret', ctx({ character: 0 }));
    assert.deepStrictEqual([l.startCharacter, l.endCharacter], [0, 0]);
  });

  test('below layout: anchored N lines down at column 0, offset by visual column in ch', () => {
    const l = layoutBurst(extents, 'below', ctx({ lineText: '\tab', character: 3 }));
    const n = linesBelowFor(40, LH, FS);
    assert.strictEqual(l.mode, 'below');
    assert.deepStrictEqual([l.line, l.startCharacter, l.endCharacter], [10 + n, 0, 0]);
    assert.strictEqual(l.height, Math.round(50 + n * LH + B));
    // The origin sits n lines + baseline offset above the image bottom.
    assert.ok(Math.abs(l.height - l.originY - (n * LH + B)) < 1e-9);
    assert.strictEqual(l.margin, `${-l.height}px calc(-6ch - 48px) 0 calc(6ch - 48px)`);
  });

  test('below layout degrades to caret when the burst fits above the baseline', () => {
    const l = layoutBurst({ halfWidth: 10, up: 20, down: 3 }, 'below', ctx());
    assert.strictEqual(l.mode, 'caret');
  });

  test('the origin always lands on the caret line middle (model check)', () => {
    // Model: image bottom = baseline of the anchor line; baseline = line middle + B;
    // origin = bottom - (height - originY). Expect origin == middle of the caret line.
    for (const mode of ['caret', 'below'] as const) {
      for (const down of [2, 20, 60, 119]) {
        const l = layoutBurst({ halfWidth: 30, up: 40, down }, mode, ctx());
        const anchorMiddle = (l.line - 10) * LH; // relative to the caret line's middle
        const bottom = anchorMiddle + B;
        const origin = bottom - (l.height - l.originY);
        assert.ok(Math.abs(origin) < 1e-9, `${mode} down=${down}: ${origin}`);
      }
    }
  });
});
