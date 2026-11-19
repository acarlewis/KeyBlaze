// Visual verification of the REAL KeyBlaze extension in VS Code 1.147.0.
// Genuine keystrokes (CDP) → KeyBlaze renders a burst → measure where the burst origin lands vs. the caret.
// Usage: npm run build && npm run compile-tests && node test/visual/verify-placement.mjs
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  RESULTS,
  key,
  launch,
  measure,
  measureImages,
  poc,
  screenshot,
  sleep,
  EXTENSION_ID,
  markFailed,
} from '../../spike/lib.mjs';

const ID = EXTENSION_ID;
const results = { cases: [], gallery: [] };
const lines = [];
for (let i = 0; i < 60; i++) lines.push(`export const value${i} = compute(${i}); // line ${i + 1}`);
lines[12] = '\t\tif (ready) { start(); } // tabs';
lines[20] = 'const 名前 = "日本語"; // CJK';
lines[25] = '// ' + 'a long line that wraps when word wrap is on '.repeat(4);
lines[32] = 'function folded() {';
lines[33] = '  const a = 1;';
lines[34] = '  const b = 2;';
lines[35] = '  return a + b;';
lines[36] = '}';
const CONTENT = lines.join('\n');

async function burstAt(vs, label, line, char, { column, settle = 900 } = {}) {
  await poc('cursor', { line, char, column });
  await sleep(settle);
  const before = (await poc('keyblaze', { id: ID })).totalBursts;
  await key(vs.cdp, 'z');
  for (let i = 0; i < 50 && (await poc('keyblaze', { id: ID })).totalBursts === before; i++)
    await sleep(20);
  await sleep(60);
  const stats = await poc('keyblaze', { id: ID });
  const layout = stats.lastBurst?.layouts?.[0];
  const m = await measureImages(vs.cdp);
  // The newest image is the one closest to the caret horizontally after using its own origin.
  const editor = m.editors.find((e) => e.focused) ?? m.editors[0];
  const caret = editor.cursor;
  const imgs = m.images.filter((img) => Math.abs(img.editorRect.x - editor.rect.x) < 1);
  let best;
  for (const img of imgs) {
    const ox = img.x + img.w / 2;
    const oy = img.y + (layout?.originY ?? img.h / 2);
    const d = {
      dx: +(ox - caret.x).toFixed(2),
      dy: +(oy - (caret.y + caret.h / 2)).toFixed(2),
      textShiftY: +img.textShiftY.toFixed(2),
      h: Math.round(img.h),
    };
    if (!best || Math.abs(d.dx) + Math.abs(d.dy) < Math.abs(best.dx) + Math.abs(best.dy)) best = d;
  }
  const row = {
    label,
    decision: stats.lastBurst?.decisions?.[0],
    anchorLine: layout?.line,
    caretLine: line,
    ...best,
  };
  results.cases.push(row);
  console.log(JSON.stringify(row));
  // Accuracy contract (docs/TESTING.md): the origin lands within 1 px of the caret line middle and
  // the decorated line's text does not move.
  const ok =
    best !== undefined &&
    Math.abs(best.dx) <= 1 &&
    Math.abs(best.dy) <= 1 &&
    Math.abs(best.textShiftY) <= 0.5;
  if (!ok) markFailed();
  console.log(`${ok ? 'PASS' : 'FAIL'}  placement: ${label}`);
  await key(vs.cdp, 'Backspace');
  await sleep(700);
  return row;
}

const vs = await launch({ extraExtensions: [ROOT] });
try {
  await poc('open', { content: CONTENT, language: 'typescript' });
  await sleep(1500);
  await poc('config', { section: 'keyblaze', key: 'performance.maxBurstsPerSecond', value: 30 });
  await poc('config', { section: 'keyblaze', key: 'particleLifetime', value: 2000 }); // long enough to measure
  await sleep(500);

  await burstAt(vs, 'middle of line', 8, 14);
  await burstAt(vs, 'end of line', 9, lines[9].length);
  await burstAt(vs, 'column 0', 10, 0);
  await burstAt(vs, 'after tabs', 12, 3);
  await burstAt(vs, 'after CJK (fallback)', 20, 12);
  await burstAt(vs, 'end of document (fallback)', 58, 6);

  await poc('config', { section: 'editor', key: 'wordWrap', value: 'on' });
  await sleep(600);
  await burstAt(vs, 'word wrap, long line below (fallback)', 23, 6);
  await burstAt(vs, 'word wrap, short lines', 40, 6);
  await poc('config', { section: 'editor', key: 'wordWrap', value: 'off' });

  await poc('cursor', { line: 32, char: 0 });
  await poc('exec', { command: 'editor.fold' });
  await sleep(400);
  await burstAt(vs, 'fold below (fallback)', 29, 8);
  await poc('exec', { command: 'editor.unfoldAll' });

  await poc('config', { section: 'editor', key: 'fontSize', value: 20 });
  await sleep(800);
  await burstAt(vs, 'fontSize 20', 8, 14);
  await poc('config', { section: 'editor', key: 'fontSize', value: 14 });
  await poc('config', { section: 'keyblaze', key: 'placement', value: 'cursorLine' });
  await sleep(500);
  await burstAt(vs, 'placement: cursorLine', 8, 14);
  await poc('config', { section: 'keyblaze', key: 'placement', value: 'auto' });

  // Split editors: the same document in a second group.
  await poc('exec', { command: 'workbench.action.splitEditorRight' });
  await sleep(1000);
  await burstAt(vs, 'split editor (group 2)', 15, 10, { column: 2 });
  await poc('exec', { command: 'workbench.action.closeEditorsInOtherGroups' });
  await poc('exec', { command: 'workbench.action.focusFirstEditorGroup' });

  // Gallery: every preset, live in the editor, ~130 ms after a real keystroke.
  await poc('config', { section: 'keyblaze', key: 'particleLifetime', value: undefined });
  for (const preset of [
    'classicBurst',
    'firestorm',
    'lightningStrike',
    'neonEnergy',
    'cosmicExplosion',
    'starfall',
    'minimalSparks',
    'rainbowRush',
    'cyberpunk',
    'cleanMode',
  ]) {
    await poc('config', { section: 'keyblaze', key: 'preset', value: preset });
    await poc('cursor', { line: 8, char: 14 });
    await sleep(700);
    await key(vs.cdp, 'z');
    await sleep(preset === 'cosmicExplosion' ? 260 : 130);
    const m = await measure(vs.cdp);
    const c = m.editors[0].cursor;
    const file = await screenshot(vs.cdp, `gallery-${preset}`, {
      x: Math.max(0, c.x - 160),
      y: c.y - 110,
      width: 320,
      height: 230,
    });
    results.gallery.push(path.basename(file));
    await key(vs.cdp, 'Backspace');
    await sleep(900);
  }
} catch (err) {
  results.error = String(err?.stack ?? err);
  console.error(err);
  markFailed();
} finally {
  fs.writeFileSync(path.join(RESULTS, 'verify-placement.json'), JSON.stringify(results, null, 2));
  await vs.close();
}
