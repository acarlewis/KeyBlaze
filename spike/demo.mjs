// Filmstrip demonstration: real KeyBlaze engine bursts following genuine keystrokes.
import { key, launch, poc, screenshot, sleep, typeText, measure } from './lib.mjs';

const vs = await launch();
try {
  const content = Array.from({ length: 30 }, (_, i) => (i === 8 ? '' : `// context line ${i + 1}: function step${i}(input) { return input * ${i}; }`)).join('\n');
  await poc('open', { content, language: 'plaintext' });
  await poc('cursor', { line: 8, char: 0 });
  await sleep(600);
  const ed = (await measure(vs.cdp)).editors[0];
  const clip = { x: ed.rect.x, y: ed.rect.y + 60, width: 620, height: 220 };
  for (const anchor of ['caret', 'below']) {
    const engine = anchor === 'below'
      ? { effect: 'particles', particleCount: 22, particleSpeed: 1.3, particleLifetime: 900, colors: ['#9b5de5', '#f15bb5', '#fee440', '#00bbf9', '#ffffff'] }
      : {};
    await poc('live', { on: true, overrides: { kind: 'engine', anchor, size: 170, pool: 8, maxPerSec: 12, engine } });
    await typeText(vs.cdp, 'const blaze = ', 70);
    await sleep(900);
    await key(vs.cdp, 'x');
    const t0 = Date.now();
    for (const t of [40, 140, 300, 520]) {
      await sleep(Math.max(0, t - (Date.now() - t0)));
      await screenshot(vs.cdp, `demo-${anchor}-${t}ms`, clip);
    }
    await poc('live', { on: false });
    await sleep(1200);
    await poc('exec', { command: 'cursorHome' });
    await poc('exec', { command: 'cursorEndSelect' });
    await key(vs.cdp, 'Backspace');
  }
} finally {
  await vs.close();
}
