// Before/after evidence: Phase 2 margin formula (shifts text) vs zero-height caret anchoring.
import { launch, poc, screenshot, sleep } from './lib.mjs';

const vs = await launch();
try {
  const content = Array.from({ length: 30 }, (_, i) => `line ${i + 1}: const value${i} = compute(${i});`).join('\n');
  await poc('open', { content, language: 'typescript' });
  await poc('cursor', { line: 5, char: 10 });
  await sleep(500);
  // Phase 2 formula: margin "0 -w/2 -(h/2 - 0.22·lh) -w/2" on a 64×64 image.
  await poc('burst', { kind: 'crosshair', size: 64, autoClear: false, rawMargin: '0 -32px -27.82px -32px', sameUri: true });
  await sleep(400);
  await screenshot(vs.cdp, 'evidence-phase2-formula-shifts-text', { x: 50, y: 60, width: 520, height: 220 });
  await poc('clear');
  await poc('burst', { kind: 'crosshair', size: 64, autoClear: false, anchor: 'caret' });
  await sleep(400);
  await screenshot(vs.cdp, 'evidence-zero-height-caret-anchor', { x: 50, y: 60, width: 520, height: 220 });
  await poc('clear');
  await poc('burst', { kind: 'crosshair', size: 96, autoClear: false, anchor: 'below' });
  await sleep(400);
  await screenshot(vs.cdp, 'evidence-below-anchor-full-circle', { x: 50, y: 60, width: 520, height: 220 });
} finally {
  await vs.close();
}
