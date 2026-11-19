import * as assert from 'assert';
import * as vscode from 'vscode';
import type { KeystrokeEvent } from '../../src/services/TypingDetector';
import {
  CONTRIBUTED_COMMANDS,
  EXTENSION_ID,
  closeAllEditors,
  config,
  getApi,
  openFixture,
  resetSettings,
  typeText,
  wait,
  waitFor,
} from './helpers';

suite('Activation', () => {
  test('extension is present and activates', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, 'extension not found');
    const api = await getApi();
    assert.ok(ext.isActive);
    assert.strictEqual(typeof api.getSettings, 'function');
  });

  test('every contributed command is registered', async () => {
    await getApi();
    const all = await vscode.commands.getCommands(true);
    for (const id of CONTRIBUTED_COMMANDS) assert.ok(all.includes(id), `${id} not registered`);
  });
});

suite('Commands and configuration', () => {
  setup(resetSettings);
  suiteTeardown(resetSettings);

  test('enable / disable / toggle update the setting and status bar', async () => {
    const api = await getApi();
    await vscode.commands.executeCommand('keyblaze.disable');
    assert.strictEqual(config().get('enabled'), false);
    assert.strictEqual(api.getSettings().enabled, false);
    assert.ok(api.getStats().statusText.includes('circle-slash'));

    await vscode.commands.executeCommand('keyblaze.enable');
    assert.strictEqual(api.getSettings().enabled, true);
    assert.ok(api.getStats().statusText.includes('flame'));

    await vscode.commands.executeCommand('keyblaze.toggle');
    assert.strictEqual(api.getSettings().enabled, false);
    await vscode.commands.executeCommand('keyblaze.toggle');
    assert.strictEqual(api.getSettings().enabled, true);
  });

  test('external configuration changes apply live', async () => {
    const api = await getApi();
    await config().update('particleCount', 42, vscode.ConfigurationTarget.Global);
    await waitFor(() => api.getSettings().particleCount === 42, 3000, 'live config');
  });

  test('changeEffect with an argument sets the effect', async () => {
    const api = await getApi();
    await vscode.commands.executeCommand('keyblaze.changeEffect', 'lightning');
    assert.strictEqual(api.getSettings().effect, 'lightning');
  });

  test('next / previous effect cycle through effects', async () => {
    const api = await getApi();
    await vscode.commands.executeCommand('keyblaze.changeEffect', 'minimal');
    await vscode.commands.executeCommand('keyblaze.nextEffect');
    assert.strictEqual(api.getSettings().effect, 'particles');
    await vscode.commands.executeCommand('keyblaze.previousEffect');
    assert.strictEqual(api.getSettings().effect, 'minimal');
  });

  test('applyPreset activates the preset and clears conflicting overrides', async () => {
    const api = await getApi();
    await vscode.commands.executeCommand('keyblaze.changeEffect', 'stars');
    await vscode.commands.executeCommand('keyblaze.applyPreset', 'firestorm');
    const s = api.getSettings();
    assert.strictEqual(s.preset, 'firestorm');
    assert.strictEqual(s.effect, 'fire');
    assert.strictEqual(config().inspect('effect')?.globalValue, undefined);
  });

  test('resetSettings clears all user values', async () => {
    const api = await getApi();
    await config().update('intensity', 9, vscode.ConfigurationTarget.Global);
    await config().update('enabled', false, vscode.ConfigurationTarget.Global);
    await resetSettings();
    assert.strictEqual(config().inspect('intensity')?.globalValue, undefined);
    assert.strictEqual(api.getSettings().enabled, true);
    assert.strictEqual(api.getSettings().intensity, 5);
  });

  test('invalid user values are ignored gracefully', async () => {
    const api = await getApi();
    await config().update('effect', 'not-an-effect', vscode.ConfigurationTarget.Global);
    await waitFor(() => api.getSettings().effect === 'particles', 3000, 'fallback');
  });
});

