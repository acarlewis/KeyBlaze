// Long-session memory check of the REAL extension: realistic typing with every preset in rotation,
// cursor effects, combos and celebrations, tab switches and the Control Panel opened and closed.
// Samples renderer, extension host and process memory, DOM size, CSS rules and KeyBlaze's own
// bookkeeping once per cycle (after a forced renderer GC).
// Usage: npm run build && node test/visual/soak-memory.mjs   (MINUTES=30 by default)
// Results: spike/results/soak-memory.json. Windows only (process memory via Win32_Process).
import fs from 'node:fs';
import path from 'node:path';
import {
  RESULTS,
  ROOT,
  connect,
  evaluate,
  key,
  launch,
  poc,
  sleep,
  EXTENSION_ID,
} from '../../spike/lib.mjs';
import { memoryByKind, processSnapshot } from './processes.mjs';

const ID = EXTENSION_ID;
const MINUTES = Number(process.env.MINUTES ?? 30);
const CYCLE_SECONDS = 60;
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

const HOST_PORT = 9666;
const vs = await launch({ extraExtensions: [ROOT], inspectExtensionsPort: HOST_PORT });
// The extension host's inspector: lets the soak force a GC there and read the live heap exactly.
const hostTarget = (await (await fetch(`http://127.0.0.1:${HOST_PORT}/json/list`)).json())[0];
const host = await connect(hostTarget.webSocketDebuggerUrl);
await host.send('HeapProfiler.enable');
const samples = [];
const doc = () => Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join('\n');

async function openDocs() {
  // Revert while closing: closeAllEditors would block on a "Save changes?" dialog for dirty documents.
  for (let i = 0; i < 10; i++) {
    const state = await poc('state');
    if (!state.active) break;
    await poc('exec', { command: 'workbench.action.revertAndCloseActiveEditor' });
  }
  await poc('open', { content: 'second document\n'.repeat(80), language: 'plaintext' });
  await poc('open', { content: doc(), language: 'typescript' });
  await poc('cursor', { line: 20, char: 0 });
  await sleep(500);
}

async function sample(cycle, preset) {
  await vs.cdp.send('HeapProfiler.collectGarbage');
  await sleep(500);
  const page = await evaluate(
    vs.cdp,
    `(() => {
      let rules = 0;
      for (const sheet of document.styleSheets) { try { rules += sheet.cssRules.length; } catch {} }
      return { domNodes: document.getElementsByTagName('*').length, cssRules: rules,
               jsHeapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) };
    })()`,
  );
  await host.send('HeapProfiler.collectGarbage');
  const hostHeap = await host.send('Runtime.getHeapUsage');
  const hostMem = await poc('memory');
  const stats = await poc('keyblaze', { id: ID });
  const s = {
    minute: +((Date.now() - started) / 60000).toFixed(1),
    cycle,
    preset,
    ...page,
    extHostHeapAfterGcMB: +(hostHeap.usedSize / 1048576).toFixed(1),
    extHostRssMB: +(hostMem.rss / 1048576).toFixed(1),
    privateMB: memoryByKind(processSnapshot(vs.pid, vs.extensionHostPid)),
    keyblaze: {
      totalBursts: stats.totalBursts,
      activeBursts: stats.activeBursts,
      poolSize: stats.poolSize,
      trackedDocuments: stats.cursorEffects.trackedDocuments,
      flashTypes: stats.flashTypes,
      celebrations: stats.celebrations,
    },
  };
  samples.push(s);
  console.log(JSON.stringify(s));
}

const started = Date.now();
try {
  await vs.cdp.send('HeapProfiler.enable');
  await poc('config', { section: 'keyblaze', key: 'screenShake.enabled', value: true });
  await openDocs();
  await sample(0, 'start');
  for (let cycle = 1; Date.now() - started < MINUTES * 60000; cycle++) {
    const preset = PRESETS[(cycle - 1) % PRESETS.length];
    await poc('config', { section: 'keyblaze', key: 'preset', value: preset });
    // Rotate the palette now and then (exercises cached decoration types).
    if (cycle % 4 === 0) {
      await poc('config', {
        section: 'keyblaze',
        key: 'colors',
        value: cycle % 8 === 0 ? undefined : ['#ff006e', '#8338ec', '#3a86ff'],
      });
    }
    if (cycle % 10 === 0) await openDocs();
    const cycleStart = Date.now();
    // ~40 s of typing at 6 characters/s in sentences, with navigation and tab switches.
    for (let i = 0; i < 240; i++) {
      await key(vs.cdp, 'abcdefghijklmnopqrstuvwxyz '[i % 27]);
      if (i % 60 === 59) await key(vs.cdp, 'Enter');
      if (i % 80 === 79) {
        await key(vs.cdp, 'ArrowUp');
        await key(vs.cdp, 'End');
      }
      if (i % 120 === 119) {
        await poc('exec', { command: 'workbench.action.nextEditor' });
        await sleep(300);
        await poc('exec', { command: 'workbench.action.previousEditor' });
      }
      await sleep(1000 / 6);
    }
    if (cycle % 5 === 0) {
      await poc('exec', { command: 'keyblaze.openControlPanel' });
      await sleep(8000);
      await poc('exec', { command: 'workbench.action.closeActiveEditor' });
    }
    const rest = CYCLE_SECONDS * 1000 - (Date.now() - cycleStart);
    if (rest > 0) await sleep(rest);
    await sample(cycle, preset);
  }
} finally {
  fs.writeFileSync(path.join(RESULTS, 'soak-memory.json'), JSON.stringify(samples, null, 2));
  await vs.close();
}
