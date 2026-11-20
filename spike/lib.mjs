// Test harness for the rendering spike. Launches an isolated VS Code with the PoC extension and
// remote debugging, then exposes helpers: PoC control (official API side) and CDP (observation side:
// real keystrokes, pixel measurement, profiling, screenshots). CDP is test tooling only. The PoC
// extension itself uses official APIs exclusively.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
/** The extension ID (`publisher.name`), always taken from package.json so scripts never drift from it. */
export const EXTENSION_ID = (() => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return `${pkg.publisher}.${pkg.name}`;
})();
export const RESULTS = path.join(here, 'results');
const CODE = path.join(ROOT, '.vscode-test', `vscode-win32-x64-archive-${process.env.KEYBLAZE_VSCODE_VERSION ?? '1.147.0'}`, 'Code.exe');
const CDP_PORT = 9444;
const POC_PORT = 9555;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ settings = {}, width = 1400, height = 900, extraExtensions = [], extensionsDir, keepInstalledExtensions = false, inspectExtensionsPort } = {}) {
  const userData = path.join(RESULTS, 'user-data');
  fs.rmSync(userData, { recursive: true, force: true });
  fs.mkdirSync(path.join(userData, 'User'), { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'User', 'settings.json'),
    JSON.stringify(
      {
        'workbench.startupEditor': 'none',
        'workbench.tips.enabled': false,
        'workbench.colorTheme': 'Default Dark Modern',
        'window.restoreWindows': 'none',
        'window.zoomLevel': 0,
        'editor.cursorBlinking': 'solid',
        'editor.minimap.enabled': false,
        'editor.fontSize': 14,
        'editor.lineHeight': 0,
        'update.mode': 'none',
        'telemetry.telemetryLevel': 'off',
        'chat.disableAIFeatures': true,
        'workbench.secondarySideBar.defaultVisibility': 'hidden',
        'security.workspace.trust.enabled': false,
        ...settings,
      },
      null,
      2,
    ),
  );
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(VSCODE_|ELECTRON_)/.test(k)));
  env.KEYBLAZE_SPIKE_PORT = String(POC_PORT);
  const proc = spawn(
    CODE,
    [
      `--extensionDevelopmentPath=${path.join(here, 'poc')}`,
      ...extraExtensions.map((p) => `--extensionDevelopmentPath=${p}`),
      `--user-data-dir=${userData}`,
      `--extensions-dir=${extensionsDir ?? path.join(RESULTS, 'extensions')}`,
      ...(keepInstalledExtensions ? [] : ['--disable-extensions']),
      `--remote-debugging-port=${CDP_PORT}`,
      ...(inspectExtensionsPort ? [`--inspect-extensions=${inspectExtensionsPort}`] : []),
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-workspace-trust',
      '--new-window',
    ],
    { env, stdio: 'ignore', detached: false },
  );

  // Wait for the PoC control server (extension host is up).
  let version;
  for (let i = 0; i < 150 && !version; i++) {
    await sleep(200);
    try {
      version = (await poc('ping')).version;
    } catch {
      /* not yet */
    }
  }
  if (!version) throw new Error('PoC extension did not start');

  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
  const page = targets.find((t) => t.type === 'page' && /workbench/.test(t.url));
  if (!page) throw new Error('workbench target not found: ' + JSON.stringify(targets.map((t) => t.url)));
  const cdp = await connect(page.webSocketDebuggerUrl);
  // Fix the viewport so measurements and screenshots are reproducible.
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await cdp.send('DOM.enable');
  await cdp.send('Page.enable');
  await cdp.send('Performance.enable');
  await sleep(1500);
  // A spawned test window may not have OS focus; KeyBlaze pauses when unfocused, so pin it.
  if (extraExtensions.length > 0 || keepInstalledExtensions) {
    try {
      await poc('keyblazeEnv', { id: EXTENSION_ID, override: { windowFocused: true } });
    } catch {
      /* KeyBlaze not loaded in this run */
    }
  }
  return {
    version,
    cdp,
    /** Process IDs: the VS Code main process and the extension host (for CPU/memory sampling). */
    pid: proc.pid,
    extensionHostPid: (await poc('ping')).pid,
    async close() {
      try {
        cdp.close();
      } catch {
        /* ignore */
      }
      // Kill the whole process tree of this isolated instance only.
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      await sleep(1000);
    },
  };
}

export async function poc(op, params = {}) {
  const res = await fetch(`http://127.0.0.1:${POC_PORT}/`, { method: 'POST', body: JSON.stringify({ op, ...params }) });
  const json = await res.json();
  if (res.status !== 200) throw new Error(`${op}: ${json.error}`);
  return json;
}