suite('Typing detection and rendering', () => {
  const events: KeystrokeEvent[] = [];
  let subscription: vscode.Disposable | undefined;

  suiteSetup(async () => {
    const api = await getApi();
    subscription = api.onKeystroke((e) => events.push(e));
  });
  setup(async () => {
    events.length = 0;
    await resetSettings();
  });
  teardown(closeAllEditors);
  suiteTeardown(async () => {
    subscription?.dispose();
    await resetSettings();
  });

  test('typing produces keystrokes and bursts', async () => {
    const api = await getApi();
    const editor = await openFixture('sample.ts');
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    const before = api.getStats().totalBursts;
    await typeText('abc');
    await waitFor(() => events.length === 3, 3000, 'keystrokes');
    assert.deepStrictEqual(
      events.map((e) => e.positions[0]?.character),
      [1, 2, 3],
    );
    assert.strictEqual(api.getStats().totalBursts - before, 3);
    assert.ok(api.getStats().activeBursts > 0);
  });

  test('bursts expire after their lifetime', async () => {
    const api = await getApi();
    await config().update('particleLifetime', 150, vscode.ConfigurationTarget.Global);
    await openFixture('sample.ts');
    await typeText('x');
    await waitFor(() => api.getStats().activeBursts > 0, 2000, 'burst start');
    await waitFor(() => api.getStats().activeBursts === 0, 2000, 'burst expiry');
  });

  test('pool never exceeds maxConcurrentBursts', async () => {
    const api = await getApi();
    await config().update('performance.maxConcurrentBursts', 2, vscode.ConfigurationTarget.Global);
    await waitFor(() => api.getStats().poolSize === 2, 2000, 'pool resize');
    await openFixture('sample.ts');
    await typeText('abcdef');
    assert.ok(api.getStats().activeBursts <= 2);
  });

  test('maxBurstsPerSecond throttles rendering but not detection', async () => {
    const api = await getApi();
    await config().update('performance.maxBurstsPerSecond', 2, vscode.ConfigurationTarget.Global);
    await wait(1100); // let the previous test's rate window drain
    await openFixture('sample.ts');
    const before = api.getStats().totalBursts;
    await typeText('abcde');
    await waitFor(() => events.length === 5, 3000, 'keystrokes');
    assert.strictEqual(api.getStats().totalBursts - before, 2);
  });

  test('programmatic multi-character edits are ignored', async () => {
    const editor = await openFixture('sample.ts');
    await editor.edit((b) => b.insert(new vscode.Position(0, 0), 'pasted text'));
    await wait(200);
    assert.strictEqual(events.length, 0);
  });

  test('undo is ignored', async () => {
    await openFixture('sample.ts');
    await typeText('q');
    await waitFor(() => events.length === 1, 3000, 'keystroke');
    await vscode.commands.executeCommand('undo');
    await wait(200);
    assert.strictEqual(events.length, 1);
  });

  test('disabled → no bursts', async () => {
    const api = await getApi();
    await vscode.commands.executeCommand('keyblaze.disable');
    await openFixture('sample.ts');
    const before = api.getStats().totalBursts;
    await typeText('zz');
    await wait(200);
    assert.strictEqual(api.getStats().totalBursts, before);
  });

  test('excluded languages produce no keystrokes', async () => {
    await config().update('excludeLanguages', ['plaintext'], vscode.ConfigurationTarget.Global);
    await openFixture('notes.txt');
    await typeText('a');
    await wait(200);
    assert.strictEqual(events.length, 0);
  });

  test('excluded file globs produce no keystrokes', async () => {
    await config().update('excludeFiles', ['**/sample.ts'], vscode.ConfigurationTarget.Global);
    await openFixture('sample.ts');
    await typeText('a');
    await wait(200);
    assert.strictEqual(events.length, 0);
  });

  test('split editors: effects go to the editor being typed in', async () => {
    await openFixture('sample.ts', vscode.ViewColumn.One);
    const right = await openFixture('sample.ts', vscode.ViewColumn.Two);
    assert.strictEqual(vscode.window.visibleTextEditors.length, 2);
    await typeText('k');
    await waitFor(() => events.length === 1, 3000, 'keystroke');
    assert.strictEqual(events[0]?.editor, right);
    assert.strictEqual(events[0]?.editor.viewColumn, vscode.ViewColumn.Two);
  });

  test('multi-cursor typing reports one keystroke per cursor position', async () => {
    const editor = await openFixture('notes.txt');
    editor.selections = [new vscode.Selection(0, 0, 0, 0), new vscode.Selection(0, 5, 0, 5)];
    await typeText('m');
    await waitFor(() => events.length === 1, 3000, 'keystroke');
    assert.deepStrictEqual(
      events[0]?.positions.map((p) => p.character),
      [1, 7],
    );
  });

  test('previewEffect renders bursts in the active editor', async () => {
    const api = await getApi();
    await openFixture('sample.ts');
    const before = api.getStats().totalBursts;
    await vscode.commands.executeCommand('keyblaze.previewEffect');
    assert.strictEqual(api.getStats().totalBursts - before, 5);
  });

  test('previewEffect without an editor does not throw', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand('keyblaze.previewEffect');
  });
});
