// Spike run 4: is there accumulating renderer cost after many animated-SVG bursts?
// Measures idle renderer load, CSS rule counts and DOM size before/after typing sessions.
import fs from 'node:fs';
import path from 'node:path';
import { RESULTS, evaluate, key, launch, metrics, poc, sleep } from './lib.mjs';

const results = { startedAt: new Date().toISOString(), steps: [] };
const CODE = Array.from({ length: 200 }, (_, i) => `line ${i + 1}: let value${i} = compute(${i});`).join('\n');

async function idle(vs, label, ms = 3000) {
  const m0 = await metrics(vs.cdp);
  const f = await evaluate(vs.cdp, `new Promise((res) => { const fr = []; const s = performance.now(); const f = (t) => { fr.push(t); if (t - s < ${ms}) requestAnimationFrame(f); else res(fr.length); }; requestAnimationFrame(f); })`);
  const m1 = await metrics(vs.cdp);
  const dom = await evaluate(vs.cdp, `(() => {
    let rules = 0, kbRules = 0;
    for (const sh of document.styleSheets) { try { for (const r of sh.cssRules) { rules++; if (r.cssText.includes('data:image/svg')) kbRules++; } } catch {} }
    return { cssRules: rules, cssRulesWithSvg: kbRules, nodes: document.getElementsByTagName('*').length, images: [...document.querySelectorAll('.view-line span')].filter((s) => getComputedStyle(s, '::after').content.includes('url(')).length };
  })()`);
  const step = {
    label,
    idleRendererBusyPct: +(((m1.TaskDuration - m0.TaskDuration) / (ms / 1000)) * 100).toFixed(1),
    idleFps: +(f / (ms / 1000)).toFixed(0),
    jsHeapMB: +(m1.JSHeapUsedSize / 1048576).toFixed(1),
    ...dom,
  };
  results.steps.push(step);
  console.log(JSON.stringify(step));
}

async function typing(vs, label, live, cps, chars) {
  await poc('live', { on: !!live, overrides: live ?? {} });
  const t0 = Date.now();
  for (let i = 0; i < chars; i++) {
    await key(vs.cdp, 'abcdefghijklmnopqrstuvwxyz'[i % 26]);
    const wait = t0 + ((i + 1) * 1000) / cps - Date.now();
    if (wait > 0) await sleep(wait);
    if (i % 50 === 49) await key(vs.cdp, 'Enter');
  }
  const achieved = +(chars / ((Date.now() - t0) / 1000)).toFixed(1);
  await poc('live', { on: false });
  results.steps.push({ label, typed: chars, targetCps: cps, achievedCps: achieved });
  console.log(label, 'achieved', achieved, 'cps');
}

const vs = await launch();
try {
  await poc('open', { content: CODE, language: 'typescript' });
  await poc('cursor', { line: 100, char: 0 });
  await poc('exec', { command: 'cursorEnd' });
  await sleep(1000);
  const fx = { kind: 'engine', anchor: 'caret', size: 160, pool: 16, maxPerSec: 24, engine: {} };
  await idle(vs, 'baseline idle');
  await typing(vs, 'effects ON 12cps x150', fx, 12, 150);
  await idle(vs, 'idle after 150 bursts');
  await typing(vs, 'effects ON 25cps x200', fx, 25, 200);
  await idle(vs, 'idle after +200 bursts');
  await idle(vs, 'idle again (+3s)');
  await poc('exec', { command: 'workbench.action.revertAndCloseActiveEditor' });
  await sleep(1500);
  await idle(vs, 'idle after closing the editor');
  await poc('open', { content: CODE, language: 'typescript' });
  await poc('cursor', { line: 100, char: 0 });
  await sleep(800);
  await typing(vs, 'effects OFF 25cps x200 (new editor)', null, 25, 200);
  await idle(vs, 'idle after OFF session');
} catch (err) {
  results.error = String(err && err.stack ? err.stack : err);
  console.error(err);
} finally {
  fs.writeFileSync(path.join(RESULTS, 'results4.json'), JSON.stringify(results, null, 2));
  await vs.close();
}
