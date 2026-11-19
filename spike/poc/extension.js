// @ts-check
/**
 * KeyBlaze rendering spike: proof-of-concept extension.
 *
 * Uses ONLY official VS Code APIs. A localhost control server lets the external driver
 * (spike/driver.mjs) run scenarios: open editors, place cursors, render effects through decorations,
 * open a webview, read cursor/selection/visible-range state and collect event timestamps.
 *
 * It reuses KeyBlaze's compiled engine read-only (../../out/src) for the "engine" burst kind. It never
 * modifies KeyBlaze.
 */
const vscode = require('vscode');
const http = require('http');
const path = require('path');

const PORT = Number(process.env.KEYBLAZE_SPIKE_PORT || 9555);
const OUT = path.resolve(__dirname, '..', '..', 'out', 'src');

/** @type {{t:number, kind:string, data:any}[]} */
const events = [];
/** @type {vscode.TextEditorDecorationType[]} */
let decorationTypes = [];
/** @type {vscode.WebviewPanel | undefined} */
let webview;
/** @type {{sent:number, rtt:number}[]} */
const webviewRtts = [];
/** @type {number[]} */
const burstGenMs = [];
let liveBursts = false;
let liveTimer = 0;
let nonceCounter = 0;
const fixedTypes = new Map();
/** KeyBlaze-style slot pool for live mode: fixed decoration types reused round-robin. */
let slots = [];
let slotIndex = 0;
let recent = [];

function svgDoc(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}



/** Real KeyBlaze burst from the compiled engine. */
function engineSvg(seed, overrides) {
  const { AnimationEngine } = require(path.join(OUT, 'core', 'AnimationEngine'));
  const { ParticleEngine } = require(path.join(OUT, 'core', 'ParticleEngine'));
  const { renderBurstSvg } = require(path.join(OUT, 'render', 'SvgRenderer'));
  const { defaultSettings } = require(path.join(OUT, 'config', 'schema'));
  const engine = new AnimationEngine(new ParticleEngine(), Date.now);
  const t0 = process.hrtime.bigint();
  const track = engine.requestBurst({ ...defaultSettings(), ...overrides }, { bypassRateLimit: true, seed });
  const r = renderBurstSvg(track, { glow: true });
  const uri = `data:image/svg+xml;base64,${Buffer.from(r.svg).toString('base64')}`;
  burstGenMs.push(Number(process.hrtime.bigint() - t0) / 1e6);
  return { svg: r.svg, uri, width: r.width, height: r.height, durationMs: track.durationMs };
}

function lineHeightFromSettings(doc) {
  const c = vscode.workspace.getConfiguration('editor', doc);
  const fontSize = c.get('fontSize', 14);
  const lh = c.get('lineHeight', 0);
  if (lh <= 0) return Math.round(fontSize * (process.platform === 'darwin' ? 1.5 : 1.35));
  if (lh < 8) return Math.round(fontSize * lh);
  return lh;
}


function editorFor(column) {
  return vscode.window.visibleTextEditors.find((e) => e.viewColumn === column) ?? vscode.window.activeTextEditor;
}

/** Visual column of `ch` on `text`, expanding tabs like the editor does. */
function visualColumn(text, ch, tabSize) {
  let col = 0;
  for (let i = 0; i < ch && i < text.length; i++) col = text[i] === '\t' ? col + tabSize - (col % tabSize) : col + 1;
  return col;
}

/** Baseline offset below the line middle, from settings: (ascent - descent) / 2 ≈ 0.293em (Consolas). */
const BASELINE_EM = 0.293;

/**
 * Places one effect image so that its ORIGIN (the burst centre) lands on the caret.
 *
 * Anchors:
 *  caret – decoration on the caret line. The image bottom is pinned to that line's baseline, so the
 *          image extends upward. Margin-top = -H gives zero layout impact. Horizontal: -w/2 margins.
 *  below – decoration at column 0 of the line N below the caret, offset horizontally in `ch` by
 *          the caret's visual column. The image bottom sits on that line's baseline, and the SVG is
 *          padded so that its origin lands on the caret line's middle (full-circle effects).
 */
