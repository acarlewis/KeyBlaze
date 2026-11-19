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

  // ── D2. Continuity with unique URIs ───────────────────────────────────────────────────────────
  {
    const run = async (label, anchor, typeOnLine) => {
      await poc('clear');
      await poc('cursor', { line: 20, char: 0 });
      await poc('exec', { command: 'cursorEnd' });
      await sleep(250);
      const caret = (await poc('state')).active.selections[0];
      const t0 = Date.now();
      await poc('burst', { kind: 'progress', durationMs: 3000, size: 120, anchor, line: caret.line, char: caret.char, autoClear: false });
      await poc('burst', { kind: 'progress', durationMs: 3000, size: 120, anchor, line: 30, char: 20, autoClear: false });
      await sleep(1000);
      if (typeOnLine) await typeText(vs.cdp, 'xyz', 60);
      await sleep(2000 - (Date.now() - t0));
      const at = Date.now() - t0;
      const [edited, control] = await bars(vs);
      await screenshot(vs.cdp, `D2-${label}`, { x: 50, y: 300, width: 700, height: 330 });
      if (typeOnLine) await poc('exec', { command: 'undo' });
      return { measuredAtMs: at, expectedFraction: +(at / 3000).toFixed(2), anchorLineBar: edited, controlBar: control };
    };
    results.continuity = {
      caret_typingOnAnchorLine: await run('caret-typing', 'caret', true),
      caret_noTyping: await run('caret-control', 'caret', false),
      below_typingOnCaretLine: await run('below-typing', 'below', true),
    };
    log('D2', JSON.stringify(results.continuity));
  }

  // ── D3. Do identical URIs share one animation timeline? ───────────────────────────────────────
  {
    await poc('clear');
    await poc('burst', { kind: 'progress', durationMs: 3000, size: 120, anchor: 'caret', line: 10, char: 20, autoClear: false, sameUri: true });
    await sleep(1500);
    await poc('burst', { kind: 'progress', durationMs: 3000, size: 120, anchor: 'caret', line: 25, char: 20, autoClear: false, sameUri: true });
    await poc('burst', { kind: 'progress', durationMs: 3000, size: 120, anchor: 'caret', line: 40, char: 20, autoClear: false });
    await sleep(500);
    const [first, sameUriLater, uniqueLater] = await bars(vs);
    await screenshot(vs.cdp, 'D3-shared-timeline', { x: 50, y: 150, width: 700, height: 700 });
    results.sharedTimeline = {
      firstAt2000ms: first,
      identicalUriAddedAt1500ms_measuredAt500ms: sameUriLater,
      uniqueUriAddedAt1500ms_measuredAt500ms: uniqueLater,
      interpretation: 'If identicalUri ≈ first, Chromium shares one SVG timeline per image URL.',
    };
    log('D3', JSON.stringify(results.sharedTimeline));
    await poc('clear');
  }

  // ── F2. Scroll away and back during an animation ──────────────────────────────────────────────
  {
    await poc('cursor', { line: 10, char: 0, reveal: 3 });
    await sleep(300);
    const ed = (await measure(vs.cdp)).editors[0];
    const cx = ed.rect.x + ed.rect.w / 2;
    const cy = ed.rect.y + ed.rect.h / 2;
    const t0 = Date.now();
    await poc('burst', { kind: 'progress', durationMs: 3000, size: 120, anchor: 'caret', line: 14, char: 20, autoClear: false });
    await sleep(700);
    await wheel(vs.cdp, cx, cy, 1500);
    await sleep(400);
    const whileAway = (await measure(vs.cdp)).images.length;
    await wheel(vs.cdp, cx, cy, -1500);
    await sleep(2000 - (Date.now() - t0));
    const at = Date.now() - t0;
    const [frac] = await bars(vs);
    results.scrollContinuity = { imagesWhileAway: whileAway, measuredAtMs: at, expectedIfContinuous: +(at / 3000).toFixed(2), bar: frac ?? null, expectedIfRestartedOnReturn: '≈0.27' };
    log('F2', JSON.stringify(results.scrollContinuity));
    await screenshot(vs.cdp, 'F2-scroll-back', { x: 50, y: 40, width: 700, height: 400 });
    await poc('clear');
  }

  // ── I2. Performance matrix ────────────────────────────────────────────────────────────────────
  {
    await poc('cursor', { line: 60, char: 0 });
    await poc('exec', { command: 'cursorEnd' });
    await sleep(300);
    const session = async (label, liveOverrides, intervalMs, chars) => {
      await poc('live', { on: !!liveOverrides, overrides: liveOverrides ?? {} });
      await poc('burstStats');
      await evaluate(vs.cdp, `(() => { window.__kb = { frames: [], on: true }; const f = (t) => { window.__kb.frames.push(t); if (window.__kb.on) requestAnimationFrame(f); }; requestAnimationFrame(f); })()`);
      const m0 = await metrics(vs.cdp);
      const caretLatency = [];
      const t0 = Date.now();
      for (let i = 0; i < chars; i++) {
        const ch = 'abcdefghijklmnopqrstuvwxyz'[i % 26];
        if (i % 8 === 4) {
          const q = `document.querySelector('.monaco-editor.focused .cursors-layer .cursor').getBoundingClientRect().x`;
          const x0 = await evaluate(vs.cdp, q);
          const s = performance.now();
          await key(vs.cdp, ch);
          for (let k = 0; k < 400; k++) if ((await evaluate(vs.cdp, q)) !== x0) break;
          caretLatency.push(performance.now() - s);
        } else {
          await key(vs.cdp, ch);
        }
        const wait = t0 + (i + 1) * intervalMs - Date.now();
        if (wait > 0) await sleep(wait);
        if (i % 60 === 59) await key(vs.cdp, 'Enter');
      }
      await sleep(300);
      const frames = await evaluate(vs.cdp, `(() => { window.__kb.on = false; return window.__kb.frames; })()`);
      const m1 = await metrics(vs.cdp);
      const gaps = frames.slice(1).map((t, i) => t - frames[i]);
      const { burstGenMs } = await poc('burstStats');
      const d = (k) => +(m1[k] - m0[k]).toFixed(3);
      const seconds = (Date.now() - t0) / 1000;
      return {
        label,
        cps: +(1000 / intervalMs).toFixed(0),
        bursts: burstGenMs.length,
        frameGapP50: stats(gaps).p50,
        frameGapP95: stats(gaps).p95,
        framesOver50ms: gaps.filter((g) => g > 50).length,
        caretLatencyMs: stats(caretLatency),
        styleRecalcMsPerSec: +((d('RecalcStyleDuration') * 1000) / seconds).toFixed(1),
        layoutMsPerSec: +((d('LayoutDuration') * 1000) / seconds).toFixed(1),
        rendererTaskMsPerSec: +((d('TaskDuration') * 1000) / seconds).toFixed(1),
        extHostBurstMs: stats(burstGenMs),
      };
    };
    const base = { kind: 'engine', anchor: 'caret', size: 160 };
    const matrix = [
      ['OFF', null, 33],
      ['KeyBlaze defaults (pool 16, cap 24/s, 14 particles, high)', { ...base, pool: 16, maxPerSec: 24, engine: {} }, 33],
      ['Proposed defaults (pool 8, cap 12/s, 14 particles, high)', { ...base, pool: 8, maxPerSec: 12, engine: {} }, 33],
      ['Performance mode (pool 8, cap 12/s, perf profile)', { ...base, pool: 8, maxPerSec: 12, engine: { performanceMode: true } }, 33],
      ['Worst case (pool 16, cap 24/s, 60 particles, high)', { ...base, pool: 16, maxPerSec: 24, engine: { particleCount: 60 } }, 33],
      ['Worst case capped (pool 8, cap 12/s, 60 particles, medium)', { ...base, pool: 8, maxPerSec: 12, engine: { particleCount: 60, 'performance.quality': 'medium' } }, 33],
    ];
    results.performance = [];
    for (const [label, overrides, interval] of matrix) {
      const r = await session(label, overrides, interval, 210);
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
  fs.writeFileSync(path.join(RESULTS, 'results2.json'), JSON.stringify(results, null, 2));
  await vs.close();
}
