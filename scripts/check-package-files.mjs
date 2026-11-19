// Release guard: verifies the exact file list `vsce` will package.
// Every packaged file must match the allowlist (no sources, tests, maps or dev tooling), and every
// required file must be present. Run after `npm run build:prod` (CI and the publish workflow do).
// Usage: node scripts/check-package-files.mjs
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vsceBin = path.join(root, 'node_modules', '@vscode', 'vsce', 'vsce');
const out = execFileSync(process.execPath, [vsceBin, 'ls'], { cwd: root, encoding: 'utf8' });
const files = out
  .split(/\r?\n/)
  .map((f) => f.trim().replace(/\\/g, '/'))
  .filter((f) => f && !f.startsWith('WARNING') && !f.includes(' '));

const allowed = [
  /^package\.json$/,
  /^README\.md$/,
  /^CHANGELOG\.md$/,
  /^LICENSE(\.txt)?$/,
  /^dist\/extension\.js$/,
  /^dist\/webview\/(controlPanel|sound)\.js$/,
  /^media\/icons\/[^/]+\.png$/,
  /^media\/styles\/[^/]+\.css$/,
  /^media\/logo\/(Full_Logo|Light_Background_application)\.png$/,
];
const required = [
  'package.json',
  'README.md',
  'CHANGELOG.md',
  'dist/extension.js',
  'dist/webview/controlPanel.js',
  'dist/webview/sound.js',
  'media/icons/icon.png',
  'media/styles/controlPanel.css',
  'media/styles/sound.css',
  'media/logo/Full_Logo.png',
  'media/logo/Light_Background_application.png',
];

const unexpected = files.filter((f) => !allowed.some((re) => re.test(f)));
const missing = required.filter((f) => !files.includes(f));
const hasLicense = files.some((f) => /^LICENSE(\.txt)?$/.test(f));

console.log(`vsce would package ${files.length} files:`);
for (const f of files) console.log(`  ${f}`);
if (unexpected.length)
  console.error(`\nUnexpected files (not on the allowlist):\n  ${unexpected.join('\n  ')}`);
if (missing.length) console.error(`\nMissing required files:\n  ${missing.join('\n  ')}`);
if (!hasLicense) console.error('\nMissing LICENSE');
if (unexpected.length || missing.length || !hasLicense) {
  process.exitCode = 1;
} else {
  console.log('\nPackage contents OK.');
}