function burst(p) {
  const editor = p.column ? editorFor(p.column) : vscode.window.activeTextEditor;
  if (!editor) throw new Error('no editor');
  const pos = p.line !== undefined ? new vscode.Position(p.line, p.char) : editor.selection.active;
  const cfg = vscode.workspace.getConfiguration('editor', editor.document);
  const fontSize = cfg.get('fontSize', 14);
  const tabSize = cfg.get('tabSize', 4);
  const lineHeight = lineHeightFromSettings(editor.document);
  const b = BASELINE_EM * fontSize;
  const anchor = p.anchor ?? 'caret';
  const w = p.size ?? 96;
  const half = w / 2; // burst radius
  let durationMs = p.durationMs ?? 4000;

  let anchorLine = pos.line;
  let below = 0; // px from the caret line's middle down to the image bottom (baseline of anchor line)
  if (anchor === 'below') {
    const wanted = Math.max(0, Math.ceil((half - b) / lineHeight));
    anchorLine = Math.min(editor.document.lineCount - 1, pos.line + wanted);
    below = (anchorLine - pos.line) * lineHeight + b;
  } else {
    below = b;
  }
  const H = Math.round(half + below); // image height: burst top half + distance to the bottom
  const originY = half;

  let body;
  if (p.kind === 'engine') {
    const e = engineSvg(p.seed ?? Date.now(), p.overrides ?? {});
    durationMs = e.durationMs;
    // Re-centre the engine burst (origin at its centre) onto originY within a w×H canvas.
    const inner = e.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    body = `<g transform="translate(${w / 2 - e.width / 2} ${originY - e.height / 2})">${inner}</g>`;
  } else if (p.kind === 'progress') {
    const color = p.color ?? '#00c8ff';
    body =
      `<rect x="0.5" y="0.5" width="${w - 1}" height="${H - 1}" fill="none" stroke="${color}" stroke-dasharray="4 3"/>` +
      `<rect x="0" y="0" width="0" height="${H}" fill="${color}" fill-opacity="0.55">` +
      `<animate attributeName="width" from="0" to="${w}" dur="${durationMs}ms" fill="freeze"/></rect>`;
  } else {
    body =
      `<rect x="0.5" y="0.5" width="${w - 1}" height="${H - 1}" fill="none" stroke="#ff00ff" stroke-dasharray="4 3"/>` +
      `<line x1="${w / 2}" y1="0" x2="${w / 2}" y2="${H}" stroke="#ff00ff"/>` +
      `<line x1="0" y1="${originY}" x2="${w}" y2="${originY}" stroke="#ff00ff"/>` +
      `<circle cx="${w / 2}" cy="${originY}" r="3" fill="none" stroke="#00ff88"/>`;
  }
  const nonce = p.sameUri ? '' : `<desc>${Date.now()}-${++nonceCounter}</desc>`;
  const svg = svgDoc(w, H, nonce + body);
  const uri = vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);

  let range;
  let margin;
  if (anchor === 'below') {
    const lineText = editor.document.lineAt(pos.line).text;
    const v = visualColumn(lineText, pos.character, tabSize);
    range = new vscode.Range(anchorLine, 0, anchorLine, 0);
    margin = `${-H}px calc(${-v}ch - ${w / 2}px) 0 calc(${v}ch - ${w / 2}px)`;
  } else {
    const ch = pos.character;
    range = ch === 0 ? new vscode.Range(pos.line, 0, pos.line, 0) : new vscode.Range(pos.line, ch - 1, pos.line, ch);
    margin = `${-H}px ${-w / 2}px 0 ${-w / 2}px`;
  }
  if (p.rawMargin) margin = p.rawMargin;

  const decoration = [{ range, renderOptions: { after: { contentIconPath: uri, width: `${w}px`, height: `${H}px`, margin } } }];
  if (p.slot) {
    // Pooled: replace whatever this slot showed (recycles the oldest burst), clear after lifetime.
    const slot = p.slot;
    clearTimeout(slot.timer);
    if (slot.editor && slot.editor !== editor) slot.editor.setDecorations(slot.type, []);
    editor.setDecorations(slot.type, decoration);
    slot.editor = editor;
    slot.timer = setTimeout(() => editor.setDecorations(slot.type, []), durationMs);
    return { width: w, height: H, originY, durationMs };
  }
  const type = vscode.window.createTextEditorDecorationType({ rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen });
  decorationTypes.push(type);
  editor.setDecorations(type, decoration);
  if (p.autoClear !== false) {
    setTimeout(() => {
      type.dispose();
      decorationTypes = decorationTypes.filter((t) => t !== type);
    }, durationMs + 200);
  }
  return { width: w, height: H, originY, anchorLine, lineHeight, margin, durationMs, svgBytes: svg.length };
}

