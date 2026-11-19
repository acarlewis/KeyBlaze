// KeyBlaze rendering spike: full scenario run against a real VS Code instance.
// Usage: node spike/run.mjs   (requires `npm run compile-tests` for the engine burst scenarios)
import fs from 'node:fs';
import path from 'node:path';
import { RESULTS, barFraction, evaluate, key, launch, measure, metrics, offsets, poc, screenshot, sleep, typeText, wheel } from './lib.mjs';

const results = { startedAt: new Date().toISOString() };
const log = (...a) => console.log(...a);
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return s.length ? { n: s.length, min: +s[0].toFixed(2), p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +s[s.length - 1].toFixed(2) } : { n: 0 };
};

const CODE = [
  'const alpha = computeSomething(42); // reference line',
  '\t\tindented(); // two tabs',
  'const 名前 = "日本語テキスト"; // CJK',
  'emoji 🎉🎉 here',
  '',
  'This is a deliberately long line that will wrap when word wrap is on, so that the caret sits on the second visual row of one logical line and we can check where the effect goes.',
  ...Array.from({ length: 80 }, (_, i) => `line ${i + 7}: let value${i} = compute(${i}); // filler text`),
].join('\n');

async function single(vs, p) {
  await poc('clear');
  if (p.cursor !== false) await poc('cursor', { line: p.line, char: p.char, column: p.column });
  await sleep(150);
  const info = await poc('burst', { kind: 'crosshair', size: 96, autoClear: false, ...p });
  await sleep(250);
  const m = await measure(vs.cdp);
  return { info, off: offsets(m, info.originY) };
}

