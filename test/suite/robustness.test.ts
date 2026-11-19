import * as assert from 'assert';
import * as vscode from 'vscode';
import { createKeyBlaze } from '../../src/extension';
import type { KeystrokeEvent } from '../../src/services/TypingDetector';
import type { Logger } from '../../src/utils/logger';
import { safely } from '../../src/utils/logger';
import {
  EXTENSION_ID,
  closeAllEditors,
  config,
  getApi,
  openFixture,
  placeCaret,
  resetSettings,
  typeText,
  wait,
  waitFor,
} from './helpers';

/** Minimal in-memory Memento for isolated instances. */
class MemoryMemento implements vscode.Memento {
  private readonly data = new Map<string, unknown>();
  keys(): readonly string[] {
    return [...this.data.keys()];
  }
  get<T>(key: string, defaultValue?: T): T | undefined {
    const value: unknown = this.data.has(key) ? this.data.get(key) : defaultValue;
    return value as T | undefined;
  }
  update(key: string, value: unknown): Thenable<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }
}

suite('Deactivation and disposal', () => {
  setup(resetSettings);
  teardown(closeAllEditors);

  test('disposing an instance removes every listener: it goes silent and stays error-free', async () => {
    await getApi();
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    const subscriptions: { dispose(): unknown }[] = [];
    const isolated = createKeyBlaze(
      {
        subscriptions,
        globalState: new MemoryMemento() as unknown as vscode.ExtensionContext['globalState'],
        extensionUri: ext.extensionUri,
        extension: ext,
      },
      { registerGlobals: false, logName: 'KeyBlaze (isolated test instance)' },
    );
    isolated.setEnvironmentOverride({ windowFocused: true });
    await config().update('performance.maxBurstsPerSecond', 30, vscode.ConfigurationTarget.Global);
    const editor = await openFixture('long.ts');
    await placeCaret(editor, 10, 12);

    await typeText('ab', 60);
    await waitFor(() => isolated.getStats().totalBursts >= 1, 2000, 'isolated instance renders');
    assert.ok(subscriptions.length > 10, 'everything is registered on the context');

    for (const d of subscriptions) d.dispose();
    const after = isolated.getStats().totalBursts;
    const combo = isolated.getStats().combo.count;
    await typeText('cd', 60);
    await wait(300);
    assert.strictEqual(isolated.getStats().totalBursts, after, 'no bursts after disposal');
    assert.strictEqual(isolated.getStats().combo.count, combo, 'no combo counting after disposal');

    // Disposing twice is harmless.
    for (const d of subscriptions) d.dispose();
  });
});

suite('Edits that are not typing', () => {
  const events: KeystrokeEvent[] = [];
  let sub: vscode.Disposable | undefined;
  suiteSetup(async () => {
    sub = (await getApi()).onKeystroke((e) => events.push(e));
  });
  setup(async () => {
    events.length = 0;
    await resetSettings();
  });
  teardown(closeAllEditors);
  suiteTeardown(() => {
    sub?.dispose();
  });

  test('paste is ignored', async () => {
    const editor = await openFixture('notes.txt');
    await placeCaret(editor, 0, 0);
    await vscode.env.clipboard.writeText('pasted content that is long');
    await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
    await waitFor(
      () => editor.document.getText().includes('pasted content'),
      2000,
      'paste applied',
    );
    await wait(150);
    assert.strictEqual(events.length, 0);
  });

  test('redo is ignored', async () => {
    const editor = await openFixture('notes.txt');
    await placeCaret(editor, 0, 0);
    await typeText('q');
    await waitFor(() => events.length === 1, 2000, 'keystroke');
    await vscode.commands.executeCommand('undo');
    await vscode.commands.executeCommand('redo');
    await wait(150);
    assert.strictEqual(events.length, 1);
    assert.ok(editor.document.getText().startsWith('q'), 'redo applied');
  });

  test('accepting a code completion is ignored (only the typed character counts)', async () => {
    const doc = await vscode.workspace.openTextDocument({
      content: 'keyblazeAlphaOmega keyblazeAlphaOmega\n\n',
      language: 'plaintext',
    });
    const editor = await vscode.window.showTextDocument(doc);
    await placeCaret(editor, 1, 0);
    await typeText('keyb');
    await waitFor(() => events.length === 4, 2000, 'typed prefix');
    await vscode.commands.executeCommand('editor.action.triggerSuggest');
    await wait(700);
    await vscode.commands.executeCommand('acceptSelectedSuggestion');
    await waitFor(() => doc.lineAt(1).text === 'keyblazeAlphaOmega', 3000, 'completion accepted');
    await wait(150);
    assert.strictEqual(events.length, 4, 'completion insert produced no keystroke');
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  });
});

