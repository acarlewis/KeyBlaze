// Captures README screenshots: every preset while typing in a real VS Code (several bursts in flight).
// Usage: npm run build && node test/visual/capture-gallery.mjs   → docs/images/presets/*.png
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, key, launch, measure, poc, sleep } from '../../spike/lib.mjs';

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
const OUT = path.join(ROOT, 'docs', 'images', 'presets');
const code = [
  'import { blaze } from "./keyblaze";',
  '',
  'export function onKeystroke(combo: number) {',
  '  const heat = Math.min(1, combo / 100);',
  '  const effect = heat > 0.5 ? "fireworks" : "sparks";',
  '  ',
  '  return blaze({ effect, heat });',
  '}',
  '',
  ...Array.from({ length: 30 }, () => ''),
].join('\n');

const vs = await launch({ extraExtensions: [ROOT], width: 1200, height: 800 });
try {
  await poc('open', { content: code, language: 'typescript' });
  await poc('config', { section: 'editor', key: 'fontSize', value: 15 });
  // No IntelliSense popups in the screenshots.
  await poc('config', {
    section: 'editor',
    key: 'quickSuggestions',
    value: { other: false, comments: false, strings: false },
  });
  await poc('config', { section: 'editor', key: 'suggestOnTriggerCharacters', value: false });
  await poc('config', { section: 'editor', key: 'wordBasedSuggestions', value: 'off' });
  await poc('config', { section: 'keyblaze', key: 'performance.maxBurstsPerSecond', value: 20 });
  await sleep(1500);
  fs.mkdirSync(OUT, { recursive: true });
  for (const preset of PRESETS) {
    await poc('config', { section: 'keyblaze', key: 'preset', value: preset });
    await poc('cursor', { line: 5, char: 2 });
    await sleep(900);
    for (const ch of 'const blaze') {
      await key(vs.cdp, ch);
      await sleep(75);
    }
    await sleep(40);
    const caret = (await measure(vs.cdp)).editors.find((e) => e.cursor)?.cursor;
    const clip = {
      x: Math.max(0, caret.x - 165),
      y: caret.y - 105,
      width: 360,
      height: 210,
      scale: 1.5,
    };
    const shot = await vs.cdp.send('Page.captureScreenshot', { format: 'png', clip });
    fs.writeFileSync(path.join(OUT, `gallery-${preset}.png`), Buffer.from(shot.data, 'base64'));
    console.log('captured', preset);
    await sleep(1100);
    await poc('exec', { command: 'cursorHome' });
    await poc('exec', { command: 'cursorEndSelect' });
    await key(vs.cdp, 'Backspace');
    await key(vs.cdp, ' ');
    await key(vs.cdp, ' ');
    await sleep(700);
  }
} finally {
  await vs.close();
}
