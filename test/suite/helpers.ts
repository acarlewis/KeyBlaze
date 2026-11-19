import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { KeyBlazeApi } from '../../src/extension';

const root = path.resolve(__dirname, '../../..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  name: string;
  publisher: string;
  contributes: { commands: { command: string }[] };
};

export const EXTENSION_ID = `${pkg.publisher}.${pkg.name}`;
export const CONTRIBUTED_COMMANDS = pkg.contributes.commands.map((c) => c.command);

let pinned = false;

/**
 * Returns the extension's test API. The test window may not have OS focus (tests run in the
 * background), which KeyBlaze treats as "paused", so focus is pinned once for deterministic tests.
 * The unfocused behaviour has its own test that overrides this.
 */
export async function getApi(): Promise<KeyBlazeApi> {
  const ext = vscode.extensions.getExtension<KeyBlazeApi>(EXTENSION_ID);
  if (!ext) throw new Error(`Extension ${EXTENSION_ID} not found`);
  const api = ext.isActive ? ext.exports : await ext.activate();
  if (!pinned) {
    api.setEnvironmentOverride({ windowFocused: true });
    await normalizeLayout();
    pinned = true;
  }
  return api;
}

/**
 * Gives every VS Code version the same editor area: VS Code 1.147 opens the Chat secondary side bar by
 * default and the panel may be open, which shrinks the editor on small CI displays (1024×768 Windows
 * runners, xvfb). Placement depends on how many lines are visible, so tests must not depend on that.
 */
export async function normalizeLayout(): Promise<void> {
  for (const command of ['workbench.action.closeAuxiliaryBar', 'workbench.action.closePanel']) {
    try {
      await vscode.commands.executeCommand(command);
    } catch {
      // Command not available in this VS Code version: nothing to close.
    }
  }
}

/**
 * Fails with a clear message when the editor doesn't show lines `from`..`to`. Placement legitimately
 * falls back to `notVisible` in a too-small window, so a test expecting another outcome must first
 * prove that the window is large enough rather than report a misleading reason.
 */
export async function assertLinesVisible(
  editor: vscode.TextEditor,
  from: number,
  to: number,
  timeoutMs = 3000,
): Promise<void> {
  // visibleRanges reaches the extension host asynchronously after a reveal (slowly for very large
  // documents), so wait for the scroll to land before judging whether the window is big enough.
  const covered = (): boolean =>
    editor.visibleRanges.some((r) => r.start.line <= from && r.end.line >= to);
  const deadline = Date.now() + timeoutMs;
  while (!covered() && Date.now() < deadline) await wait(50);
  const ranges = editor.visibleRanges.map((r) => [r.start.line, r.end.line] as const);
  const ok = covered();
  assert.ok(
    ok,
    `test precondition: lines ${from}-${to} must be visible, but the editor shows ` +
      `${JSON.stringify(ranges)} (window too small for this scenario)`,
  );
}

/**
 * Upper bound for events that are rate-limited with a minimum gap: in `elapsedMs`, at most one event
 * plus one per full gap can pass. Assertions use this instead of assuming how fast keystrokes arrive.
 */
export function maxPaced(elapsedMs: number, minGapMs: number): number {
  return 1 + Math.floor(elapsedMs / minGapMs);
}

export function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('keyblaze');
}

export async function resetSettings(): Promise<void> {
  await vscode.commands.executeCommand('keyblaze.resetSettings', { skipConfirmation: true });
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls until `predicate` is true or the timeout elapses. */
export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000,
  label = 'condition',
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await wait(20);
  }
}

export async function openFixture(
  name: string,
  column = vscode.ViewColumn.One,
): Promise<vscode.TextEditor> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error('Test workspace folder missing');
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, name));
  return vscode.window.showTextDocument(doc, { viewColumn: column, preview: false });
}

/** Simulates real keyboard input through VS Code's `type` command. */
export async function typeText(text: string, delayMs = 0): Promise<void> {
  for (const ch of text) {
    await vscode.commands.executeCommand('type', { text: ch });
    if (delayMs) await wait(delayMs);
  }
}

/** Places a single caret at line/character (0-based) and waits for the editor to settle. */
export async function placeCaret(
  editor: vscode.TextEditor,
  line: number,
  character: number,
  reveal: vscode.TextEditorRevealType = vscode.TextEditorRevealType.InCenter,
): Promise<void> {
  const pos = new vscode.Position(line, character);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), reveal);
  await wait(150);
}

export async function closeAllEditors(): Promise<void> {
  // Revert each dirty editor so no "Save changes?" dialog can block the test run.
  for (let i = 0; i < 20 && vscode.window.visibleTextEditors.length > 0; i++) {
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  }
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}