export async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.method) for (const fn of listeners.get(d.method) ?? []) fn(d.params);
    if (d.id && pending.has(d.id)) {
      const { resolve, reject } = pending.get(d.id);
      pending.delete(d.id);
      if (d.error) reject(new Error(`${d.error.message} ${d.error.data ?? ''}`));
      else resolve(d.result);
    }
  });
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const i = ++id;
        pending.set(i, { resolve, reject });
        ws.send(JSON.stringify({ id: i, method, params }));
      });
    },
    /** Subscribes to a CDP event; returns an unsubscribe function. */
    on(method, fn) {
      if (!listeners.has(method)) listeners.set(method, new Set());
      listeners.get(method).add(fn);
      return () => listeners.get(method).delete(fn);
    },
    close: () => ws.close(),
  };
}

export async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

const KEYCODES = { Enter: 13, Backspace: 8, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, End: 35, Home: 36 };

/** Genuine keyboard input via CDP (goes through VS Code's normal keyboard handling). */
export async function key(cdp, k) {
  if (k.length === 1) {
    const upper = k.toUpperCase();
    const vk = /[a-z0-9]/i.test(k) ? upper.charCodeAt(0) : 0;
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k, unmodifiedText: k, windowsVirtualKeyCode: vk, code: /[a-z]/i.test(k) ? `Key${upper}` : '' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, windowsVirtualKeyCode: vk });
  } else {
    const vk = KEYCODES[k];
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: vk });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: vk });
  }
}

export async function typeText(cdp, text, intervalMs = 0) {
  for (const ch of text) {
    await key(cdp, ch);
    if (intervalMs) await sleep(intervalMs);
  }
}

export async function wheel(cdp, x, y, deltaY) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
}

