// Installs the packaged VSIX into a clean, isolated VS Code and smoke-tests the INSTALLED extension
// (no development path): activation, typing effects, Control Panel and Sound view assets, README.
// Usage: npm run package && node test/visual/verify-vsix.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  RESULTS,
  key,
  launch,
  measureImages,
  poc,
  sleep,
  EXTENSION_ID,
  markFailed,
} from '../../spike/lib.mjs';

const ID = EXTENSION_ID;
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const vsix = path.join(ROOT, `${pkg.name}-${pkg.version}.vsix`);
const version = process.env.KEYBLAZE_VSCODE_VERSION ?? '1.147.0';
const installRoot = path.join(ROOT, '.vscode-test', `vscode-win32-x64-archive-${version}`);
const codeExe = path.join(installRoot, 'Code.exe');
// The CLI is out/cli.js run by Code.exe as Node (newer archives nest resources under a commit folder).
const cliJs = [path.join(installRoot, 'resources', 'app', 'out', 'cli.js')]
  .concat(
    fs
      .readdirSync(installRoot)
      .map((d) => path.join(installRoot, d, 'resources', 'app', 'out', 'cli.js')),
  )
  .find((p) => fs.existsSync(p));
const extDir = path.join(RESULTS, `vsix-extensions-${version}`);
const out = { version, checks: [] };
const check = (name, ok, detail = {}) => {
  out.checks.push({ name, ok: !!ok, detail });
  if (!ok) markFailed();
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};

fs.rmSync(extDir, { recursive: true, force: true });
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^(VSCODE_|ELECTRON_)/.test(k)),
);
const installOut = execFileSync(
  codeExe,
  [cliJs, '--extensions-dir', extDir, '--install-extension', vsix],
  {
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
  },
);
check('VSIX installs with the VS Code CLI', /successfully installed/i.test(installOut), {
  output: installOut.trim().split('\n').pop(),
});

const vs = await launch({ extensionsDir: extDir, keepInstalledExtensions: true });
try {
  const info = await poc('keyblaze', { id: ID }).catch((e) => ({ error: String(e) }));
  check(
    'installed extension activates and exposes its API',
    !info.error && typeof info.totalBursts === 'number',
    info.error ? { error: info.error } : {},
  );

  await poc('open', {
    content: Array.from({ length: 40 }, (_, i) => `const line${i} = ${i};`).join('\n'),
    language: 'typescript',
  });
  await poc('cursor', { line: 10, char: 8 });
  await sleep(800);
  for (const ch of 'abc') {
    await key(vs.cdp, ch);
    await sleep(120);
  }
  await sleep(80);
  const stats = await poc('keyblaze', { id: ID });
  const m = await measureImages(vs.cdp);
  check('typing renders bursts in the editor', stats.totalBursts >= 1 && m.images.length >= 1, {
    bursts: stats.totalBursts,
    images: m.images.length,
  });

  await poc('exec', { command: 'keyblaze.openControlPanel' });
  let panel;
  for (let i = 0; i < 60; i++) {
    panel = (await poc('keyblaze', { id: ID })).controlPanel;
    if (panel.ready > 0) break;
    await sleep(100);
  }
  check('Control Panel webview loads from the package (script + styles)', panel.ready > 0, panel);

  await poc('exec', { command: 'keyblaze.openSoundView' });
  let sound;
  for (let i = 0; i < 60; i++) {
    sound = (await poc('keyblaze', { id: ID })).sound;
    if (sound.resolved) break;
    await sleep(100);
  }
  check('Sound view loads from the package', sound.resolved, sound);

  // vsce normalises names: readme.md, changelog.md, LICENSE.txt.
  const readme = path.join(
    extDir,
    fs.readdirSync(extDir).find((d) => d.toLowerCase().startsWith(ID.toLowerCase())) ?? '',
    'readme.md',
  );
  const installed = fs.readdirSync(path.dirname(readme)).map((f) => f.toLowerCase());
  check(
    'README, CHANGELOG and LICENSE are installed',
    ['readme.md', 'changelog.md'].every((f) => installed.includes(f)) &&
      installed.some((f) => f.startsWith('license')),
    { installed },
  );
  const files = [];
  const walk = (d) =>
    fs
      .readdirSync(d, { withFileTypes: true })
      .forEach((e) =>
        e.isDirectory()
          ? walk(path.join(d, e.name))
          : files.push(path.relative(path.dirname(readme), path.join(d, e.name))),
      );
  walk(path.dirname(readme));
  check(
    'no sources, tests, maps or spike code are packaged',
    !files.some((f) => /^(src|test|spike|out|node_modules)[\/]|\.map$|\.ts$/.test(f)),
    { files: files.length },
  );
} catch (err) {
  out.error = String(err?.stack ?? err);
  console.error(err);
  markFailed();
} finally {
  fs.writeFileSync(path.join(RESULTS, `verify-vsix-${version}.json`), JSON.stringify(out, null, 2));
  await vs.close();
}