suite('Error handling and edge cases', () => {
  setup(resetSettings);
  teardown(closeAllEditors);
  suiteTeardown(resetSettings);

  test('closing an editor while bursts are running is harmless', async () => {
    const api = await getApi();
    await config().update('particleLifetime', 600, vscode.ConfigurationTarget.Global);
    await config().update('performance.maxBurstsPerSecond', 30, vscode.ConfigurationTarget.Global);
    const editor = await openFixture('long.ts');
    await placeCaret(editor, 10, 12);
    await typeText('abc', 40);
    assert.ok(api.getStats().activeBursts > 0);
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await waitFor(
      () => api.getStats().activeBursts === 0,
      3000,
      'slots released after the editor closed',
    );
    // Still fully functional afterwards.
    const again = await openFixture('long.ts');
    await placeCaret(again, 5, 5);
    const before = api.getStats().totalBursts;
    await typeText('z');
    await waitFor(() => api.getStats().totalBursts > before, 2000, 'renders again');
  });

  test('a failing effect handler is contained and logged, never thrown into typing', () => {
    // Stub logger: creating and immediately disposing a real LogOutputChannel races VS Code's async
    // channel creation (and only exists in this test; the real logger lives as long as the extension).
    const logged: string[] = [];
    const logger = {
      error: (message: string, err?: unknown) => logged.push(`${message}: ${String(err)}`),
    };
    assert.doesNotThrow(() =>
      safely(logger as unknown as Logger, 'Keystroke effect failed', () => {
        throw new Error('boom');
      }),
    );
    assert.deepStrictEqual(logged, ['Keystroke effect failed: Error: boom']);
  });

  test('large documents (50,000 lines) stay responsive', async () => {
    const api = await getApi();
    await config().update('performance.maxBurstsPerSecond', 30, vscode.ConfigurationTarget.Global);
    const content = Array.from({ length: 50_000 }, (_, i) => `line ${i}: const v${i} = ${i};`).join(
      '\n',
    );
    const doc = await vscode.workspace.openTextDocument({ content, language: 'typescript' });
    const editor = await vscode.window.showTextDocument(doc);
    await placeCaret(editor, 25_000, 8);
    const before = api.getStats().totalBursts;
    const start = Date.now();
    await typeText('x');
    await waitFor(() => api.getStats().totalBursts > before, 2000, 'burst');
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 500, `keystroke → burst took ${elapsed} ms`);
    assert.strictEqual(api.getStats().lastBurst?.decisions[0]?.mode, 'below');
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  });

  test('Change Effect quick pick applies the selected preset', async () => {
    const api = await getApi();
    const pending = vscode.commands.executeCommand('keyblaze.changeEffect');
    await wait(600);
    await vscode.commands.executeCommand('workbench.action.quickOpenSelectNext');
    await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
    await pending;
    await waitFor(() => api.getSettings().preset !== 'classicBurst', 2000, 'preset changed');
    assert.strictEqual(api.getSettings().preset, 'firestorm');
  });

  test('workspace-scoped values take precedence and are updated and cleared in place', async () => {
    const api = await getApi();
    await config().update('intensity', 2, vscode.ConfigurationTarget.Workspace);
    try {
      await waitFor(() => api.getSettings().intensity === 2, 2000, 'workspace value applies');
      await vscode.commands.executeCommand('keyblaze.nextEffect'); // global write
      await config().update('intensity', 9, vscode.ConfigurationTarget.Global);
      assert.strictEqual(api.getSettings().intensity, 2, 'workspace value still wins');
      await api.sendControlPanelMessage({ type: 'update', key: 'intensity', value: 7 });
      assert.strictEqual(
        config().inspect('intensity')?.workspaceValue,
        7,
        'written to the scope that defines it',
      );
      await resetSettings();
      assert.strictEqual(config().inspect('intensity')?.workspaceValue, undefined);
      assert.strictEqual(config().inspect('intensity')?.globalValue, undefined);
    } finally {
      await config().update('intensity', undefined, vscode.ConfigurationTarget.Workspace);
    }
  });
});
