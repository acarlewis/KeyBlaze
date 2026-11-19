import * as assert from 'assert';
import type { ChangeLike } from '../../src/core/TypingClassifier';
import {
  MAX_DELETE_LENGTH,
  classifyChange,
  isTypedText,
  mapPostEditPositions,
} from '../../src/core/TypingClassifier';

/** Builds a single-line change at (line, col) replacing `len` characters. `offset` is synthetic but ordered. */
function change(
  line: number,
  col: number,
  text: string,
  len = 0,
  endLine = line,
  endCol = col + len,
): ChangeLike {
  return {
    range: { start: { line, character: col }, end: { line: endLine, character: endCol } },
    rangeOffset: line * 1000 + col,
    rangeLength: len,
    text,
  };
}

suite('TypingClassifier', () => {
  suite('isTypedText', () => {
    test('accepts single characters including emoji', () => {
      for (const t of ['a', ' ', '\t', '\n', ';', 'é', '😀'])
        assert.ok(isTypedText(t), JSON.stringify(t));
    });
    test('accepts auto-closed pairs, Enter with indent, tab-as-spaces', () => {
      for (const t of ['()', '{}', '""', '\n    ', '\r\n\t', '\n\t\n', '    '])
        assert.ok(isTypedText(t), JSON.stringify(t));
    });
    test('rejects pasted or completed text', () => {
      for (const t of ['ab', 'console.log', 'foo\nbar', ' x', '(a)'])
        assert.ok(!isTypedText(t), JSON.stringify(t));
    });
  });

  suite('classifyChange', () => {
    test('single character insert → insert keystroke at caret', () => {
      assert.deepStrictEqual(classifyChange([change(2, 5, 'x')], undefined), {
        kind: 'insert',
        positions: [{ line: 2, character: 6 }],
      });
    });

    test('backspace → delete keystroke at deletion start', () => {
      assert.deepStrictEqual(classifyChange([change(0, 4, '', 1)], undefined), {
        kind: 'delete',
        positions: [{ line: 0, character: 4 }],
      });
    });

    test('deletes are ignored when triggerOnDelete is off', () => {
      assert.strictEqual(
        classifyChange([change(0, 4, '', 1)], undefined, {
          maxCursors: 32,
          triggerOnDelete: false,
        }),
        undefined,
      );
    });

    test('undo and redo are ignored', () => {
      assert.strictEqual(classifyChange([change(0, 0, 'a')], 'undo'), undefined);
      assert.strictEqual(classifyChange([change(0, 0, 'a')], 'redo'), undefined);
    });

    test('paste (multi-character insert) is ignored', () => {
      assert.strictEqual(classifyChange([change(0, 0, 'hello world')], undefined), undefined);
    });

    test('large deletions (cut / delete selection) are ignored', () => {
      assert.strictEqual(
        classifyChange([change(0, 0, '', MAX_DELETE_LENGTH + 1)], undefined),
        undefined,
      );
    });

    test('typing over a selection counts as an insert', () => {
      assert.strictEqual(classifyChange([change(0, 0, 'a', 40)], undefined)?.kind, 'insert');
    });

    test('empty change list is ignored', () => {
      assert.strictEqual(classifyChange([], undefined), undefined);
    });

    test('too many ranges (bulk edit) are ignored', () => {
      const changes = Array.from({ length: 33 }, (_, i) => change(i, 0, 'a'));
      assert.strictEqual(classifyChange(changes, undefined), undefined);
    });

    test('multi-cursor typing with identical text is one keystroke with N positions', () => {
      const ks = classifyChange(
        [change(0, 2, 'a'), change(1, 2, 'a'), change(2, 2, 'a')],
        undefined,
      );
      assert.strictEqual(ks?.positions.length, 3);
    });

    test('different texts at different ranges (programmatic edit) are ignored', () => {
      assert.strictEqual(
        classifyChange([change(0, 0, 'a'), change(1, 0, 'b')], undefined),
        undefined,
      );
    });

    test('one invalid change poisons the whole event', () => {
      assert.strictEqual(
        classifyChange([change(0, 0, 'a'), change(1, 0, 'pasted')], undefined),
        undefined,
      );
    });
  });

  suite('mapPostEditPositions', () => {
    test('auto-closed pair puts caret between characters', () => {
      assert.deepStrictEqual(mapPostEditPositions([change(0, 3, '()')]), [
        { line: 0, character: 4 },
      ]);
    });

    test('Enter with indentation moves to next line after indent', () => {
      assert.deepStrictEqual(mapPostEditPositions([change(4, 10, '\n    ')]), [
        { line: 5, character: 4 },
      ]);
    });

    test('multiple cursors on the same line shift each other', () => {
      // "ab|cd|ef" typing "x" at columns 2 and 4 → "abx|cdx|ef": carets at 3 and 6.
      const out = mapPostEditPositions([change(0, 4, 'x'), change(0, 2, 'x')]);
      assert.deepStrictEqual(out, [
        { line: 0, character: 3 },
        { line: 0, character: 6 },
      ]);
    });

    test('Enter at multiple cursors shifts later lines', () => {
      const out = mapPostEditPositions([change(0, 1, '\n'), change(2, 1, '\n')]);
      assert.deepStrictEqual(out, [
        { line: 1, character: 0 },
        { line: 4, character: 0 },
      ]);
    });

    test('multi-cursor backspace on the same line', () => {
      // "a|bc|d" backspace at columns 1 and 3 → removes "a" (0..1) and "c" (2..3) → "b|d" carets at 0 and 1.
      const out = mapPostEditPositions([change(0, 0, '', 1), change(0, 2, '', 1)]);
      assert.deepStrictEqual(out, [
        { line: 0, character: 0 },
        { line: 0, character: 1 },
      ]);
    });

    test('backspace joining lines', () => {
      const out = mapPostEditPositions([change(2, 7, '', 1, 3, 0)]);
      assert.deepStrictEqual(out, [{ line: 2, character: 7 }]);
    });
  });
});
