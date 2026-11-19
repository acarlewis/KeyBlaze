// Spike run 2: animation-timeline behaviour (unique vs identical URIs), scroll continuity, and a
// performance matrix using KeyBlaze-style pooling and rate limits.
import fs from 'node:fs';
import path from 'node:path';
import { RESULTS, barFraction, evaluate, key, launch, measure, metrics, poc, screenshot, sleep, typeText, wheel } from './lib.mjs';

const results = { startedAt: new Date().toISOString() };
const log = (...a) => console.log(...a);
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return s.length ? { n: s.length, min: +s[0].toFixed(2), p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +s[s.length - 1].toFixed(2) } : { n: 0 };
};
const CODE = Array.from({ length: 120 }, (_, i) => `line ${i + 1}: let value${i} = compute(${i}); // filler text`).join('\n');

async function bars(vs) {
  const m = await measure(vs.cdp);
  const imgs = m.images.slice().sort((a, b) => a.y - b.y);
  const out = [];
  for (const img of imgs) out.push(+(await barFraction(vs.cdp, { x: img.x + 1, y: img.y + 4, width: img.w - 2, height: Math.min(30, img.h - 8) })).toFixed(2));
  return out;
}

const vs = await launch();
try {
  results.vscodeVersion = vs.version;
  await poc('open', { content: CODE, language: 'typescript' });
  await sleep(500);

  // ── I2. Performance matrix ────────────────────────────────────────────────────────────────────
  {
    await poc('cursor', { line: 60, char: 0 });
    await poc('exec', { command: 'cursorEnd' });
    await sleep(300);
    const session = async (label, liveOverrides, intervalMs, chars) => {
      await poc('live', { on: !!liveOverrides, overrides: liveOverrides ?? {} });
      await poc('burstStats');
      // Non-blocking probe: keydown timestamp → first animation frame in which VS Code moved the caret.
      await evaluate(vs.cdp, `(() => {
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
      })()`);
      const m0 = await metrics(vs.cdp);
      const t0 = Date.now();
      for (let i = 0; i < chars; i++) {
        await key(vs.cdp, 'abcdefghijklmnopqrstuvwxyz'[i % 26]);
        const wait = t0 + (i + 1) * intervalMs - Date.now();
        if (wait > 0) await sleep(wait);
      }
      const seconds = (Date.now() - t0) / 1000;
      await sleep(400);
      const probe = await evaluate(vs.cdp, `(() => { const st = window.__kbp; st.on = false; window.removeEventListener('keydown', st.onKey, true); return { lat: st.lat, frames: st.frames, pending: st.downs.length }; })()`);
      const m1 = await metrics(vs.cdp);
      const gaps = probe.frames.slice(1).map((t, i) => t - probe.frames[i]);
      const { burstGenMs } = await poc('burstStats');
      const d = (k) => m1[k] - m0[k];
      await key(vs.cdp, 'Enter');
      return {
        label,
        targetCps: +(1000 / intervalMs).toFixed(0),
        achievedCps: +(chars / seconds).toFixed(1),
        bursts: burstGenMs.length,
        keyToCaretFrameMs: stats(probe.lat),
        unmatchedKeys: probe.pending,
        frameGapMs: { p50: stats(gaps).p50, p95: stats(gaps).p95, max: stats(gaps).max },
        framesOver50ms: gaps.filter((g) => g > 50).length,
        rendererBusyPct: +((d('TaskDuration') / seconds) * 100).toFixed(1),
        styleRecalcMsPerSec: +((d('RecalcStyleDuration') * 1000) / seconds).toFixed(1),
        layoutMsPerSec: +((d('LayoutDuration') * 1000) / seconds).toFixed(1),
        extHostBurstMs: stats(burstGenMs),
      };
    };
    const base = { kind: 'engine', anchor: 'caret', size: 160 };
    const configs = [
      ['OFF', null],
      ['KeyBlaze current defaults (pool 16, ≤24/s, 14 particles, high)', { ...base, pool: 16, maxPerSec: 24, engine: {} }],
      ['Capped (pool 8, ≤12/s, 14 particles, high)', { ...base, pool: 8, maxPerSec: 12, engine: {} }],
      ['Performance mode (pool 8, ≤12/s, perf profile)', { ...base, pool: 8, maxPerSec: 12, engine: { performanceMode: true } }],
      ['Worst case (pool 16, ≤24/s, 60 particles, high)', { ...base, pool: 16, maxPerSec: 24, engine: { particleCount: 60 } }],
    ];
    const matrix = [];
    for (const interval of [83, 40]) for (const [label, o] of configs) matrix.push([label, o, interval]);
    results.performance = [];
    for (const [label, overrides, interval] of matrix) {
      const r = await session(label, overrides, interval, interval > 50 ? 120 : 200);
      results.performance.push(r);
      log('I2', JSON.stringify(r));
      await poc('live', { on: false });
      await sleep(1200);
    }
  }
} catch (err) {
  results.error = String(err && err.stack ? err.stack : err);
  console.error(err);
} finally {
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(RESULTS, 'results3.json'), JSON.stringify(results, null, 2));
  await vs.close();
}
