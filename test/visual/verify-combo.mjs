// Visual verification of the combo badge, Impact Pulse and cursor auras in a real VS Code.
// Usage: npm run build && npm run compile-tests && node test/visual/verify-combo.mjs
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  RESULTS,
  evaluate,
  key,
  launch,
  measure,
  poc,
  screenshot,
  sleep,
  EXTENSION_ID,
} from '../../spike/lib.mjs';

const ID = EXTENSION_ID;
const out = { checks: [] };
const lines = Array.from(
  { length: 60 },
  (_, i) => `export const value${i} = compute(${i}); // line ${i + 1}`,
);
lines[10] = 'const shortLine = 1;';

const check = (name, ok, detail) => {
  out.checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};

/** Text end of a line (px) via a DOM range over its text. */
async function lineTextRight(vs, lineIndex) {
  return evaluate(
    vs.cdp,
    `(() => {
    const ed = document.querySelector('.monaco-editor.focused');
    const top = ed.querySelector('.view-lines .view-line') && [...ed.querySelectorAll('.view-lines .view-line')];
    const line = top.find((l) => l.textContent.split(String.fromCharCode(160)).join(" ").startsWith(${JSON.stringify(lines[10].slice(0, 12))}));
    const r = document.createRange();
    r.selectNodeContents(line.querySelector('span'));
    const rects = [...r.getClientRects()];
    return { right: Math.max(...rects.map((x) => x.right)), top: line.getBoundingClientRect().top, height: line.getBoundingClientRect().height };
  })()`,
  );
}

const vs = await launch({ extraExtensions: [ROOT] });
try {
  await poc('open', { content: lines.join('\n'), language: 'typescript' });
  await sleep(1200);
  for (const [k, v] of [
    ['combo.milestones', [5, 10]],
    ['combo.resetTime', 4000],
    ['screenShake.enabled', true],
    ['screenShake.intensity', 6],
    ['screenShake.duration', 400],
    ['performance.maxBurstsPerSecond', 4],
  ]) {
    await poc('config', { section: 'keyblaze', key: k, value: v });
  }
  await poc('cursor', { line: 10, char: lines[10].length });
  await sleep(600);

  // Type 9 characters → badge visible (threshold 5), no milestone yet beyond 5.
  for (const ch of 'abcdefghi') {
    await key(vs.cdp, ch);
    await sleep(90);
  }
  await sleep(250);
  let m = await measure(vs.cdp);
  const text = await lineTextRight(vs, 10);
  const badge = m.images.filter((i) => i.w > i.h * 1.5).sort((a, b) => b.x - a.x)[0];
  check('badge rendered', !!badge, { count: (await poc('keyblaze', { id: ID })).combo.count });
  if (badge) {
    // The caret is at the end of the typed text, so its x is where the code ends.
    const codeEnd = (m.editors.find((e) => e.focused) ?? m.editors[0]).cursor.x;
    check('badge is to the right of the code (never over it)', badge.x >= codeEnd + 4, {
      badgeLeft: +badge.x.toFixed(1),
      codeEnd: +codeEnd.toFixed(1),
    });
    check('badge causes no text shift', Math.abs(badge.textShiftY) < 0.5, {
      textShiftY: +badge.textShiftY.toFixed(3),
    });
    const pillBottom = badge.y + badge.h;
    check(
      'pill bottom stays within its own line',
      pillBottom <= text.top + text.height + 0.5 && pillBottom >= text.top,
      { pillBottom: +pillBottom.toFixed(1), lineTop: text.top, lineBottom: text.top + text.height },
    );
  }
  await screenshot(vs.cdp, 'combo-badge', { x: 50, y: text.top - 70, width: 560, height: 150 });

  // 10th keystroke → milestone: celebration burst, badge pop + shake, line flash.
  await key(vs.cdp, 'j');
  await sleep(30);
  await screenshot(vs.cdp, 'combo-milestone-70ms', {
    x: 50,
    y: text.top - 110,
    width: 560,
    height: 230,
  });
  const flash = await evaluate(
    vs.cdp,
    `[...document.querySelectorAll('.monaco-editor.focused .view-overlays div')].some((d) => d.className.includes('ced') && getComputedStyle(d).backgroundColor.startsWith('rgba') && getComputedStyle(d).backgroundColor !== 'rgba(0, 0, 0, 0)')`,
  );
  check('line flash visible during the milestone', flash, {});
  await sleep(160);
  await screenshot(vs.cdp, 'combo-milestone-230ms', {
    x: 50,
    y: text.top - 110,
    width: 560,
    height: 230,
  });
  const stats = await poc('keyblaze', { id: ID });
  check('milestone celebrated', stats.celebrations >= 2, {
    celebrations: stats.celebrations,
    count: stats.combo.count,
  });

  // Combo reset clears the badge.
  await sleep(4300);
  m = await measure(vs.cdp);
  check('badge cleared after the combo resets', !m.images.some((i) => i.w > i.h * 1.5), {
    images: m.images.length,
  });

  // Cursor auras: centred on the caret.
  for (const effect of ['glow', 'ring']) {
    await poc('config', { section: 'keyblaze', key: 'cursor.effect', value: effect });
    await poc('cursor', { line: 20, char: 14 });
    await sleep(150);
    await poc('exec', { command: 'cursorRight' });
    await sleep(300);
    m = await measure(vs.cdp);
    const ed = m.editors.find((e) => e.focused) ?? m.editors[0];
    const aura = m.images.find((i) => Math.abs(i.w - i.h) > 0 || i.w < 80);
    const dx = aura ? +(aura.x + aura.w / 2 - ed.cursor.x).toFixed(2) : null;
    check(`${effect} aura centred horizontally on the caret`, aura && Math.abs(dx) < 1, {
      dx,
      textShiftY: aura?.textShiftY,
    });
    check(`${effect} aura causes no text shift`, aura && Math.abs(aura.textShiftY) < 0.5, {});
    await screenshot(vs.cdp, `cursor-${effect}`, {
      x: Math.max(0, ed.cursor.x - 150),
      y: ed.cursor.y - 60,
      width: 300,
      height: 140,
    });
  }
} catch (err) {
  out.error = String(err?.stack ?? err);
  console.error(err);
} finally {
  fs.writeFileSync(path.join(RESULTS, 'verify-combo.json'), JSON.stringify(out, null, 2));
  await vs.close();
}
