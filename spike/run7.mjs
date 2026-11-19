// Spike run 7: (1) does a reused image URI replay its animation after it was removed?
// (2) renderer style-recalc cost: per-burst unique instance images vs toggling fixed-image types.
import fs from 'node:fs';
import path from 'node:path';
import { RESULTS, barFraction, launch, measure, metrics, poc, sleep } from './lib.mjs';

const results = {};
const CODE = Array.from({ length: 120 }, (_, i) => `line ${i + 1}: let value${i} = compute(${i}); // filler`).join('\n');
const bar = async (vs) => {
  const img = (await measure(vs.cdp)).images[0];
  return img ? +(await barFraction(vs.cdp, { x: img.x + 1, y: img.y + 4, width: img.w - 2, height: Math.min(30, img.h - 8) })).toFixed(2) : null;
};

const vs = await launch();
try {
  await poc('open', { content: CODE, language: 'plaintext' });
  await poc('cursor', { line: 5, char: 0, reveal: 3 });
  await sleep(500);

  // (1) Replay after removal.
  await poc('fixedType', { id: 'replay', durationMs: 1500, size: 120 });
  await poc('fixedSet', { id: 'replay', line: 10, char: 20 });
  await sleep(500);
  const firstAt500 = await bar(vs);
  await sleep(1500);
  await poc('fixedClear', { id: 'replay' });
  const replays = [];
  for (const gap of [100, 1000, 3000]) {
    await sleep(gap);
    await poc('fixedSet', { id: 'replay', line: 12, char: 20 });
    await sleep(500);
    replays.push({ removedForMs: gap, barAt500ms: await bar(vs) });
    await sleep(1500);
    await poc('fixedClear', { id: 'replay' });
  }
  results.replay = { firstShowAt500ms: firstAt500, reShows: replays, expectedIfReplays: '≈0.33', expectedIfFrozenAtEnd: '1.0' };
  console.log('replay', JSON.stringify(results.replay));

  // (2) Style-recalc cost per burst: 40 bursts, 250 ms apart, each strategy.
  const cost = async (label, fire) => {
    const m0 = await metrics(vs.cdp);
    for (let i = 0; i < 40; i++) {
      await fire(i);
      await sleep(250);
    }
    await sleep(800);
    const m1 = await metrics(vs.cdp);
    return {
      label,
      styleRecalcMsPerBurst: +(((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000) / 40).toFixed(2),
      layoutMsPerBurst: +(((m1.LayoutDuration - m0.LayoutDuration) * 1000) / 40).toFixed(2),
      recalcCountPerBurst: +((m1.RecalcStyleCount - m0.RecalcStyleCount) / 40).toFixed(1),
      rendererTaskMsPerBurst: +(((m1.TaskDuration - m0.TaskDuration) * 1000) / 40).toFixed(2),
    };
  };
  await poc('clear');
  const idle = await cost('idle (no bursts) baseline', async () => {});
  const unique = await cost('unique image per burst (instance renderOptions, current approach)', async (i) => {
    await poc('burst', { kind: 'engine', anchor: 'caret', size: 160, line: 20 + (i % 30), char: 15, seed: 1000 + i });
  });
  await poc('clear');
  for (let k = 0; k < 8; k++) await poc('fixedType', { id: `pool${k}`, kind: 'engine', seed: 77 + k, size: 160 });
  const fixed = await cost('fixed-image types toggled (8 pre-built variants)', async (i) => {
    const id = `pool${i % 8}`;
    await poc('fixedClear', { id });
    await poc('fixedSet', { id, line: 20 + (i % 30), char: 15 });
  });
  results.styleCost = [idle, unique, fixed];
  for (const r of results.styleCost) console.log('cost', JSON.stringify(r));
} catch (err) {
  results.error = String(err && err.stack ? err.stack : err);
  console.error(err);
} finally {
  fs.writeFileSync(path.join(RESULTS, 'results7.json'), JSON.stringify(results, null, 2));
  await vs.close();
}
