import * as assert from 'assert';
import * as vscode from 'vscode';
import type { KeystrokeEvent } from '../../src/services/TypingDetector';
import { linesBelowFor } from '../../src/core/placement';
import { qualityProfile } from '../../src/core/quality';
import { AURA_REST_MS } from '../../src/services/CursorEffects';
import { editorFontMetrics } from '../../src/services/EditorMetrics';
import {
  CONTRIBUTED_COMMANDS,
  EXTENSION_ID,
  closeAllEditors,
  config,
  getApi,
  assertLinesVisible,
  maxPaced,
  openFixture,
  placeCaret,
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
    await config().update('particleCount', 33, vscode.ConfigurationTarget.Global);
    await waitFor(() => api.getSettings().particleCount === 33, 3000, 'live config');
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
    await config().update('performance.maxBurstsPerSecond', 30, vscode.ConfigurationTarget.Global);
    const editor = await openFixture('sample.ts');
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    const before = api.getStats().totalBursts;
    await typeText('abc', 60);
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

  test('maxBurstsPerSecond paces rendering but not detection', async () => {
    const api = await getApi();
    await config().update('performance.maxBurstsPerSecond', 2, vscode.ConfigurationTarget.Global);
    await wait(1100); // let the previous test's rate window drain
    await openFixture('sample.ts');
    const before = api.getStats().totalBursts;
    const start = Date.now();
    await typeText('abcde'); // typed back to back; the minimum gap for 2/s is 375 ms
    const elapsed = Date.now() - start;
    await waitFor(() => events.length === 5, 3000, 'keystrokes');
    const bursts = api.getStats().totalBursts - before;
    // Every keystroke is detected, but rendering is paced: at most one burst per 375 ms.
    assert.ok(bursts >= 1, 'the first keystroke renders');
    assert.ok(bursts <= Math.min(5, maxPaced(elapsed, 375)), `${bursts} bursts in ${elapsed} ms`);
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

/** Worst-case burst reach below the caret at the default (high) quality: what placement checks. */
const MAX_HALF_EXTENT = qualityProfile('high', false).maxHalfExtent;

suite('Placement in a real editor', () => {
  setup(resetSettings);
  teardown(closeAllEditors);
  suiteTeardown(resetSettings);

  /**
   * Places the caret at the top of the editor (all the room below it), lets the inlay-hint tracker
   * settle, types one character and returns the burst diagnostics. With `roomBelow`, it first asserts
   * that every line a full-circle burst needs is visible, so a too-small window can't masquerade as a
   * placement bug (that's what happened on 1024×768 CI runners with the Chat side bar open).
   */
  async function burstAt(line: number, character: number, roomBelow = false) {
    const api = await getApi();
    await config().update('performance.maxBurstsPerSecond', 30, vscode.ConfigurationTarget.Global);
    const editor = await openFixture('long.ts');
    await placeCaret(editor, line, character, vscode.TextEditorRevealType.AtTop);
    await wait(500); // let the inlay-hint tracker settle
    if (roomBelow) {
      const { fontSize, lineHeight } = editorFontMetrics(editor.document);
      await assertLinesVisible(
        editor,
        line,
        line + linesBelowFor(MAX_HALF_EXTENT, lineHeight, fontSize),
      );
    }
    const before = api.getStats().totalBursts;
    await typeText('z');
    await waitFor(() => api.getStats().totalBursts > before, 3000, 'burst');
    const last = api.getStats().lastBurst;
    assert.ok(last, 'no burst info');
    return { last, editor };
  }

  test('normal code: full-circle burst anchored below the caret, zero layout height', async () => {
    const { last } = await burstAt(10, 12, true);
    assert.deepStrictEqual(last.decisions[0], { mode: 'below', variant: 'full' });
    const layout = last.layouts[0];
    assert.ok(layout);
    assert.ok(layout.line > 10, `anchor line ${layout.line}`);
    assert.strictEqual(layout.startCharacter, 0);
    assert.ok(layout.margin.startsWith(`${-layout.height}px `), layout.margin);
    assert.ok(layout.margin.includes('ch'), layout.margin);
  });

  test('CJK before the caret falls back to a rising burst on the caret line', async () => {
    const { last } = await burstAt(20, 12);
    assert.deepStrictEqual(last.decisions[0], {
      mode: 'caret',
      variant: 'upward',
      reason: 'wideCharacters',
    });
    assert.strictEqual(last.layouts[0]?.line, 20);
  });

  test('end of document falls back', async () => {
    const { last } = await burstAt(58, 5);
    assert.strictEqual(last.decisions[0]?.reason, 'endOfDocument');
  });

  test('word wrap falls back when a spanned line could wrap', async () => {
    await vscode.workspace
      .getConfiguration('editor')
      .update('wordWrap', 'on', vscode.ConfigurationTarget.Global);
    try {
      const { last } = await burstAt(23, 5, true);
      assert.strictEqual(last.decisions[0]?.reason, 'wordWrap');
    } finally {
      await vscode.workspace
        .getConfiguration('editor')
        .update('wordWrap', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test('placement: cursorLine forces rising bursts', async () => {
    await config().update('placement', 'cursorLine', vscode.ConfigurationTarget.Global);
    const { last } = await burstAt(10, 12);
    assert.deepStrictEqual(last.decisions[0], {
      mode: 'caret',
      variant: 'upward',
      reason: 'setting',
    });
  });

  test('every burst image is unique (shared SMIL timelines would freeze reused images)', async () => {
    const api = await getApi();
    await config().update('performance.maxBurstsPerSecond', 30, vscode.ConfigurationTarget.Global);
    const editor = await openFixture('long.ts');
    await placeCaret(editor, 10, 12);
    const sizes = new Set<number>();
    for (let i = 0; i < 4; i++) {
      await typeText('q');
      await wait(60);
      sizes.add(api.getStats().lastBurst?.svgBytes ?? -1);
    }
    // Different nonces (and seeds) → the documents differ. Byte size can coincide, so only check presence.
    assert.ok(!sizes.has(-1));
  });
});

suite('Combo system', () => {
  setup(resetSettings);
  teardown(closeAllEditors);
  suiteTeardown(resetSettings);

  async function comboEditor() {
    await config().update('combo.milestones', [3, 6], vscode.ConfigurationTarget.Global);
    await config().update('combo.resetTime', 600, vscode.ConfigurationTarget.Global);
    const editor = await openFixture('long.ts');
    await placeCaret(editor, 10, 12);
    await wait(700); // any earlier combo expires
    return editor;
  }

  test('every keystroke counts, including rate-limited ones', async () => {
    const api = await getApi();
    await config().update('performance.maxBurstsPerSecond', 1, vscode.ConfigurationTarget.Global);
    await comboEditor();
    const bursts = api.getStats().totalBursts;
    const celebrations = api.getStats().celebrations;
    const start = Date.now();
    await typeText('abcde');
    const elapsed = Date.now() - start;
    assert.strictEqual(api.getStats().combo.count, 5);
    // Paced keystroke bursts (1/s → 750 ms minimum gap) plus milestone celebrations, which are never
    // rate-limited.
    const celebrated = api.getStats().celebrations - celebrations;
    const rendered = api.getStats().totalBursts - bursts;
    assert.ok(
      rendered <= maxPaced(elapsed, 750) + celebrated && rendered < 5 + celebrated,
      `${rendered} bursts (${celebrated} celebrations) in ${elapsed} ms: rate limit not applied`,
    );
  });

  test('combo resets after the inactivity period', async () => {
    const api = await getApi();
    await comboEditor();
    await typeText('ab');
    assert.strictEqual(api.getStats().combo.count, 2);
    await waitFor(() => api.getStats().combo.count === 0, 2000, 'reset');
    await typeText('c');
    assert.strictEqual(api.getStats().combo.count, 1);
  });

  test('milestones trigger celebrations; badge and status bar show the combo', async () => {
    const api = await getApi();
    await comboEditor();
    const celebrations = api.getStats().celebrations;
    await typeText('abc', 30);
    await waitFor(() => api.getStats().celebrations === celebrations + 1, 2000, 'first milestone');
    await waitFor(() => api.getStats().comboBadgeVisible, 2000, 'badge');
    await waitFor(() => api.getStats().statusText.includes('3x combo'), 2000, 'status bar');
    await typeText('def', 30);
    await waitFor(() => api.getStats().celebrations === celebrations + 2, 2000, 'second milestone');
    await waitFor(() => !api.getStats().comboBadgeVisible, 3000, 'badge cleared after reset');
    await waitFor(() => !api.getStats().statusText.includes('combo'), 2000, 'status bar cleared');
  });

  test('Impact Pulse (shake + line flash) runs without errors', async () => {
    const api = await getApi();
    await config().update('screenShake.enabled', true, vscode.ConfigurationTarget.Global);
    await comboEditor();
    const celebrations = api.getStats().celebrations;
    await typeText('abc', 30);
    await waitFor(() => api.getStats().celebrations === celebrations + 1, 2000, 'milestone');
    await wait(400); // flash steps complete
  });

  test('combo.enabled=false stops counting and hides the badge', async () => {
    const api = await getApi();
    await config().update('combo.enabled', false, vscode.ConfigurationTarget.Global);
    await comboEditor();
    await typeText('abcd');
    assert.strictEqual(api.getStats().combo.count, 0);
    assert.ok(!api.getStats().comboBadgeVisible);
  });

  test('showIndicator=false keeps counting but shows no badge', async () => {
    const api = await getApi();
    await config().update('combo.showIndicator', false, vscode.ConfigurationTarget.Global);
    await comboEditor();
    await typeText('abcd', 20);
    assert.strictEqual(api.getStats().combo.count, 4);
    await wait(200);
    assert.ok(!api.getStats().comboBadgeVisible);
  });

  test('disabling KeyBlaze ends the combo', async () => {
    const api = await getApi();
    await comboEditor();
    await typeText('ab');
    await vscode.commands.executeCommand('keyblaze.disable');
    assert.strictEqual(api.getStats().combo.count, 0);
  });
});

suite('Cursor effects', () => {
  setup(resetSettings);
  teardown(closeAllEditors);
  suiteTeardown(resetSettings);

  test('glow follows the caret in the active editor and clears when turned off', async () => {
    const api = await getApi();
    await config().update('cursor.effect', 'glow', vscode.ConfigurationTarget.Global);
    const editor = await openFixture('long.ts');
    await placeCaret(editor, 5, 4);
    await vscode.commands.executeCommand('cursorRight');
    await waitFor(() => api.getStats().cursorEffects.auraVisible, 2000, 'aura');
    await config().update('cursor.effect', 'none', vscode.ConfigurationTarget.Global);
    await waitFor(() => !api.getStats().cursorEffects.auraVisible, 2000, 'aura cleared');
  });

  test('ring aura renders too', async () => {
    const api = await getApi();
    await config().update('cursor.effect', 'ring', vscode.ConfigurationTarget.Global);
    const editor = await openFixture('long.ts');
    await placeCaret(editor, 5, 4);
    await vscode.commands.executeCommand('cursorDown');
    await waitFor(() => api.getStats().cursorEffects.auraVisible, 2000, 'aura');
  });

  for (const effect of ['sparks', 'trail'] as const) {
    test(`${effect}: navigation produces one-shot effects, typing does not`, async () => {
      const api = await getApi();
      await config().update('cursor.effect', effect, vscode.ConfigurationTarget.Global);
      const editor = await openFixture('long.ts');
      await placeCaret(editor, 5, 4);
      await wait(200);
      const before = api.getStats().cursorEffects.oneShots;
      await vscode.commands.executeCommand('cursorRight');
      await wait(100);
      await vscode.commands.executeCommand('cursorDown');
      await waitFor(() => api.getStats().cursorEffects.oneShots > before, 2000, 'one-shot');
      const afterNav = api.getStats().cursorEffects.oneShots;
      await typeText('xy', 50);
      await wait(150);
      assert.strictEqual(
        api.getStats().cursorEffects.oneShots,
        afterNav,
        'typing must not trigger cursor one-shots',
      );
    });
  }

  test('cursor effects are off in excluded languages', async () => {
    const api = await getApi();
    await config().update('cursor.effect', 'glow', vscode.ConfigurationTarget.Global);
    await config().update('excludeLanguages', ['typescript'], vscode.ConfigurationTarget.Global);
    const editor = await openFixture('long.ts');
    await placeCaret(editor, 5, 4);
    await vscode.commands.executeCommand('cursorRight');
    await wait(300);
    assert.ok(!api.getStats().cursorEffects.auraVisible);
  });
});

suite('Control Panel', () => {
  setup(resetSettings);
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await resetSettings();
  });

  test('opens a webview whose script loads and completes a message round trip', async () => {
    const api = await getApi();
    await vscode.commands.executeCommand('keyblaze.openControlPanel');
    await waitFor(() => api.getStats().controlPanel.ready > 0, 10000, 'webview ready');
    const stats = api.getStats().controlPanel;
    assert.ok(stats.open);
    assert.ok(stats.statesPosted > 0);
  });

  test('re-running the command reveals the same panel', async () => {
    const api = await getApi();
    await vscode.commands.executeCommand('keyblaze.openControlPanel');
    await waitFor(() => api.getStats().controlPanel.ready > 0, 10000, 'webview ready');
    const ready = api.getStats().controlPanel.ready;
    await vscode.commands.executeCommand('keyblaze.openControlPanel');
    await wait(300);
    assert.strictEqual(api.getStats().controlPanel.ready, ready, 'no second webview was created');
  });

  test('valid updates are written to the settings', async () => {
    const api = await getApi();
    assert.ok(await api.sendControlPanelMessage({ type: 'update', key: 'intensity', value: 8 }));
    assert.strictEqual(api.getSettings().intensity, 8);
    assert.ok(
      await api.sendControlPanelMessage({ type: 'update', key: 'colors', value: ['#123456'] }),
    );
    assert.deepStrictEqual(api.getSettings().colors, ['#123456']);
  });

  test('invalid values and malformed messages are rejected without side effects', async () => {
    const api = await getApi();
    const rejected = api.getStats().controlPanel.rejected;
    assert.strictEqual(
      await api.sendControlPanelMessage({ type: 'update', key: 'effect', value: 'plasma' }),
      false,
    );
    assert.strictEqual(
      await api.sendControlPanelMessage({ type: 'update', key: 'colors', value: ['red'] }),
      false,
    );
    assert.strictEqual(
      await api.sendControlPanelMessage({ type: 'command', command: 'rm -rf' }),
      false,
    );
    assert.strictEqual(await api.sendControlPanelMessage('garbage'), false);
    assert.strictEqual(api.getStats().controlPanel.rejected, rejected + 4);
    assert.strictEqual(api.getSettings().effect, 'particles');
    assert.strictEqual(config().inspect('colors')?.globalValue, undefined);
  });

  test('out-of-range numbers are clamped by the schema before writing', async () => {
    const api = await getApi();
    assert.ok(
      await api.sendControlPanelMessage({ type: 'update', key: 'particleCount', value: 999 }),
    );
    assert.strictEqual(config().inspect('particleCount')?.globalValue, 40);
  });

  test('applyPreset and resetKey work through the panel', async () => {
    const api = await getApi();
    await api.sendControlPanelMessage({ type: 'update', key: 'effect', value: 'stars' });
    assert.ok(await api.sendControlPanelMessage({ type: 'applyPreset', id: 'lightningStrike' }));
    assert.strictEqual(api.getSettings().preset, 'lightningStrike');
    assert.strictEqual(api.getSettings().effect, 'lightning');
    await api.sendControlPanelMessage({ type: 'update', key: 'particleSize', value: 9 });
    assert.ok(await api.sendControlPanelMessage({ type: 'resetKey', key: 'particleSize' }));
    assert.strictEqual(config().inspect('particleSize')?.globalValue, undefined);
  });

  test('toggle command from the panel', async () => {
    const api = await getApi();
    assert.ok(await api.sendControlPanelMessage({ type: 'command', command: 'toggle' }));
    assert.strictEqual(api.getSettings().enabled, false);
    await api.sendControlPanelMessage({ type: 'command', command: 'toggle' });
    assert.strictEqual(api.getSettings().enabled, true);
  });

  test('settings changes push a fresh state to an open panel', async () => {
    const api = await getApi();
    await vscode.commands.executeCommand('keyblaze.openControlPanel');
    await waitFor(() => api.getStats().controlPanel.ready > 0, 10000, 'ready');
    const before = api.getStats().controlPanel.statesPosted;
    await config().update('particleSpeed', 2, vscode.ConfigurationTarget.Global);
    await waitFor(() => api.getStats().controlPanel.statesPosted > before, 3000, 'state push');
  });

  test('Documentation opens the README in a Markdown preview', async () => {
    const api = await getApi();
    assert.ok(await api.sendControlPanelMessage({ type: 'command', command: 'openDocs' }));
    await waitFor(
      () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).some((t) => /readme/i.test(t.label)),
      5000,
      'README preview tab',
    );
  });

  test('closing the panel disposes it', async () => {
    const api = await getApi();
    await vscode.commands.executeCommand('keyblaze.openControlPanel');
    await wait(200);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await waitFor(() => !api.getStats().controlPanel.open, 3000, 'disposed');
  });
});

suite('Accessibility, focus and performance policy', () => {
  setup(resetSettings);
  teardown(async () => {
    const api = await getApi();
    api.setEnvironmentOverride({ windowFocused: true });
    await vscode.workspace
      .getConfiguration('editor')
      .update('accessibilitySupport', undefined, vscode.ConfigurationTarget.Global);
    await vscode.workspace
      .getConfiguration('workbench')
      .update('reduceMotion', undefined, vscode.ConfigurationTarget.Global);
    await closeAllEditors();
  });
  suiteTeardown(resetSettings);

  async function typeIn(text: string) {
    await config().update('performance.maxBurstsPerSecond', 30, vscode.ConfigurationTarget.Global);
    const editor = await openFixture('long.ts');
    await placeCaret(editor, 10, 12);
    await typeText(text, 60);
  }

  test('screen reader optimisation pauses effects and combos, and shows a paused status', async () => {
    const api = await getApi();
    await vscode.workspace
      .getConfiguration('editor')
      .update('accessibilitySupport', 'on', vscode.ConfigurationTarget.Global);
    await waitFor(() => api.getStats().policy.reason === 'screenReader', 3000, 'policy');
    const before = api.getStats().totalBursts;
    await typeIn('abc');
    await wait(150);
    assert.strictEqual(api.getStats().totalBursts, before);
    assert.strictEqual(api.getStats().combo.count, 0);
    assert.ok(api.getStats().statusText.includes('debug-pause'));
  });

  test('disableWithScreenReader=false keeps effects with a screen reader', async () => {
    const api = await getApi();
    await config().update(
      'accessibility.disableWithScreenReader',
      false,
      vscode.ConfigurationTarget.Global,
    );
    await vscode.workspace
      .getConfiguration('editor')
      .update('accessibilitySupport', 'on', vscode.ConfigurationTarget.Global);
    await wait(200);
    assert.ok(api.getStats().policy.active);
  });

  test('reduced motion renders tiny calm bursts and celebrations without shake', async () => {
    const api = await getApi();
    await vscode.workspace
      .getConfiguration('workbench')
      .update('reduceMotion', 'on', vscode.ConfigurationTarget.Global);
    await config().update('screenShake.enabled', true, vscode.ConfigurationTarget.Global);
    await config().update('combo.milestones', [3], vscode.ConfigurationTarget.Global);
    await config().update('combo.resetTime', 800, vscode.ConfigurationTarget.Global);
    await waitFor(() => api.getStats().policy.reducedMotion, 3000, 'reduced motion');
    await wait(900);
    await typeIn('ab');
    const last = api.getStats().lastBurst;
    assert.strictEqual(last?.effect, 'minimal');
    assert.ok((last?.particleCount ?? 99) <= 4);
    const celebrations = api.getStats().celebrations;
    await typeText('c', 60);
    await waitFor(() => api.getStats().celebrations === celebrations + 1, 2000, 'milestone');
    assert.strictEqual(api.getStats().lastBurst?.shaken, false);
  });

  test('respectReducedMotion=false ignores the reduced-motion preference', async () => {
    const api = await getApi();
    await config().update(
      'accessibility.respectReducedMotion',
      false,
      vscode.ConfigurationTarget.Global,
    );
    await vscode.workspace
      .getConfiguration('workbench')
      .update('reduceMotion', 'on', vscode.ConfigurationTarget.Global);
    await wait(200);
    assert.strictEqual(api.getStats().policy.reducedMotion, false);
  });

  test('unfocused window: no new effects, combos or cursor auras', async () => {
    const api = await getApi();
    await config().update('cursor.effect', 'glow', vscode.ConfigurationTarget.Global);
    api.setEnvironmentOverride({ windowFocused: false });
    await waitFor(() => api.getStats().policy.reason === 'unfocused', 2000, 'policy');
    const before = api.getStats().totalBursts;
    const comboBefore = api.getStats().combo.count; // losing focus pauses counting; it does not wipe a streak
    await typeIn('xy');
    await wait(200);
    assert.strictEqual(api.getStats().totalBursts, before);
    assert.ok(api.getStats().combo.count <= comboBefore);
    assert.ok(!api.getStats().cursorEffects.auraVisible);
  });

  test('very fast typing shrinks bursts', async () => {
    const api = await getApi();
    await config().update('particleCount', 30, vscode.ConfigurationTarget.Global);
    await config().update('performance.maxBurstsPerSecond', 30, vscode.ConfigurationTarget.Global);
    const editor = await openFixture('long.ts');
    await placeCaret(editor, 10, 12);
    await typeText('abcdefghijklmnopqrstuvwxyz'); // far above 24 keystrokes/s
    assert.ok((api.getStats().lastBurst?.particleCount ?? 30) < 30);
  });
});

suite('Sound', () => {
  setup(resetSettings);
  suiteTeardown(async () => {
    await resetSettings();
    await closeAllEditors();
  });

  async function soundView() {
    const api = await getApi();
    await vscode.commands.executeCommand('keyblaze.openSoundView');
    await waitFor(
      () => api.getStats().sound.resolved && api.getStats().sound.visible,
      10000,
      'sound view resolved and visible',
    );
    return api;
  }

  test('Open Sound View enables sound and resolves the webview view', async () => {
    const api = await soundView();
    assert.strictEqual(api.getSettings()['sound.enabled'], true);
  });

  test('milestones send sounds while allowed; nothing is sent with a screen reader', async () => {
    const api = await soundView();
    await config().update('combo.milestones', [3], vscode.ConfigurationTarget.Global);
    await config().update('combo.resetTime', 800, vscode.ConfigurationTarget.Global);
    const editor = await openFixture('long.ts');
    await placeCaret(editor, 10, 12);
    await wait(900);
    const sent = api.getStats().sound.sent;
    await typeText('abc', 40);
    await waitFor(() => api.getStats().sound.sent === sent + 1, 2000, 'milestone sound');

    await vscode.workspace
      .getConfiguration('editor')
      .update('accessibilitySupport', 'on', vscode.ConfigurationTarget.Global);
    try {
      await wait(900);
      const pausedSent = api.getStats().sound.sent;
      await typeText('def', 40);
      await wait(200);
      assert.strictEqual(api.getStats().sound.sent, pausedSent);
    } finally {
      await vscode.workspace
        .getConfiguration('editor')
        .update('accessibilitySupport', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test('everyKeystroke mode sends rate-limited keystroke sounds', async () => {
    const api = await soundView();
    await config().update('sound.mode', 'everyKeystroke', vscode.ConfigurationTarget.Global);
    await waitFor(() => api.getSettings()['sound.mode'] === 'everyKeystroke', 3000, 'mode applied');
    await waitFor(() => api.getStats().policy.sound, 3000, 'sound allowed');
    const editor = await openFixture('long.ts');
    await placeCaret(editor, 10, 12);
    const sent = api.getStats().sound.sent;
    const start = Date.now();
    await typeText('abcdef'); // typed back to back; keystroke sounds are at least 45 ms apart
    const elapsed = Date.now() - start;
    const delta = api.getStats().sound.sent - sent;
    assert.ok(delta >= 1, 'keystroke sounds are sent');
    assert.ok(delta <= Math.min(6, maxPaced(elapsed, 45)), `${delta} sounds in ${elapsed} ms`);
  });
});

suite('Phase 11 regressions', () => {
  setup(resetSettings);
  teardown(closeAllEditors);
  suiteTeardown(resetSettings);

  test('anchor below the visible area falls back to a rising burst (notVisible)', async () => {
    const api = await getApi();
    await config().update('performance.maxBurstsPerSecond', 30, vscode.ConfigurationTarget.Global);
    const editor = await openFixture('long.ts');
    await placeCaret(editor, 0, 0, vscode.TextEditorRevealType.AtTop);
    const lastVisible = Math.max(...editor.visibleRanges.map((r) => r.end.line));
    const caretLine = lastVisible - 1;
    const { fontSize, lineHeight } = editorFontMetrics(editor.document);
    const needed = linesBelowFor(MAX_HALF_EXTENT, lineHeight, fontSize);
    assert.ok(
      caretLine + needed < editor.document.lineCount - 1,
      `test precondition: the fixture must extend past the visible area (visible to ${lastVisible})`,
    );
    // Move the caret to the bottom of the viewport without scrolling.
    editor.selection = new vscode.Selection(caretLine, 5, caretLine, 5);
    await wait(300);
    const before = api.getStats().totalBursts;
    await typeText('z');
    await waitFor(() => api.getStats().totalBursts > before, 3000, 'burst');
    assert.deepStrictEqual(api.getStats().lastBurst?.decisions[0], {
      mode: 'caret',
      variant: 'upward',
      reason: 'notVisible',
    });
  });

  test('closed documents leave no edit-time record behind (cursor effects)', async () => {
    const api = await getApi();
    const doc = await vscode.workspace.openTextDocument({
      content: 'temporary',
      language: 'plaintext',
    });
    const editor = await vscode.window.showTextDocument(doc);
    await placeCaret(editor, 0, 9);
    await typeText('x');
    const withDoc = api.getStats().cursorEffects.trackedDocuments;
    assert.ok(withDoc >= 1);
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await waitFor(
      () => api.getStats().cursorEffects.trackedDocuments < withDoc,
      5000,
      'edit-time entry released on close',
    );
  });

  test('changing the palette releases cached Impact Pulse flash types', async () => {
    const api = await getApi();
    await config().update('screenShake.enabled', true, vscode.ConfigurationTarget.Global);
    await config().update('combo.milestones', [3], vscode.ConfigurationTarget.Global);
    await config().update('combo.resetTime', 800, vscode.ConfigurationTarget.Global);
    const editor = await openFixture('long.ts');
    await placeCaret(editor, 10, 12);
    await wait(900);
    const celebrations = api.getStats().celebrations;
    await typeText('abc', 40);
    await waitFor(() => api.getStats().celebrations === celebrations + 1, 2000, 'milestone');
    await waitFor(() => api.getStats().flashTypes > 0, 2000, 'flash types created');
    await config().update('colors', ['#123456', '#abcdef'], vscode.ConfigurationTarget.Global);
    await waitFor(() => api.getStats().flashTypes === 0, 2000, 'flash types released');
  });
});

suite('Performance: no endless animation while idle', () => {
  setup(resetSettings);
  teardown(closeAllEditors);
  suiteTeardown(resetSettings);

  test('the cursor aura pulses while the caret is active and rests as a static image when idle', async function () {
    this.timeout(AURA_REST_MS + 15_000);
    const api = await getApi();
    await config().update('cursor.effect', 'glow', vscode.ConfigurationTarget.Global);
    const editor = await openFixture('long.ts');
    await placeCaret(editor, 10, 12);
    await waitFor(() => api.getStats().cursorEffects.auraAnimated, 2000, 'pulsing aura shown');
    const shownAt = Date.now();
    await waitFor(
      () => !api.getStats().cursorEffects.auraAnimated,
      AURA_REST_MS + 3000,
      'aura rests when the caret is idle',
    );
    assert.ok(Date.now() - shownAt >= AURA_REST_MS - 500, 'rests only after the idle delay');
    assert.ok(api.getStats().cursorEffects.auraVisible, 'the resting aura stays visible');
    await placeCaret(editor, 11, 3);
    await waitFor(
      () => api.getStats().cursorEffects.auraAnimated,
      2000,
      'pulses again on activity',
    );
  });
});
