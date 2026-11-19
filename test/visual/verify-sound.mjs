// Real sound check: open the KeyBlaze Sound view, unlock audio with a genuine click, and confirm the
// webview schedules synthesised sounds (it acknowledges each play while the AudioContext is running).
// Usage: npm run build && node test/visual/verify-sound.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, RESULTS, key, launch, poc, screenshot, sleep } from '../../spike/lib.mjs';

const ID = 'your-publisher-id.keyblaze';
const out = { checks: [] };
const check = (name, ok, detail = {}) => {
  out.checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const stats = async () => (await poc('keyblaze', { id: ID })).sound;
const click = async (vs, x, y) => {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await vs.cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
};

const vs = await launch({ extraExtensions: [ROOT] });
try {
  await poc('keyblazeEnv', { id: ID, override: { windowFocused: true } });
  await poc('exec', { command: 'keyblaze.openSoundView' });
  for (let i = 0; i < 50 && !(await stats()).resolved; i++) await sleep(100);
  await sleep(800);
  check('sound view resolved', (await stats()).resolved, await stats());
  await screenshot(vs.cdp, 'sound-view-locked');
  const target = JSON.parse(process.env.ENABLE_AT ?? 'null');
  if (target) {
    await click(vs, target[0], target[1]);
    await sleep(600);
    check('audio unlocked by a real click', (await stats()).audio === 'running', await stats());
    await screenshot(vs.cdp, 'sound-view-unlocked');
    for (const [k, v] of [
      ['combo.milestones', [3]],
      ['combo.resetTime', 2000],
    ]) {
      await poc('config', { section: 'keyblaze', key: k, value: v });
    }
    await poc('open', { content: 'const x = 1;\n'.repeat(30), language: 'plaintext' });
    await poc('cursor', { line: 5, char: 3 });
    await sleep(500);
    const before = await stats();
    for (const ch of 'abc') {
      await key(vs.cdp, ch);
      await sleep(80);
    }
    await sleep(600);
    const after = await stats();
    check(
      'milestone sound sent and actually scheduled by WebAudio',
      after.sent > before.sent && after.played > before.played,
      { before, after },
    );
  }
} catch (err) {
  out.error = String(err?.stack ?? err);
  console.error(err);
} finally {
  fs.writeFileSync(path.join(RESULTS, 'verify-sound.json'), JSON.stringify(out, null, 2));
  await vs.close();
}
