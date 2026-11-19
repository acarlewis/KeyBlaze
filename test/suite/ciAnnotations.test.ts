/**
 * On GitHub Actions, reports every failing integration test as an `::error` workflow annotation.
 * Job logs require authentication even for public repositories; annotations don't, so the exact
 * failure (test name and assertion message) is visible on the run page and through the public API.
 * Root-level hook: applies to every test in every suite. It never changes a test's outcome.
 */
import * as vscode from 'vscode';

function escapeData(s: string): string {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function escapeProperty(s: string): string {
  return escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

teardown(function () {
  if (!process.env.GITHUB_ACTIONS) return;
  const test = this.currentTest;
  if (!test || test.state !== 'failed') return;
  const err = (test as unknown as { err?: unknown }).err;
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : JSON.stringify(err ?? 'failed');
  const title = `${process.platform} · VS Code ${vscode.version} · ${test.fullTitle()}`;
  console.log(
    `::error title=${escapeProperty(title.slice(0, 250))}::${escapeData(message.slice(0, 2000))}`,
  );
});