export async function screenshot(cdp, name, clip) {
  const params = { format: 'png' };
  if (clip) params.clip = { ...clip, scale: 1 };
  const shot = await cdp.send('Page.captureScreenshot', params);
  const file = path.join(RESULTS, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  return file;
}

/**
 * Like measure(), but retries while no effect image could be measured. Shortly after a keystroke
 * Monaco re-renders the edited line (tokenization), which can detach a span between querying and
 * measuring it; measure() skips such nodes, so a single sample can miss an image that is on screen.
 */
export async function measureImages(cdp, { tries = 10, gapMs = 30 } = {}) {
  let m = await measure(cdp);
  for (let i = 1; i < tries && m.images.length === 0; i++) {
    await sleep(gapMs);
    m = await measure(cdp);
  }
  return m;
}

/** Marks the process as failed (non-zero exit code) without aborting the remaining checks. */
export function markFailed() {
  process.exitCode = 1;
}

/**
 * Measures, in CSS pixels of the workbench, the caret of every text editor and the box of every
 * effect image rendered by a decoration (`::after` pseudo-elements whose content is our SVG).
 */
export async function measure(cdp) {
  await cdp.send('DOM.getDocument', { depth: 0 });
  const { result } = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const editors = [...document.querySelectorAll('.editor-instance .monaco-editor, .monaco-editor')]
        .filter((e, i, a) => a.indexOf(e) === i && e.querySelector('.view-lines') && !e.closest('.monaco-diff-editor') && e.offsetParent);
      const spans = [];
      editors.forEach((ed, edIndex) => {
        for (const s of ed.querySelectorAll('.view-line span')) {
          const c = getComputedStyle(s, '::after');
          if (/url\\(/.test(c.content) || /url\\(/.test(c.backgroundImage)) spans.push(s);
        }
      });
      return { editors, spans };
    })()`,
  });
  const props = await cdp.send('Runtime.getProperties', { objectId: result.objectId, ownProperties: true });
  const arr = async (name) => {
    const p = props.result.find((x) => x.name === name);
    const items = await cdp.send('Runtime.getProperties', { objectId: p.value.objectId, ownProperties: true });
    return items.result.filter((x) => /^\d+$/.test(x.name)).map((x) => x.value.objectId);
  };
  const editorIds = await arr('editors');
  const spanIds = await arr('spans');

  const editors = [];
  for (const objectId of editorIds) {
    const info = await cdp.send('Runtime.callFunctionOn', {
      objectId,
      returnByValue: true,
      functionDeclaration: `function () {
        const r = this.getBoundingClientRect();
        const cur = this.querySelector('.cursors-layer .cursor');
        const cr = cur && cur.getBoundingClientRect();
        const lines = this.querySelector('.view-lines');
        return {
          rect: { x: r.x, y: r.y, w: r.width, h: r.height },
          focused: this.classList.contains('focused'),
          cursor: cr && { x: cr.x, y: cr.y, w: cr.width, h: cr.height },
          fontSize: lines && getComputedStyle(lines).fontSize,
          lineHeight: lines && getComputedStyle(lines).lineHeight,
          dpr: window.devicePixelRatio,
        };
      }`,
    });
    editors.push(info.result.value);
  }

  const images = [];
  for (const objectId of spanIds) {
    try {
      images.push(...(await measureImage(cdp, objectId)));
    } catch {
      // The node vanished between query and measurement (e.g. a burst expired): skip it.
    }
  }
  return { editors, images };
}

async function measureImage(cdp, objectId) {
  const images = [];
  {
    const { nodeId } = await cdp.send('DOM.requestNode', { objectId });
    const { node } = await cdp.send('DOM.describeNode', { nodeId, depth: 1 });
    const pseudo = (node.pseudoElements ?? []).find((p) => p.pseudoType === 'after');
    if (!pseudo) return images;
    const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId: pseudo.backendNodeId });
    const q = model.content; // [x1,y1,x2,y2,x3,y3,x4,y4]
    const box = { x: q[0], y: q[1], w: q[2] - q[0], h: q[5] - q[1] };
    const meta = await cdp.send('Runtime.callFunctionOn', {
      objectId,
      returnByValue: true,
      functionDeclaration: `function () {
        const ed = this.closest('.monaco-editor');
        const all = [...document.querySelectorAll('.monaco-editor')];
        const line = this.closest('.view-line');
        const lr = line.getBoundingClientRect();
        const c = getComputedStyle(this, '::after');
        // Text position inside the decorated line vs. an undecorated reference line in the same editor.
        const textTop = (l) => { const t = l.querySelector('span > span'); return t ? t.getBoundingClientRect().y - l.getBoundingClientRect().y : NaN; };
        const ref = [...ed.querySelectorAll('.view-line')].find((l) => l !== line && l.textContent.trim().length > 0 && ![...l.querySelectorAll('span')].some((s) => getComputedStyle(s, '::after').content.includes('url(')));
        return { editorRect: ed.getBoundingClientRect().toJSON(), lineTop: lr.y, lineHeight: lr.height,
                 display: c.display, margin: c.margin, verticalAlign: c.verticalAlign,
                 textShiftY: ref ? textTop(line) - textTop(ref) : NaN };
      }`,
    });
    images.push({ ...box, cx: box.x + box.w / 2, cy: box.y + box.h / 2, ...meta.result.value });
  }
  return images;
}

/**
 * For each effect image: where its ORIGIN (image top + originY) landed relative to the caret of the
 * editor that contains it. dx: horizontal error vs caret x. dy: vertical error vs the caret line's
 * middle. textShiftY: how far the anchor line's text moved vs an undecorated line (0 = no layout impact).
 */
export function offsets(m, originY) {
  return m.images.map((img) => {
    const ed = m.editors.find((e) => Math.abs(e.rect.x - img.editorRect.x) < 1 && Math.abs(e.rect.y - img.editorRect.y) < 1);
    const caret = ed?.cursor;
    const ox = img.x + img.w / 2;
    const oy = img.y + (originY ?? img.h / 2);
    return {
      w: Math.round(img.w),
      h: Math.round(img.h),
      dx: caret ? +(ox - caret.x).toFixed(2) : null,
      dy: caret ? +(oy - (caret.y + caret.h / 2)).toFixed(2) : null,
      textShiftY: Number.isFinite(img.textShiftY) ? +img.textShiftY.toFixed(2) : null,
      lineHeightPx: img.lineHeight,
      editorX: Math.round(img.editorRect.x),
    };
  });
}

/** Fraction (0–1) of a horizontal row inside `rect` covered by the progress-bar colour, read from a screenshot. */
export async function barFraction(cdp, rect) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1 } });
  return evaluate(
    cdp,
    `(async () => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(shot.data)}), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d');
      g.drawImage(bmp, 0, 0);
      const y = Math.floor(bmp.height / 2);
      const row = g.getImageData(0, y, bmp.width, 1).data;
      let hit = 0;
      for (let x = 2; x < bmp.width - 2; x++) {
        const r = row[x * 4], gg = row[x * 4 + 1], b = row[x * 4 + 2];
        if (b > 110 && gg > 80 && r < 90) hit++;
      }
      return hit / (bmp.width - 4);
    })()`,
  );
}

export async function metrics(cdp) {
  const { metrics: list } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(list.map((m) => [m.name, m.value]));
}
