// CPU cost of the REAL extension, measured at the operating-system level across every process of an
// isolated VS Code (renderer, GPU, extension host, main and helpers), for every preset and for the
// typing, lingering, idle, unfocused, tab-switching and Control Panel scenarios.
// Usage: npm run build && node test/visual/measure-cpu.mjs   (ONLY=<label substring> to filter)
// Results: spike/results/measure-cpu.json. Windows only (uses Win32_Process).
import fs from 'node:fs';
import path from 'node:path';
import {
  RESULTS,
  ROOT,
  evaluate,
  key,
  launch,
  poc,
  sleep,
  EXTENSION_ID,
} from '../../spike/lib.mjs';
import { processSnapshot, cpuDelta } from './processes.mjs';

const ID = EXTENSION_ID;
const TYPE_CPS = Number(process.env.CPS ?? 8);
const TYPE_SECONDS = Number(process.env.TYPE_SECONDS ?? 12);
const IDLE_SECONDS = Number(process.env.IDLE_SECONDS ?? 8);

const PRESETS = [
  'classicBurst',
  'firestorm',
  'lightningStrike',
  'neonEnergy',
  'cosmicExplosion',
  'starfall',
  'minimalSparks',
  'rainbowRush',
  'cyberpunk',
  'cleanMode',
];
const CONFIGS = [
  ['disabled', { enabled: false }],
  ...PRESETS.map((p) => [p, { preset: p }]),
  ['cosmicExplosion + performanceMode', { preset: 'cosmicExplosion', performanceMode: true }],
  ['classicBurst + cursor glow', { 'cursor.effect': 'glow' }],
  ['classicBurst + cursor ring', { 'cursor.effect': 'ring' }],
];

let vs;
/** Runs `body` and returns the CPU used meanwhile, per process kind, in % of one core. */
// No requestAnimationFrame probe here: a rAF loop makes Chromium produce a frame on every vsync and
// would itself dominate the idle measurements.
async function window(label, body) {
  const a = processSnapshot(vs.pid, vs.extensionHostPid);
  const t0 = Date.now();
  await body();
  const seconds = (Date.now() - t0) / 1000;
  const b = processSnapshot(vs.pid, vs.extensionHostPid);
  const images = await evaluate(
    vs.cdp,
    `[...document.querySelectorAll('.monaco-editor .view-lines span')].filter((s) => /url\\(/.test(getComputedStyle(s, '::after').content)).length`,
  );
  return { label, seconds: +seconds.toFixed(1), imagesAfter: images, ...cpuDelta(a, b, seconds) };
}

async function typeFor(seconds, cps = TYPE_CPS) {
  const interval = 1000 / cps;
  const n = Math.round(seconds * cps);
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    await key(vs.cdp, 'abcdefghijklmnopqrstuvwxyz'[i % 26]);
    if (i % 40 === 39) await key(vs.cdp, 'Enter');
    const wait = t0 + (i + 1) * interval - Date.now();
    if (wait > 0) await sleep(wait);
  }
}

async function configure(values) {
  await poc('exec', { command: 'keyblaze.resetSettings', args: [{ skipConfirmation: true }] });
  for (const [k, v] of Object.entries(values))
    await poc('config', { section: 'keyblaze', key: k, value: v });
  await poc('keyblazeEnv', { id: ID, override: { windowFocused: true } });
}

async function freshEditor() {
  // Revert while closing: closeAllEditors can block on a "Save changes?" dialog for dirty documents.
  for (let i = 0; i < 10; i++) {
    if (!(await poc('state')).active) break;
    await poc('exec', { command: 'workbench.action.revertAndCloseActiveEditor' });
  }
  await poc('exec', { command: 'workbench.action.closeAllEditors' });
  await poc('open', {
    content: Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n'),
    language: 'plaintext',
  });
  await poc('cursor', { line: 20, char: 0 });
  await sleep(800);
}

const only = process.env.ONLY;
const want = (label) => !only || label.includes(only);
const results = { cps: TYPE_CPS, presets: [], scenarios: [] };
const log = (r) => console.log(JSON.stringify(r));

