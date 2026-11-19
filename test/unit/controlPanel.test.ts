import * as assert from 'assert';
import { parseWebviewMessage } from '../../src/config/messages';
import type { BurstElement } from '../../src/core/BurstTrack';
import { sampleFrame } from '../../src/render/frameSampler';

suite('Control Panel protocol', () => {
  test('accepts well-formed messages', () => {
    assert.deepStrictEqual(parseWebviewMessage({ type: 'ready' }), { type: 'ready' });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'update', key: 'intensity', value: 7 }), {
      type: 'update',
      key: 'intensity',
      value: 7,
    });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'resetKey', key: 'colors' }), {
      type: 'resetKey',
      key: 'colors',
    });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'applyPreset', id: 'starfall' }), {
      type: 'applyPreset',
      id: 'starfall',
    });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'command', command: 'toggle' }), {
      type: 'command',
      command: 'toggle',
    });
    assert.deepStrictEqual(parseWebviewMessage({ type: 'resetAll' }), { type: 'resetAll' });
  });

  test('rejects malformed or unknown messages', () => {
    const bad: unknown[] = [
      null,
      undefined,
      42,
      'ready',
      [],
      {},
      { type: 'nope' },
      { type: 'update', key: 'notASetting', value: 1 },
      { type: 'update', key: 'intensity' },
      { type: 'update', key: '__proto__', value: 1 },
      { type: 'resetKey', key: 5 },
      { type: 'applyPreset', id: 'hacked' },
      { type: 'command', command: 'workbench.action.files.delete' },
      { type: 'error' },
    ];
    for (const message of bad) {
      assert.strictEqual(parseWebviewMessage(message), undefined, JSON.stringify(message));
    }
  });

  test('error messages are truncated', () => {
    const msg = parseWebviewMessage({ type: 'error', message: 'x'.repeat(5000) });
    assert.ok(msg && msg.type === 'error' && msg.message.length === 2000);
  });
});

suite('frameSampler', () => {
  const el: BurstElement = {
    kind: 'particle',
    shape: 'circle',
    size: 2,
    color: '#fff',
    glow: 0,
    frames: [
      { x: 0, y: 0, s: 1, o: 1, r: 0 },
      { x: 10, y: -10, s: 0.5, o: 0.5, r: 90 },
      { x: 20, y: -20, s: 0, o: 0, r: 180 },
    ],
  };

  test('interpolates linearly between evenly spaced keyframes (like SMIL)', () => {
    assert.deepStrictEqual(sampleFrame(el, 0, 1000), el.frames[0]);
    assert.deepStrictEqual(sampleFrame(el, 250, 1000), { x: 5, y: -5, s: 0.75, o: 0.75, r: 45 });
    assert.deepStrictEqual(sampleFrame(el, 500, 1000), { x: 10, y: -10, s: 0.5, o: 0.5, r: 90 });
  });

  test('holds the last frame after the end (fill="freeze") and clamps negative time', () => {
    assert.deepStrictEqual(sampleFrame(el, 5000, 1000), el.frames[2]);
    assert.deepStrictEqual(sampleFrame(el, -10, 1000), el.frames[0]);
  });

  test('empty elements sample to undefined', () => {
    assert.strictEqual(sampleFrame({ ...el, frames: [] }, 10, 100), undefined);
  });
});
