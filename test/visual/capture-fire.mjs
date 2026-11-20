// Captures the REAL Fire effect (Firestorm preset) in VS Code with the DevTools screencast: frame
// strips after one keystroke and animated PNG recordings of typing, in dark and light themes, with a
// larger font, window zoom and backspace.
// Usage: npm run build && node test/visual/capture-fire.mjs [label]   → spike/results/fire-<label>/
import fs from 'node:fs';
import path from 'node:path';
import { RESULTS, ROOT, key, launch, measure, poc, sleep, EXTENSION_ID } from '../../spike/lib.mjs';
import { encodeApng } from './apng.mjs';
import { cropRgb, decodePng, encodeRgbPng, hstack, upscale, vstack } from './png.mjs';

const label = process.argv[2] ?? 'current';
const OUT = path.join(RESULTS, `fire-${label}`);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const CODE = [
  "import { readFile } from 'node:fs/promises';",
  '',
  'export async function loadConfig(path: string): Promise<Config> {',
  "  const text = await readFile(path, 'utf8');",
  '  const parsed = JSON.parse(text) as Partial<Config>;',
  '  return { ...DEFAULTS, ...parsed };',
  '}',
  '',
  'export function render(items: Item[]): string {',
  "  return items.map((item) => `<li>${item.name}</li>`).join('');",
  '}',
  '',
  '',
  '',
  'const total = values.reduce((sum, v) => sum + v, 0);',
  'console.log(total);',
  ...Array.from({ length: 30 }, (_, i) => `// ${i}`),
];
const TYPE_LINE = 12;
const log = (x) => console.log(JSON.stringify(x));
let vs;

async function reset(text = '  ') {
  await poc('exec', { command: 'workbench.action.files.revert' }).catch(() => {});
  await poc('cursor', { line: TYPE_LINE, char: 0, reveal: 1 });
  for (const ch of text) await key(vs.cdp, ch);
  await sleep(1200);
}

async function caret() {
  return (await measure(vs.cdp)).editors[0].cursor;
}

/** Records screencast frames while `act` runs, plus `tailMs`. Frames: { png, t (ms) }. */
async function recordFrames(act, tailMs = 900) {
  const frames = [];
  const off = vs.cdp.on('Page.screencastFrame', (p) => {
    frames.push({
      png: Buffer.from(p.data, 'base64'),
      t: p.metadata.timestamp * 1000,
      deviceWidth: p.metadata.deviceWidth,
    });
    vs.cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
  });
  await vs.cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  await sleep(300);
  const start = Date.now();
  await act();
  await sleep(tailMs);
  await vs.cdp.send('Page.stopScreencast');
  off();
  return { frames, start };
}

let zoomFactor = 1;
/** Crops a clip given in CSS px. Frames are in device pixels (display scaling × window zoom). */
function crops(frames, clip) {
  return frames.map((f) => {
    const img = decodePng(f.png);
    const k = (img.width / f.deviceWidth) * zoomFactor;
    const r = (v) => Math.round(v * k);
    return { ...f, img: cropRgb(img, r(clip.x), r(clip.y), r(clip.width), r(clip.height)) };
  });
}

function writeApng(name, cropped, maxFrames = 120) {
  const list = cropped.slice(-maxFrames);
  const out = list.map((f, i) => ({
    png: encodeRgbPng(f.img),
    delayMs: Math.min(200, (list[i + 1]?.t ?? f.t + 33) - f.t),
  }));
  fs.writeFileSync(path.join(OUT, `${name}.png`), encodeApng(out));
  const span = (list.at(-1).t - list[0].t) / 1000;
  return { name, frames: out.length, fps: +(out.length / Math.max(0.001, span)).toFixed(1) };
}

/** One keystroke; a strip of frames at fixed times after it, plus an animated PNG. */
async function single(
  name,
  { w = 200, h = 150, left = 70, times = [50, 120, 200, 300, 420, 560, 720] } = {},
) {
  await reset();
  const c = await caret();
  const clip = { x: Math.round(c.x - left), y: Math.round(c.y - h + 40), width: w, height: h };
  let keyAt = 0;
  const { frames } = await recordFrames(async () => {
    keyAt = Date.now();
    await key(vs.cdp, 'x');
  }, 1000);
  // Screencast timestamps are wall-clock seconds, like Date.now().
  const cropped = crops(frames, clip);
  const strip = times.map((t) => {
    let best = cropped[0];
    for (const f of cropped) if (Math.abs(f.t - keyAt - t) < Math.abs(best.t - keyAt - t)) best = f;
    return best.img;
  });
  fs.writeFileSync(path.join(OUT, `${name}-strip.png`), encodeRgbPng(hstack(strip)));
  // Magnified detail: a small box around the typed character, 3× (device pixels, nearest neighbour).
  const detailClip = { x: Math.round(c.x - 45), y: Math.round(c.y - 60), width: 70, height: 75 };
  const detail = crops(frames, detailClip);
  const pick = (t) =>
    detail.reduce((best, f) =>
      Math.abs(f.t - keyAt - t) < Math.abs(best.t - keyAt - t) ? f : best,
    );
  fs.writeFileSync(
    path.join(OUT, `${name}-detail.png`),
    encodeRgbPng(
      upscale(
        hstack(
          times.map((t) => pick(t).img),
          2,
        ),
        3,
      ),
    ),
  );
  log(
    writeApng(
      `${name}-anim`,
      cropped.filter((f) => f.t >= keyAt - 100),
    ),
  );
  return hstack(strip);
}

