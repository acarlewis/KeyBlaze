// Reproduces the integration test "word wrap falls back when a spanned line could wrap" at several
// screen sizes (CI runners have small displays: xvfb defaults to 640x480, Windows runners 1024x768).
// Usage: npm run build && node test/visual/repro-viewport.mjs
import fs from 'node:fs';
import path from 'node:path';
import { EXTENSION_ID, ROOT, key, launch, poc, sleep } from '../../spike/lib.mjs';

const fixture = fs.readFileSync(
  path.join(ROOT, 'test', 'fixtures', 'workspace', 'long.ts'),
  'utf8',
);
const sizes = (process.env.SIZES ?? '640x480,800x600,1024x768,1400x900')
  .split(',')
  .map((s) => s.split('x').map(Number));

for (const [width, height] of sizes) {
  // Default layout (secondary side bar at its default), like a fresh CI profile.
  const vs = await launch({
    extraExtensions: [ROOT],
    width,
    height,
    settings: { 'workbench.secondarySideBar.defaultVisibility': 'visibleInWorkspace' },
  });
  try {
    await poc('config', { section: 'editor', key: 'wordWrap', value: 'on' });
    await poc('config', { section: 'keyblaze', key: 'performance.maxBurstsPerSecond', value: 30 });
    await poc('open', { content: fixture, language: 'typescript' });
    if (process.env.SIDEBARS) {
      // Workspace windows show the Explorer; VS Code 1.147 also opens the Chat secondary side bar by default.
      await poc('exec', { command: 'workbench.view.explorer' });
      await poc('exec', { command: 'workbench.action.focusAuxiliaryBar' }).catch(() => {});
      await poc('exec', { command: 'workbench.action.focusActiveEditorGroup' });
      await sleep(600);
    }
    await poc('cursor', {
      line: 23,
      char: 5,
      reveal: Number(process.env.REVEAL ?? 2) /* 2 InCenter, 3 AtTop */,
    });
    await sleep(700);
    const before = await poc('state');
    await key(vs.cdp, 'z');
    await sleep(300);
    const stats = await poc('keyblaze', { id: EXTENSION_ID });
    console.log(
      JSON.stringify({
        screen: `${width}x${height}`,
        decision: stats.lastBurst?.decisions?.[0],
        visibleRanges: before.active.visibleRanges,
        sidebars: !!process.env.SIDEBARS,
      }),
    );
  } finally {
    await vs.close();
  }
}