vs = await launch({ extraExtensions: [ROOT] });
try {
  await freshEditor();
  await sleep(3000); // let start-up work settle
  results.baselineIdle = await window('VS Code idle, KeyBlaze defaults', () =>
    sleep(IDLE_SECONDS * 1000),
  );
  log(results.baselineIdle);

  for (const [label, values] of CONFIGS.filter(([l]) => want(l))) {
    await configure(values);
    await freshEditor();
    const typing = await window(`${label}: typing ${TYPE_CPS} cps`, () => typeFor(TYPE_SECONDS));
    const linger = await window(`${label}: first 1.5 s after typing`, () => sleep(1500));
    await sleep(1000);
    const idle = await window(`${label}: idle 2.5–10.5 s after typing`, () =>
      sleep(IDLE_SECONDS * 1000),
    );
    // Long after typing: the combo badge has gone and a cursor aura has come to rest.
    const settled = await window(`${label}: idle 10.5–18.5 s after typing`, () =>
      sleep(IDLE_SECONDS * 1000),
    );
    const row = { label, typing, linger, idle, settled };
    results.presets.push(row);
    for (const r of [typing, linger, idle, settled]) log(r);
  }

  // Unfocused window, with a looping cursor aura (the only persistent animation).
  if (want('unfocused')) {
    await configure({ 'cursor.effect': 'glow' });
    await freshEditor();
    const focused = await window('glow aura, focused, idle', () => sleep(IDLE_SECONDS * 1000));
    await poc('keyblazeEnv', { id: ID, override: { windowFocused: false } });
    await sleep(500);
    const unfocused = await window('glow aura, window unfocused, idle', () =>
      sleep(IDLE_SECONDS * 1000),
    );
    const stats = await poc('keyblaze', { id: ID });
    results.scenarios.push(
      { ...focused },
      { ...unfocused, auraVisible: stats.cursorEffects.auraVisible },
    );
    log(focused);
    log({ ...unfocused, auraVisible: stats.cursorEffects.auraVisible });
    await poc('keyblazeEnv', { id: ID, override: { windowFocused: true } });
  }

  // Tab switching while bursts are on screen.
  if (want('tabs')) {
    await configure({ preset: 'cosmicExplosion' });
    await freshEditor();
    await poc('open', { content: 'second document\n'.repeat(50), language: 'plaintext' });
    await poc('exec', { command: 'workbench.action.previousEditor' });
    await poc('cursor', { line: 20, char: 0 });
    await sleep(600);
    const r = await window('typing, then switching tabs every 0.5 s', async () => {
      for (let i = 0; i < 8; i++) {
        await typeFor(1);
        await poc('exec', { command: 'workbench.action.nextEditor' });
        await sleep(250);
        await poc('exec', { command: 'workbench.action.previousEditor' });
        await sleep(250);
      }
    });
    await sleep(1500);
    const stats = await poc('keyblaze', { id: ID });
    const idle = await window('after tab switching: idle', () => sleep(IDLE_SECONDS * 1000));
    results.scenarios.push(r, { ...idle, activeBursts: stats.activeBursts });
    log(r);
    log({ ...idle, activeBursts: stats.activeBursts });
  }

  // Control Panel: open (live preview running), hidden behind an editor, closed.
  if (want('panel')) {
    await configure({});
    await freshEditor();
    const before = await window('Control Panel never opened: idle', () =>
      sleep(IDLE_SECONDS * 1000),
    );
    await poc('exec', { command: 'keyblaze.openControlPanel' });
    await sleep(2500);
    const open = await window('Control Panel open and visible (live preview)', () =>
      sleep(IDLE_SECONDS * 1000),
    );
    await poc('exec', { command: 'workbench.action.previousEditor' });
    await sleep(1500);
    const hidden = await window('Control Panel open but behind an editor tab', () =>
      sleep(IDLE_SECONDS * 1000),
    );
    await poc('exec', { command: 'workbench.action.nextEditor' });
    await sleep(1000);
    await poc('exec', { command: 'workbench.action.closeActiveEditor' });
    await sleep(1500);
    const closed = await window('Control Panel closed: idle', () => sleep(IDLE_SECONDS * 1000));
    results.scenarios.push(before, open, hidden, closed);
    for (const r of [before, open, hidden, closed]) log(r);
  }

  // Accessibility: reduced motion and screen-reader optimisation.
  if (want('a11y')) {
    await configure({ preset: 'cosmicExplosion', 'cursor.effect': 'glow' });
    await freshEditor();
    await poc('config', { section: 'workbench', key: 'reduceMotion', value: 'on' });
    await sleep(800);
    const rmType = await window('cosmicExplosion + glow, reduced motion: typing', () =>
      typeFor(TYPE_SECONDS),
    );
    await sleep(1000);
    const rmIdle = await window('cosmicExplosion + glow, reduced motion: idle (static aura)', () =>
      sleep(IDLE_SECONDS * 1000),
    );
    await poc('config', { section: 'workbench', key: 'reduceMotion', value: undefined });
    await poc('config', { section: 'editor', key: 'accessibilitySupport', value: 'on' });
    await sleep(800);
    const srType = await window('cosmicExplosion + glow, screen reader: typing', () =>
      typeFor(TYPE_SECONDS),
    );
    const stats = await poc('keyblaze', { id: ID });
    await poc('config', { section: 'editor', key: 'accessibilitySupport', value: undefined });
    results.scenarios.push(rmType, rmIdle, { ...srType, policy: stats.policy });
    for (const r of [rmType, rmIdle, srType]) log(r);
  }
} finally {
  fs.writeFileSync(
    path.join(RESULTS, `measure-cpu${only ? '-' + only.replace(/\W+/g, '_') : ''}.json`),
    JSON.stringify(results, null, 2),
  );
  await vs.close();
}