async function typing(name, text, cps, { w = 420, h = 160, left = 40 } = {}) {
  await reset();
  const c = await caret();
  const clip = { x: Math.round(c.x - left), y: Math.round(c.y - h + 40), width: w, height: h };
  const { frames } = await recordFrames(async () => {
    const t0 = Date.now();
    for (const [i, ch] of [...text].entries()) {
      await key(vs.cdp, ch);
      const wait = t0 + ((i + 1) * 1000) / cps - Date.now();
      if (wait > 0) await sleep(wait);
    }
  });
  const cropped = crops(frames, clip);
  log(writeApng(name, cropped));
  // Stills at 40 %, 60 % and 80 % of the recording (mid-typing), stacked.
  const at = (q) => cropped[Math.min(cropped.length - 1, Math.floor(cropped.length * q))].img;
  fs.writeFileSync(
    path.join(OUT, `${name}-stills.png`),
    encodeRgbPng(vstack([at(0.4), at(0.6), at(0.8)])),
  );
}

vs = await launch({
  extraExtensions: [ROOT],
  settings: {
    'editor.quickSuggestions': { other: false, comments: false, strings: false },
    'editor.suggestOnTriggerCharacters': false,
    'editor.wordBasedSuggestions': 'off',
    'editor.parameterHints.enabled': false,
    'editor.hover.enabled': false,
    'editor.autoClosingBrackets': 'never',
    'editor.autoClosingQuotes': 'never',
  },
});
try {
  await poc('config', { section: 'keyblaze', key: 'preset', value: 'firestorm' });
  await poc('config', { section: 'keyblaze', key: 'combo.showIndicator', value: false });
  await poc('open', { content: CODE.join('\n'), language: 'typescript' });
  await sleep(1500);

  const sheet = [];
  if (process.env.QUICK) {
    sheet.push(await single('dark-single'));
    await typing('dark-typing-8cps', 'const flame = ignite(code);', 8);
    await typing('dark-typing-14cps', 'return items.filter(Boolean);', 14);
    fs.writeFileSync(path.join(OUT, 'sheet.png'), encodeRgbPng(vstack(sheet)));
    throw new Error('quick');
  }
  for (const theme of ['Default Dark Modern', 'Default Light Modern']) {
    const t = theme.includes('Light') ? 'light' : 'dark';
    await poc('config', { section: 'workbench', key: 'colorTheme', value: theme });
    await sleep(1500);
    sheet.push(await single(`${t}-single`));
    await typing(`${t}-typing-8cps`, 'const flame = ignite(code);', 8);
    await typing(`${t}-typing-14cps`, 'return items.filter(Boolean);', 14);
  }
  await poc('config', { section: 'workbench', key: 'colorTheme', value: 'Default Dark Modern' });
  await sleep(1000);

  // Backspace: type a word, then delete it quickly.
  await reset();
  {
    const c = await caret();
    const clip = { x: Math.round(c.x - 60), y: Math.round(c.y - 120), width: 300, height: 160 };
    const { frames } = await recordFrames(async () => {
      for (const ch of 'blaze') {
        await key(vs.cdp, ch);
        await sleep(110);
      }
      for (let i = 0; i < 5; i++) {
        await key(vs.cdp, 'Backspace');
        await sleep(110);
      }
    });
    log(writeApng('dark-backspace', crops(frames, clip)));
  }

  // Larger editor font, then window zoom (scales everything, including the effect images).
  await poc('config', { section: 'editor', key: 'fontSize', value: 20 });
  await sleep(1500);
  sheet.push(await single('font20-single', { w: 240, h: 180, left: 80 }));
  await typing('font20-typing-8cps', 'flames.rise();', 8, { w: 480, h: 190 });
  await poc('config', { section: 'editor', key: 'fontSize', value: 14 });
  await poc('config', { section: 'window', key: 'zoomLevel', value: 2 });
  zoomFactor = 1.2 ** 2;
  await sleep(2500);
  sheet.push(await single('zoom2-single', { w: 300, h: 220, left: 100 }));
  await poc('config', { section: 'window', key: 'zoomLevel', value: 0 });
  zoomFactor = 1;

  fs.writeFileSync(path.join(OUT, 'sheet.png'), encodeRgbPng(vstack(sheet)));
  const stats = await poc('keyblaze', { id: EXTENSION_ID });
  log({
    lastBurst: { svgBytes: stats.lastBurst?.svgBytes, decisions: stats.lastBurst?.decisions },
  });
} catch (err) {
  if (err.message !== 'quick') throw err;
} finally {
  await vs.close();
}