const vs = await launch();
try {
  results.vscodeVersion = vs.version;
  log('VS Code', vs.version);

  // ── A. Cursor detection through the official API ─────────────────────────────────────────────
  {
    await poc('open', { content: CODE, language: 'typescript' });
    await poc('cursor', { line: 0, char: 5 });
    await sleep(300);
    await poc('events', { clear: true });
    const sent = [];
    for (const ch of 'abcdefghij') {
      sent.push(Date.now());
      await key(vs.cdp, ch);
      await sleep(80);
    }
    for (const k of ['ArrowLeft', 'ArrowLeft', 'ArrowDown', 'End']) {
      sent.push(Date.now());
      await key(vs.cdp, k);
      await sleep(80);
    }
    await sleep(300);
    const ev = await poc('events', { clear: true });
    const changes = ev.filter((e) => e.kind === 'change');
    const selections = ev.filter((e) => e.kind === 'selection');
    const state = await poc('state');
    results.cursorApi = {
      keystrokes: 10,
      changeEvents: changes.length,
      changeLatencyMs: stats(changes.slice(0, 10).map((e, i) => e.t - sent[i])),
      selectionEvents: selections.length,
      selectionKinds: [...new Set(selections.map((e) => e.data.kind))],
      lastSelectionsAfterTyping: selections.filter((e) => e.data.line === 0).slice(-1)[0]?.data,
      finalSelection: state.active.selections,
      visibleRanges: state.active.visibleRanges,
      note: 'Selection gives logical line/character only. There is no API for pixel coordinates.',
    };
    log('A cursor', JSON.stringify(results.cursorApi));
    await poc('exec', { command: 'workbench.action.revertAndCloseActiveEditor' });
  }

  // ── B. Precision at different caret positions, caret- vs below-anchored ───────────────────────
  {
    await poc('open', { content: CODE, language: 'typescript' });
    const cases = [
      { label: 'middleOfLine', line: 0, char: 6 },
      { label: 'endOfLine', line: 0, char: 52 },
      { label: 'column0', line: 0, char: 0 },
      { label: 'emptyLine', line: 4, char: 0 },
      { label: 'afterTwoTabs', line: 1, char: 2 },
      { label: 'afterCJK', line: 2, char: 8 },
      { label: 'afterEmoji', line: 3, char: 10 },
      { label: 'deepInFile', line: 60, char: 12 },
    ];
    results.precision = {};
    for (const anchor of ['caret', 'below']) {
      for (const c of cases) {
        const { info, off } = await single(vs, { ...c, anchor });
        results.precision[`${anchor}:${c.label}`] = { ...off[0], anchorLine: info.anchorLine, imageH: info.height };
      }
    }
    // Word wrap: caret on the second visual row of a wrapped line.
    await poc('config', { section: 'editor', key: 'wordWrap', value: 'on' });
    await sleep(500);
    for (const anchor of ['caret', 'below']) {
      const { info, off } = await single(vs, { label: 'wrapped', line: 5, char: 150, anchor });
      results.precision[`${anchor}:wrappedSecondRow`] = { ...off[0], anchorLine: info.anchorLine };
    }
    await screenshot(vs.cdp, 'B-wrapped-below');
    await poc('config', { section: 'editor', key: 'wordWrap', value: 'off' });
    await sleep(400);
    // Visual samples.
    await single(vs, { line: 0, char: 6, anchor: 'caret' });
    await screenshot(vs.cdp, 'B-caret-anchor', { x: 50, y: 40, width: 560, height: 200 });
    await single(vs, { line: 0, char: 6, anchor: 'below' });
    await screenshot(vs.cdp, 'B-below-anchor', { x: 50, y: 40, width: 560, height: 200 });
    log('B precision', JSON.stringify(results.precision, null, 0));
    await poc('clear');
  }

  // ── C. Following the caret while typing (genuine keystrokes, live bursts) ─────────────────────
  {
    await poc('cursor', { line: 10, char: 0 });
    await poc('exec', { command: 'cursorEnd' });
    await sleep(200);
    await poc('live', { on: true, overrides: { kind: 'crosshair', anchor: 'caret', size: 48 } });
    const follow = [];
    const appearMs = [];
    for (const ch of 'followme') {
      const before = await evaluate(vs.cdp, `document.querySelectorAll('.view-line span').length`);
      const t0 = Date.now();
      await key(vs.cdp, ch);
      // Wait until the new decoration is in the DOM.
      for (let i = 0; i < 100; i++) {
        const n = await evaluate(vs.cdp, `document.querySelectorAll('.view-line span').length`);
        if (n !== before) break;
        await sleep(2);
      }
      appearMs.push(Date.now() - t0);
      await sleep(60);
      const m = await measure(vs.cdp);
      // Newest image = the one closest to the caret horizontally.
      const offs = offsets(m, 48 / 2).sort((a, b) => Math.abs(a.dx) - Math.abs(b.dx));
      follow.push(offs[0]);
    }
    await poc('live', { on: false });
    results.typingFollow = {
      newestBurstOffsets: follow.map((o) => ({ dx: o.dx, dy: o.dy, textShiftY: o.textShiftY })),
      keystrokeToDecorationInDomMs: stats(appearMs),
      note: 'Includes CDP polling overhead (~2–5 ms).',
    };
    log('C follow', JSON.stringify(results.typingFollow));
    await screenshot(vs.cdp, 'C-typing-trail', { x: 50, y: 160, width: 700, height: 160 });
    await poc('clear');
  }

  // ── D. Animation continuity when the anchor line is edited ────────────────────────────────────
  {
    const run = async (label, anchor, typeOnLine) => {
      await poc('clear');
      await poc('cursor', { line: 20, char: 0 });
      await poc('exec', { command: 'cursorEnd' });
      await sleep(250);
      const st = await poc('state');
      const caret = st.active.selections[0];
      await poc('burst', { kind: 'progress', durationMs: 3000, size: 120, anchor, line: caret.line, char: caret.char, autoClear: false });
      await poc('burst', { kind: 'progress', durationMs: 3000, size: 120, anchor, line: 30, char: 20, autoClear: false, color: '#00c8ff' });
      await sleep(1000);
      if (typeOnLine) await typeText(vs.cdp, 'xyz', 60);
      else await sleep(180);
      await sleep(800);
      const m = await measure(vs.cdp);
      const imgs = m.images.slice().sort((a, b) => a.y - b.y);
      const fr = [];
      for (const img of imgs) fr.push(+(await barFraction(vs.cdp, { x: img.x + 1, y: img.y + 4, width: img.w - 2, height: Math.min(30, img.h - 8) })).toFixed(2));
      await screenshot(vs.cdp, `D-${label}`, { x: 50, y: 300, width: 700, height: 330 });
      return { editedLineBarFraction: fr[0], controlBarFraction: fr[1], expectedIfContinuous: '≈0.66 at t≈2.0 s', expectedIfRestartedAtType: '≈0.27' };
    };
    results.animationContinuity = {
      caretAnchor_typingOnAnchorLine: await run('caret-typing', 'caret', true),
      caretAnchor_noTyping: await run('caret-control', 'caret', false),
      belowAnchor_typingOnCaretLine: await run('below-typing', 'below', true),
    };
    log('D continuity', JSON.stringify(results.animationContinuity));
    await poc('clear');
    await poc('exec', { command: 'undo' });
  }

  // ── E. Split editors and multiple groups ──────────────────────────────────────────────────────
  {
    await poc('open', { content: 'second document\n'.repeat(40), language: 'plaintext', column: 2 });
    await poc('open', { content: CODE, language: 'typescript', column: 3 });
    await sleep(600);
    await poc('clear');
    const placed = [];
    for (const [column, line, char] of [[1, 6, 10], [2, 8, 7], [3, 12, 15]]) {
      await poc('cursor', { column, line, char });
      const info = await poc('burst', { kind: 'crosshair', size: 96, anchor: 'caret', column, line, char, autoClear: false });
      placed.push(info);
    }
    await poc('focus', { column: 2 });
    await sleep(400);
    const m = await measure(vs.cdp);
    results.splitEditors = {
      editorsFound: m.editors.length,
      caretsFound: m.editors.filter((e) => e.cursor).length,
      offsets: offsets(m, placed[0].originY),
    };
    log('E split', JSON.stringify(results.splitEditors));
    await screenshot(vs.cdp, 'E-split-groups');
    await poc('clear');
    await poc('exec', { command: 'workbench.action.closeEditorsInOtherGroups' });
    await sleep(500);
  }

  // ── F. Scrolling ──────────────────────────────────────────────────────────────────────────────
  {
    await poc('exec', { command: 'workbench.action.focusFirstEditorGroup' });
    await poc('clear');
    await poc('cursor', { line: 15, char: 10, reveal: 3 /* AtTop */ });
    await sleep(300);
    const info = await poc('burst', { kind: 'crosshair', size: 96, anchor: 'caret', line: 15, char: 10, autoClear: false });
    await sleep(250);
    const m0 = await measure(vs.cdp);
    const ed = m0.editors.find((e) => e.focused) ?? m0.editors[0];
    const cx = ed.rect.x + ed.rect.w / 2;
    const cy = ed.rect.y + ed.rect.h / 2;
    const before = offsets(m0, info.originY)[0];
    await wheel(vs.cdp, cx, cy, 57);
    await sleep(400);
    const afterSmall = offsets(await measure(vs.cdp), info.originY)[0];
    await wheel(vs.cdp, cx, cy, 2000);
    await sleep(400);
    const offscreen = (await measure(vs.cdp)).images.length;
    await wheel(vs.cdp, cx, cy, -2000);
    await sleep(500);
    const back = offsets(await measure(vs.cdp), info.originY)[0];

    // Does scrolling the anchor line out of view and back restart its animation?
    await poc('clear');
    await poc('burst', { kind: 'progress', durationMs: 3000, size: 120, anchor: 'caret', line: 10, char: 20, autoClear: false });
    await sleep(800);
    await wheel(vs.cdp, cx, cy, 2000);
    await sleep(700);
    await wheel(vs.cdp, cx, cy, -2000);
    await sleep(500);
    const img = (await measure(vs.cdp)).images[0];
    const frac = img ? +(await barFraction(vs.cdp, { x: img.x + 1, y: img.y + 4, width: img.w - 2, height: Math.min(30, img.h - 8) })).toFixed(2) : null;
    results.scrolling = {
      beforeScroll: before,
      afterScroll3Lines: afterSmall,
      imagesWhileAnchorOffscreen: offscreen,
      afterScrollingBack: back,
      progressAfterScrollAwayAndBack: { fraction: frac, expectedIfContinuous: '≈0.67 at t≈2.0 s', expectedIfRestartedOnReturn: '≈0.17' },
    };
    log('F scroll', JSON.stringify(results.scrolling));
    await poc('clear');
  }

  // ── G. Zoom levels, font size and line height ─────────────────────────────────────────────────
  {
    const variants = [
      ['default', async () => {}, async () => {}],
      ['windowZoom+1', () => poc('config', { section: 'window', key: 'zoomLevel', value: 1 }), () => poc('config', { section: 'window', key: 'zoomLevel', value: 0 })],
      ['windowZoom-1', () => poc('config', { section: 'window', key: 'zoomLevel', value: -1 }), () => poc('config', { section: 'window', key: 'zoomLevel', value: 0 })],
      ['fontSize20', () => poc('config', { section: 'editor', key: 'fontSize', value: 20 }), () => poc('config', { section: 'editor', key: 'fontSize', value: 14 })],
      ['lineHeight30', () => poc('config', { section: 'editor', key: 'lineHeight', value: 30 }), () => poc('config', { section: 'editor', key: 'lineHeight', value: 0 })],
      ['editorFontZoomIn x2', async () => { await poc('exec', { command: 'editor.action.fontZoomIn' }); await poc('exec', { command: 'editor.action.fontZoomIn' }); }, () => poc('exec', { command: 'editor.action.fontZoomReset' })],
    ];
    results.zoom = {};
    for (const [label, apply, undo] of variants) {
      await apply();
      await sleep(900);
      for (const anchor of ['caret', 'below']) {
        const { info, off } = await single(vs, { line: 8, char: 10, anchor });
        const ed = (await measure(vs.cdp)).editors.find((e) => e.cursor);
        results.zoom[`${label}:${anchor}`] = { ...off[0], renderedFontSize: ed?.fontSize, renderedLineHeight: ed?.lineHeight, assumedLineHeight: info.lineHeight };
      }
      if (label === 'editorFontZoomIn x2') await screenshot(vs.cdp, 'G-font-zoom-below', { x: 50, y: 40, width: 560, height: 300 });
      await undo();
      await sleep(700);
    }
    log('G zoom', JSON.stringify(results.zoom));
    await poc('clear');
  }

  // ── H. Webview approach ───────────────────────────────────────────────────────────────────────
  {
    await poc('webview');
    await sleep(1500);
    const { rtts } = await poc('webviewPing', { count: 30, interval: 40 });
    await screenshot(vs.cdp, 'H-webview-beside');
    results.webview = {
      postMessageRoundTripMs: stats(rtts),
      canOverlayTextEditor: false,
      reason: 'WebviewPanel is placed only by ViewColumn (it becomes an editor tab/group). WebviewView lives in the sidebar or panel. No API positions a webview over, or transparently on top of, a text editor, and no API gives cursor pixel coordinates to map into one.',
    };
    log('H webview', JSON.stringify(results.webview));
    await poc('webviewClose');
    await sleep(500);
  }

  // ── I. Performance of continuous effects (real engine bursts) ─────────────────────────────────
  {
    await poc('exec', { command: 'workbench.action.focusFirstEditorGroup' });
    await poc('cursor', { line: 40, char: 0 });
    await poc('exec', { command: 'cursorEnd' });
    await sleep(300);
    const session = async (label, live, intervalMs, chars, engineOverrides) => {
      await poc('live', { on: live, overrides: { kind: 'engine', anchor: 'caret', size: 160, engine: engineOverrides } });
      await poc('burstStats');
      await evaluate(vs.cdp, `(() => { window.__kb = { frames: [], on: true }; const f = (t) => { window.__kb.frames.push(t); if (window.__kb.on) requestAnimationFrame(f); }; requestAnimationFrame(f); })()`);
      const m0 = await metrics(vs.cdp);
      const caretLatency = [];
      const t0 = Date.now();
      for (let i = 0; i < chars; i++) {
        const ch = 'abcdefghijklmnopqrstuvwxyz'[i % 26];
        if (i % 10 === 5) {
          const x0 = await evaluate(vs.cdp, `document.querySelector('.monaco-editor.focused .cursors-layer .cursor').getBoundingClientRect().x`);
          const s = performance.now();
          await key(vs.cdp, ch);
          for (let k = 0; k < 200; k++) {
            const x = await evaluate(vs.cdp, `document.querySelector('.monaco-editor.focused .cursors-layer .cursor').getBoundingClientRect().x`);
            if (x !== x0) break;
          }
          caretLatency.push(performance.now() - s);
        } else {
          await key(vs.cdp, ch);
        }
        const target = t0 + (i + 1) * intervalMs;
        const wait = target - Date.now();
        if (wait > 0) await sleep(wait);
        if (i % 60 === 59) await key(vs.cdp, 'Enter');
      }
      await sleep(300);
      const frames = await evaluate(vs.cdp, `(() => { window.__kb.on = false; return window.__kb.frames; })()`);
      const m1 = await metrics(vs.cdp);
      const gaps = frames.slice(1).map((t, i) => t - frames[i]);
      const seconds = (frames[frames.length - 1] - frames[0]) / 1000;
      const { burstGenMs } = await poc('burstStats');
      const d = (k) => +(m1[k] - m0[k]).toFixed(3);
      return {
        label,
        charsTyped: chars,
        typingRateCps: +(1000 / intervalMs).toFixed(1),
        fps: +(frames.length / seconds).toFixed(1),
        frameGapMs: stats(gaps),
        framesOver50ms: gaps.filter((g) => g > 50).length,
        keystrokeToCaretMovedMs: stats(caretLatency),
        renderer: {
          layoutCount: d('LayoutCount'),
          recalcStyleCount: d('RecalcStyleCount'),
          layoutSeconds: d('LayoutDuration'),
          recalcStyleSeconds: d('RecalcStyleDuration'),
          scriptSeconds: d('ScriptDuration'),
          taskSeconds: d('TaskDuration'),
          jsHeapDeltaMB: +((m1.JSHeapUsedSize - m0.JSHeapUsedSize) / 1048576).toFixed(2),
          domNodesDelta: d('Nodes'),
        },
        extensionHostBurstMs: stats(burstGenMs),
      };
    };
    results.performance = [];
    results.performance.push(await session('effects OFF @15cps', false, 66, 180));
    await poc('clear');
    results.performance.push(await session('effects ON  @15cps (default burst)', true, 66, 180, {}));
    await sleep(1500);
    await poc('clear');
    results.performance.push(await session('effects ON  @30cps stress (60 particles, high quality)', true, 33, 240, { particleCount: 60 }));
    await screenshot(vs.cdp, 'I-engine-bursts-live', { x: 50, y: 300, width: 900, height: 400 });
    await poc('live', { on: false });
    for (const r of results.performance) log('I perf', JSON.stringify(r));
  }
} catch (err) {
  results.error = String(err && err.stack ? err.stack : err);
  console.error(err);
} finally {
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(RESULTS, 'results.json'), JSON.stringify(results, null, 2));
  await vs.close();
}
