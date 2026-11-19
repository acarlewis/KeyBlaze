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

export async function getApi(): Promise<KeyBlazeApi> {
  const ext = vscode.extensions.getExtension<KeyBlazeApi>(EXTENSION_ID);
  if (!ext) throw new Error(`Extension ${EXTENSION_ID} not found`);
  return ext.isActive ? ext.exports : ext.activate();
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
): Promise<void> {
  const pos = new vscode.Position(line, character);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  await wait(150);
}

export async function closeAllEditors(): Promise<void> {
  // Revert each dirty editor so no "Save changes?" dialog can block the test run.
  for (let i = 0; i < 20 && vscode.window.visibleTextEditors.length > 0; i++) {
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  }
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}
