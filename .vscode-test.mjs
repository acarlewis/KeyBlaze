import { defineConfig } from '@vscode/test-cli';

// Two labelled configurations: current stable and the minimum supported version (package.json engines).
// `npm run test:integration` runs `stable`, `npm run test:min-vscode` runs `minimum`.
const common = {
  files: 'out/test/suite/**/*.test.js',
  workspaceFolder: './test/fixtures/workspace',
  launchArgs: ['--disable-extensions'],
  mocha: { ui: 'tdd', timeout: 20000 },
};

export default defineConfig([
  { label: 'stable', version: process.env.KEYBLAZE_VSCODE_VERSION ?? 'stable', ...common },
  { label: 'minimum', version: '1.90.0', ...common },
]);