function openWebview() {
  webview?.dispose();
  webview = vscode.window.createWebviewPanel('keyblazeSpike', 'Spike: Webview mirror', vscode.ViewColumn.Beside, {
    enableScripts: true,
  });
  webview.webview.html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';"></head>
<body style="margin:0;background:transparent;color:var(--vscode-foreground);font:12px var(--vscode-font-family)">
<div style="padding:8px">Webview mirror: receives cursor positions over postMessage. It cannot be placed over the text editor.</div>
<canvas id="c" width="600" height="400"></canvas>
<script>
const vscode = acquireVsCodeApi();
const ctx = document.getElementById('c').getContext('2d');
let parts = [];
window.addEventListener('message', (e) => {
  const m = e.data;
  vscode.postMessage({ type: 'ack', sent: m.sent });
  for (let i = 0; i < 12; i++) parts.push({ x: 20 + m.char * 8, y: 20 + (m.line % 40) * 9, vx: Math.cos(i) * 2, vy: Math.sin(i) * 2, life: 1 });
});
function frame() {
  ctx.clearRect(0, 0, 600, 400);
  parts = parts.filter((p) => (p.life -= 0.03) > 0);
  for (const p of parts) { p.x += p.vx; p.y += p.vy; ctx.globalAlpha = p.life; ctx.fillStyle = '#ff8a00'; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, 7); ctx.fill(); }
  requestAnimationFrame(frame);
}
frame();
</script></body></html>`;
  webview.webview.onDidReceiveMessage((m) => {
    if (m.type === 'ack') webviewRtts.push({ sent: m.sent, rtt: Date.now() - m.sent });
  });
  return { ok: true };
}

/** Live mode: every genuine keystroke in the active editor renders a real engine burst at the caret. */
function setLive(on, overrides) {
  liveBursts = on;
  liveTimer = 0;
  return { live: liveBursts, overrides };
}

let liveOverrides = {};

async function handle(op, p) {
  switch (op) {
    case 'ping':
      return { ok: true, version: vscode.version, pid: process.pid };
    case 'open': {
      const doc = await vscode.workspace.openTextDocument({ content: p.content, language: p.language ?? 'plaintext' });
      const ed = await vscode.window.showTextDocument(doc, { viewColumn: p.column ?? vscode.ViewColumn.One, preview: false });
      return { column: ed.viewColumn };
    }
    case 'cursor': {
      const ed = p.column ? editorFor(p.column) : vscode.window.activeTextEditor;
      if (!ed) throw new Error('no editor');
      const pos = new vscode.Position(p.line, p.char);
      ed.selection = new vscode.Selection(pos, pos);
      ed.revealRange(new vscode.Range(pos, pos), p.reveal ?? vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      return { ok: true };
    }
    case 'focus': {
      const ed = editorFor(p.column);
      if (!ed) throw new Error('no editor');
      await vscode.window.showTextDocument(ed.document, { viewColumn: ed.viewColumn, preserveFocus: false });
      return { ok: true };
    }
    case 'burst':
      return burst(p);
    case 'clear':
      for (const t of decorationTypes) t.dispose();
      decorationTypes = [];
      return { ok: true };
    case 'config':
      await vscode.workspace.getConfiguration(p.section).update(p.key, p.value, vscode.ConfigurationTarget.Global);
      return { ok: true };
    case 'exec':
      return { result: await vscode.commands.executeCommand(p.command, ...(p.args ?? [])) ?? null };
    case 'state': {
      const ed = vscode.window.activeTextEditor;
      return {
        active: ed && {
          column: ed.viewColumn,
          selections: ed.selections.map((s) => ({ line: s.active.line, char: s.active.character })),
          visibleRanges: ed.visibleRanges.map((r) => [r.start.line, r.end.line]),
        },
        visibleEditors: vscode.window.visibleTextEditors.map((e) => ({
          column: e.viewColumn,
          selection: { line: e.selection.active.line, char: e.selection.active.character },
          visibleRanges: e.visibleRanges.map((r) => [r.start.line, r.end.line]),
        })),
      };
    }
    case 'events': {
      const out = events.slice();
      if (p.clear) events.length = 0;
      return out;
    }
    case 'webview':
      return openWebview();
    case 'webviewPing':
      if (!webview) throw new Error('no webview');
      for (let i = 0; i < (p.count ?? 20); i++) {
        await webview.webview.postMessage({ sent: Date.now(), line: i, char: i * 2 });
        await new Promise((r) => setTimeout(r, p.interval ?? 50));
      }
      await new Promise((r) => setTimeout(r, 300));
      return { rtts: webviewRtts.splice(0).map((r) => r.rtt) };
    case 'webviewClose':
      webview?.dispose();
      webview = undefined;
      return { ok: true };
    case 'live':
      for (const sl of slots) { clearTimeout(sl.timer); sl.type.dispose(); }
      slots = [];
      slotIndex = 0;
      recent = [];
      liveOverrides = p.overrides ?? {};
      return setLive(!!p.on, liveOverrides);
    case 'fixedType': {
      // Type-level image: the CSS rule is created once, with the type. setDecorations only toggles it.
      const w = p.size ?? 120;
      const H = Math.round(w / 2 + BASELINE_EM * 14);
      const color = p.color ?? '#00c8ff';
      const body = p.kind === 'engine'
        ? (() => { const e = engineSvg(p.seed ?? 1, p.overrides ?? {}); const inner = e.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, ''); return `<g transform="translate(${w / 2 - e.width / 2} ${w / 2 - e.height / 2})">${inner}</g>`; })()
        : `<rect x="0.5" y="0.5" width="${w - 1}" height="${H - 1}" fill="none" stroke="${color}" stroke-dasharray="4 3"/><rect x="0" y="0" width="0" height="${H}" fill="${color}" fill-opacity="0.55"><animate attributeName="width" from="0" to="${w}" dur="${p.durationMs ?? 1500}ms" fill="freeze"/></rect>`;
      const svg = svgDoc(w, H, `<desc>fixed-${p.id}</desc>` + body);
      const uri = vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
      const type = vscode.window.createTextEditorDecorationType({
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
        after: { contentIconPath: uri, width: `${w}px`, height: `${H}px`, margin: `${-H}px ${-w / 2}px 0 ${-w / 2}px` },
      });
      fixedTypes.set(p.id, type);
      return { ok: true, H };
    }
    case 'fixedSet': {
      const ed = vscode.window.activeTextEditor;
      const ch = p.char;
      ed.setDecorations(fixedTypes.get(p.id), [new vscode.Range(p.line, Math.max(0, ch - 1), p.line, ch)]);
      return { ok: true };
    }
    case 'fixedClear':
      vscode.window.activeTextEditor.setDecorations(fixedTypes.get(p.id), []);
      return { ok: true };
    case 'keyblaze': {
      // Read the real KeyBlaze extension's diagnostic API (used by test/visual/verify-placement.mjs).
      const ext = vscode.extensions.getExtension(p.id);
      if (!ext) throw new Error(`extension ${p.id} not loaded`);
      const api = ext.isActive ? ext.exports : await ext.activate();
      return api.getStats();
    }
    case 'keyblazeSettings': {
      const ext = vscode.extensions.getExtension(p.id);
      const api = ext.isActive ? ext.exports : await ext.activate();
      return api.getSettings();
    }
    case 'keyblazeEnv': {
      const ext = vscode.extensions.getExtension(p.id);
      const api = ext.isActive ? ext.exports : await ext.activate();
      api.setEnvironmentOverride(p.override ?? {});
      return { ok: true };
    }
    case 'markdownPreview':
      await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(p.path));
      return { ok: true };
    case 'memory':
      // Extension host memory (shared by every extension in this isolated instance).
      return process.memoryUsage();
    case 'burstStats':
      return { burstGenMs: burstGenMs.splice(0) };
    default:
      throw new Error(`unknown op ${op}`);
  }
}

function activate(context) {
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.scheme === 'output') return;
      events.push({
        t: Date.now(),
        kind: 'change',
        data: e.contentChanges.map((c) => ({ text: c.text, line: c.range.start.line, char: c.range.start.character })),
      });
      const ed = vscode.window.activeTextEditor;
      if (liveBursts && ed && ed.document === e.document && e.contentChanges.length === 1 && e.contentChanges[0].text.length === 1) {
        const c = e.contentChanges[0];
        const pos = c.range.start.translate(0, 1);
        const now = Date.now();
        recent = recent.filter((t) => now - t < 1000);
        if (liveOverrides.maxPerSec && recent.length >= liveOverrides.maxPerSec) return;
        recent.push(now);
        let slot;
        if (liveOverrides.pool) {
          while (slots.length < liveOverrides.pool) slots.push({ type: vscode.window.createTextEditorDecorationType({ rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen }), timer: 0, editor: undefined });
          slot = slots[slotIndex++ % liveOverrides.pool];
        }
        try {
          burst({ slot, kind: liveOverrides.kind ?? 'engine', anchor: liveOverrides.anchor ?? 'caret', size: liveOverrides.size ?? 120, line: pos.line, char: pos.character, seed: ++liveTimer, overrides: liveOverrides.engine ?? {} });
        } catch (err) {
          events.push({ t: Date.now(), kind: 'error', data: String(err) });
        }
      }
    }),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      events.push({
        t: Date.now(),
        kind: 'selection',
        data: { column: e.textEditor.viewColumn, line: e.selections[0].active.line, char: e.selections[0].active.character, kind: e.kind },
      });
    }),
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      events.push({ t: Date.now(), kind: 'visibleRanges', data: e.visibleRanges.map((r) => [r.start.line, r.end.line]) });
    }),
  );

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const { op, ...params } = JSON.parse(body || '{}');
        const result = await handle(op, params);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result ?? null));
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: String(err && err.stack ? err.stack : err) }));
      }
    });
  });
  server.listen(PORT, '127.0.0.1');
  context.subscriptions.push({ dispose: () => server.close() });
}

function deactivate() {}

module.exports = { activate, deactivate };
