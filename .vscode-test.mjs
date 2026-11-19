import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/suite/**/*.test.js',
  version: process.env.KEYBLAZE_VSCODE_VERSION ?? 'stable',
  workspaceFolder: './test/fixtures/workspace',
  launchArgs: ['--disable-extensions'],
  mocha: { ui: 'tdd', timeout: 20000 },
});
