// Performance of the REAL extension (bursts + combo badge + celebrations + cursor effects) in VS Code.
// Genuine keystrokes at fixed rates. A non-blocking in-page probe measures keydown → the first frame
// in which VS Code moved the caret, plus frame gaps and renderer load (CDP Performance metrics).
// Usage: npm run build && node test/visual/verify-performance.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, RESULTS, evaluate, key, launch, metrics, poc, sleep } from '../../spike/lib.mjs';

const ID = 'your-publisher-id.keyblaze';
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return s.length
    ? { p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +s[s.length - 1].toFixed(1) }
    : {};
};

const CONFIGS = [
  ['KeyBlaze disabled', { enabled: false }],
  ['Defaults (Classic Burst + combo badge)', {}],
  [
    'Defaults + cursor glow + Impact Pulse',
    { 'cursor.effect': 'glow', 'screenShake.enabled': true },
  ],
  ['Cosmic Explosion (heaviest preset)', { preset: 'cosmicExplosion' }],
  ['Cosmic Explosion + performance mode', { preset: 'cosmicExplosion', performanceMode: true }],
];

async function session(vs, intervalMs, chars) {
  await evaluate(
    vs.cdp,
    `(() => {
    const st = window.__kbp = { downs: [], lat: [], frames: [], on: true };
    st.onKey = (e) => { if (e.key.length === 1) st.downs.push(e.timeStamp); };
    window.addEventListener('keydown', st.onKey, true);
    let last = null;
    const f = (t) => {
      st.frames.push(t);
      const cur = document.querySelector('.monaco-editor.focused .cursors-layer .cursor');
      const v = cur ? cur.style.left + '|' + cur.style.top : '';
      if (v !== last) { if (last !== null && st.downs.length) st.lat.push(t - st.downs.shift()); last = v; }
      if (st.on) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  })()`,
  );
  const m0 = await metrics(vs.cdp);
  const t0 = Date.now();
  for (let i = 0; i < chars; i++) {
    await key(vs.cdp, 'abcdefghijklmnopqrstuvwxyz'[i % 26]);
    if (i % 50 === 49) await key(vs.cdp, 'Enter');
    const wait = t0 + (i + 1) * intervalMs - Date.now();
    if (wait > 0) await sleep(wait);
  }
  const seconds = (Date.now() - t0) / 1000;
  await sleep(400);
  const probe = await evaluate(
    vs.cdp,
    `(() => { const st = window.__kbp; st.on = false; window.removeEventListener('keydown', st.onKey, true); return { lat: st.lat, frames: st.frames }; })()`,
  );
  const m1 = await metrics(vs.cdp);
  const gaps = probe.frames.slice(1).map((t, i) => t - probe.frames[i]);
  return {
    targetCps: Math.round(1000 / intervalMs),
    achievedCps: +(chars / seconds).toFixed(1),
    keyToCaretMs: stats(probe.lat),
    framesOver50ms: gaps.filter((g) => g > 50).length,
    rendererBusyPct: +(((m1.TaskDuration - m0.TaskDuration) / seconds) * 100).toFixed(1),
    styleRecalcMsPerSec: +(
      ((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000) /
      seconds
    ).toFixed(1),
  };
}

const results = [];
const vs = await launch({ extraExtensions: [ROOT] });
try {
  await poc('keyblazeEnv', { id: ID, override: { windowFocused: true } });
  await poc('open', {
    content: Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join('\n'),
    language: 'plaintext',
  });
  await poc('cursor', { line: 20, char: 0 });
  await sleep(1000);
  for (const [cps, chars] of [
    [12, 120],
    [25, 200],
  ]) {
    for (const [label, values] of CONFIGS.filter(
      ([l]) => !process.env.ONLY || l.includes(process.env.ONLY),
    )) {
      await poc('exec', { command: 'keyblaze.resetSettings', args: [{ skipConfirmation: true }] });
      for (const [k, v] of Object.entries(values))
        await poc('config', { section: 'keyblaze', key: k, value: v });
      await poc('exec', { command: 'cursorBottom' });
      await key(vs.cdp, 'Enter');
      await sleep(1200);
      const r = { label, ...(await session(vs, 1000 / cps, chars)) };
      results.push(r);
      console.log(JSON.stringify(r));
    }
  }
} catch (err) {
  results.push({ error: String(err?.stack ?? err) });
  console.error(err);
} finally {
  fs.writeFileSync(path.join(RESULTS, 'verify-performance.json'), JSON.stringify(results, null, 2));
  await vs.close();
}
