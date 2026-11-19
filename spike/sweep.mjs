// Sweep raw margins to learn how the ::after image is positioned vertically.
import { launch, measure, offsets, poc, screenshot, sleep } from './lib.mjs';

const vs = await launch();
try {
  const content = Array.from({ length: 40 }, (_, i) => `line ${i + 1}: const value${i} = compute(${i});`).join('\n');
  await poc('open', { content, language: 'typescript' });
  const cases = [
    ['none', undefined],
    ['mb-20', '0 -32px -20px -32px'],
    ['mt-20', '-20px -32px 0 -32px'],
    ['mt-64', '-64px -32px 0 -32px'],
    ['mt-50', '-50px -32px 0 -32px'],
    ['mt-64 mb+10', '-64px -32px 10px -32px'],
  ];
  for (const [label, rawMargin] of cases) {
    await poc('cursor', { line: 5, char: 10 });
    await sleep(150);
    await poc('burst', { kind: 'crosshair', size: 64, autoClear: false, rawMargin: rawMargin ?? '' , margin: rawMargin ? 'old' : 'none' });
    await sleep(350);
    const o = offsets(await measure(vs.cdp))[0];
    const baselineEst = o.lineMid; // reference
    console.log(label.padEnd(12), `imgTop-lineTop=${(o.cy - o.h / 2 - (o.lineMid - o.lineHeight / 2)).toFixed(1)}`, `imgBottom-lineTop=${(o.cy + o.h / 2 - (o.lineMid - o.lineHeight / 2)).toFixed(1)}`, `textShift=${o.textShiftY}`, `dx=${o.dxFromCaret}`);
    if (label === 'mt-64') await screenshot(vs.cdp, 'sweep-mt64', { x: 50, y: 60, width: 500, height: 220 });
    await poc('clear');
  }
} finally {
  await vs.close();
}
