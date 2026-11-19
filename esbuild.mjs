// Bundles the extension host code (Node, CJS) and the Control Panel webview (browser, IIFE).
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').Plugin} */
const problemMatcherPlugin = {
  name: 'problem-matcher',
  setup(build) {
    build.onStart(() => console.log('[esbuild] build started'));
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        if (location) console.error(`    ${location.file}:${location.line}:${location.column}:`);
      }
      console.log('[esbuild] build finished');
    });
  },
};

const webview = await esbuild.context({
  entryPoints: ['src/webview/controlPanel.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/webview/controlPanel.js',
  sourcemap: !production,
  sourcesContent: false,
  minify: production,
  logLevel: 'silent',
  plugins: [problemMatcherPlugin],
});

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: !production,
  sourcesContent: false,
  minify: production,
  logLevel: 'silent',
  plugins: [problemMatcherPlugin],
});

if (watch) {
  await Promise.all([ctx.watch(), webview.watch()]);
} else {
  await Promise.all([ctx.rebuild(), webview.rebuild()]);
  await Promise.all([ctx.dispose(), webview.dispose()]);
}
