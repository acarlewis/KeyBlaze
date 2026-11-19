// Visual verification of the Control Panel in a real VS Code: renders, round-trips messages, animates
// the preview, and works in dark, light and high-contrast themes.
// Usage: npm run build && node test/visual/verify-panel.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, RESULTS, launch, poc, screenshot, sleep, EXTENSION_ID } from '../../spike/lib.mjs';

const ID = EXTENSION_ID;
const out = { checks: [] };
const check = (name, ok, detail = {}) => {
  out.checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};

/** Mean absolute pixel difference between two PNG screenshots of the same region (via the page itself). */
async function frameDiff(vs, clip) {
  const a = (
    await vs.cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } })
  ).data;
  await sleep(400);
  const b = (
    await vs.cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } })
  ).data;
  const r = await vs.cdp.send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      const load = async (d) => { const bytes = Uint8Array.from(atob(d), (c) => c.charCodeAt(0)); return createImageBitmap(new Blob([bytes], { type: 'image/png' })); };
      const [x, y] = await Promise.all([load(${JSON.stringify(a)}), load(${JSON.stringify(b)})]);
      const c = new OffscreenCanvas(x.width, x.height); const g = c.getContext('2d');
      g.drawImage(x, 0, 0); const da = g.getImageData(0, 0, x.width, x.height).data;
      g.clearRect(0, 0, x.width, x.height); g.drawImage(y, 0, 0); const db = g.getImageData(0, 0, x.width, x.height).data;
      let diff = 0; for (let i = 0; i < da.length; i += 4) diff += Math.abs(da[i] - db[i]) + Math.abs(da[i+1] - db[i+1]) + Math.abs(da[i+2] - db[i+2]);
      return diff / (da.length / 4);
    })()`,
  });
  return r.result.value;
}

const vs = await launch({ extraExtensions: [ROOT], width: 1400, height: 900 });
try {
  await poc('exec', { command: 'keyblaze.openControlPanel' });
  let stats;
  for (let i = 0; i < 50; i++) {
    stats = (await poc('keyblaze', { id: ID })).controlPanel;
    if (stats.ready > 0) break;
    await sleep(100);
  }
  check(
    'panel opened and webview script reported ready (real round trip)',
    stats.open && stats.ready > 0,
    stats,
  );
  check('host posted state to the webview', stats.statesPosted > 0, {
    statesPosted: stats.statesPosted,
  });
  await sleep(1200);
  await screenshot(vs.cdp, 'panel-dark-dashboard');

  const diff = await frameDiff(vs, { x: 900, y: 150, width: 440, height: 240 });
  check('live preview is animating', diff > 0.05, { meanPixelDiff: +diff.toFixed(3) });

  // A settings change made outside the panel is pushed to it.
  const before = (await poc('keyblaze', { id: ID })).controlPanel.statesPosted;
  await poc('config', { section: 'keyblaze', key: 'preset', value: 'neonEnergy' });
  await sleep(500);
  const after = (await poc('keyblaze', { id: ID })).controlPanel.statesPosted;
  check('external settings changes are pushed to the panel', after > before, { before, after });
  await sleep(800);
  await screenshot(vs.cdp, 'panel-dark-neon');

  // Real mouse clicks on the tabs (the webview is an isolated iframe).
  const click = async (x, y) => {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await vs.cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    }
  };
  for (const [name, x] of [
    ['effects', 198],
    ['personalization', 290],
    ['performance', 400],
    ['about', 484],
  ]) {
    await click(x, 146);
    await sleep(500);
    await screenshot(vs.cdp, `panel-tab-${name}`);
  }
  await click(198, 146);
  await sleep(400);

  // Interaction: Preview must not apply; Apply must; a slider click must write an override.
  await click(404, 334); // Firestorm "Preview"
  await sleep(500);
  check(
    'preset Preview does not change settings',
    (await poc('keyblazeSettings', { id: ID })).preset === 'neonEnergy',
  );
  await click(332, 334); // Firestorm "Apply"
  for (let i = 0; i < 20 && (await poc('keyblazeSettings', { id: ID })).preset !== 'firestorm'; i++)
    await sleep(100);
  const applied = await poc('keyblazeSettings', { id: ID });
  check(
    'preset Apply changes the preset and its values',
    applied.preset === 'firestorm' && applied.effect === 'fire',
    { preset: applied.preset, effect: applied.effect },
  );
  await sleep(600);
  await screenshot(vs.cdp, 'panel-firestorm-applied');
  await click(800, 853); // Intensity slider, near the right end
  for (
    let i = 0;
    i < 20 && (await poc('keyblazeSettings', { id: ID })).intensity === applied.intensity;
    i++
  )
    await sleep(100);
  const slid = await poc('keyblazeSettings', { id: ID });
  check('slider writes the setting', slid.intensity > applied.intensity, {
    before: applied.intensity,
    after: slid.intensity,
  });
  await sleep(400);
  await screenshot(vs.cdp, 'panel-slider-override');
  await poc('config', { section: 'keyblaze', key: 'intensity', value: undefined });

  for (const [theme, name] of [
    ['Default Light Modern', 'light'],
    ['Default High Contrast', 'hc'],
  ]) {
    await poc('config', { section: 'workbench', key: 'colorTheme', value: theme });
    await sleep(1500);
    await screenshot(vs.cdp, `panel-${name}`);
  }
  await poc('config', { section: 'workbench', key: 'colorTheme', value: 'Default Dark Modern' });
  await poc('config', { section: 'keyblaze', key: 'preset', value: undefined });
} catch (err) {
  out.error = String(err?.stack ?? err);
  console.error(err);
} finally {
  fs.writeFileSync(path.join(RESULTS, 'verify-panel.json'), JSON.stringify(out, null, 2));
  await vs.close();
}
