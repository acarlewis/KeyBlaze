import * as vscode from 'vscode';
import { EFFECT_DESCRIPTIONS, EFFECT_LABELS } from '../config/labels';
import type { HostMessage, PanelState, WebviewMessage } from '../config/messages';
import { parseWebviewMessage } from '../config/messages';
import { PRESETS } from '../config/presets';
import { EFFECT_IDS, PRESET_IDS, validateSetting } from '../config/schema';
import { describeInactive } from '../core/motion';
import type { ComboService } from '../services/ComboService';
import type { EnvironmentService } from '../services/EnvironmentService';
import type { SettingsService } from '../services/SettingsService';
import type { Logger } from '../utils/logger';

const VIEW_TYPE = 'keyblaze.controlPanel';

/**
 * The KeyBlaze Control Panel: a single WebviewPanel.
 *
 * Security: strict CSP (nonce'd script, no inline handlers, no remote content). Resources load only
 * from `media/` and `dist/webview/`. Every incoming message is validated, and setting values are
 * checked against the settings schema before anything is written.
 * Lifecycle: the panel is disposed on close. Its state is re-sent whenever the webview (re)loads or
 * the settings change, so `retainContextWhenHidden` isn't needed and hidden panels cost nothing.
 */
export class ControlPanelProvider implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private panelDisposables: vscode.Disposable[] = [];
  private readyCount = 0;
  private statesPosted = 0;
  private rejected = 0;

  constructor(
    private readonly context: Pick<vscode.ExtensionContext, 'extensionUri' | 'extension'>,
    private readonly settings: SettingsService,
    private readonly combo: ComboService,
    private readonly logger: Logger,
    private readonly env?: EnvironmentService,
  ) {
    this.disposables.push(settings.onDidChange(() => this.postState()));
    if (env) this.disposables.push(env.onDidChange(() => this.postState()));
  }

  /** Diagnostics for tests. */
  get stats(): {
    open: boolean;
    visible: boolean;
    ready: number;
    statesPosted: number;
    rejected: number;
  } {
    return {
      open: this.panel !== undefined,
      visible: this.panel?.visible ?? false,
      ready: this.readyCount,
      statesPosted: this.statesPosted,
      rejected: this.rejected,
    };
  }

  show(): void {
    if (this.panel) {
      this.panel.reveal(this.panel.viewColumn ?? vscode.ViewColumn.Active);
      return;
    }
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    const scriptRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'KeyBlaze',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [mediaRoot, scriptRoot],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(mediaRoot, 'icons', 'icon.png');
    panel.webview.html = this.html(panel.webview, mediaRoot, scriptRoot);
    this.panel = panel;
    this.panelDisposables = [
      panel.webview.onDidReceiveMessage((raw: unknown) => void this.onMessage(raw)),
      panel.onDidChangeViewState(() => {
        if (panel.visible) this.postState();
      }),
      panel.onDidDispose(() => {
        for (const d of this.panelDisposables) d.dispose();
        this.panelDisposables = [];
        this.panel = undefined;
      }),
    ];
  }

  /**
   * Handles one message from the webview (public for tests). Returns true when it was accepted.
   */
  async onMessage(raw: unknown): Promise<boolean> {
    const message = parseWebviewMessage(raw);
    if (!message) {
      this.rejected++;
      this.logger.warn(`Control Panel: rejected malformed message ${safeJson(raw)}`);
      return false;
    }
    try {
      return await this.handle(message);
    } catch (err) {
      this.logger.error(`Control Panel: ${message.type} failed`, err);
      this.post({
        type: 'notice',
        level: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  dispose(): void {
    this.panel?.dispose();
    for (const d of this.disposables) d.dispose();
  }

  private async handle(message: WebviewMessage): Promise<boolean> {
    switch (message.type) {
      case 'ready':
        this.readyCount++;
        this.postState();
        return true;
      case 'update': {
        const value = validateSetting(message.key, message.value);
        if (value === undefined) {
          this.rejected++;
          this.logger.warn(
            `Control Panel: invalid value for ${message.key}: ${safeJson(message.value)}`,
          );
          this.postState(); // re-sync the control to the real value
          return false;
        }
        await this.settings.update(message.key, value);
        return true;
      }
      case 'resetKey':
        await this.settings.resetKey(message.key);
        return true;
      case 'applyPreset':
        await this.settings.applyPreset(message.id);
        return true;
      case 'resetAll':
        await vscode.commands.executeCommand('keyblaze.resetSettings');
        this.postState();
        return true;
      case 'command':
        return this.runCommand(message.command);
      case 'error':
        this.logger.error(`Control Panel webview: ${message.message}`);
        return true;
      case 'environment':
        this.env?.setOsPrefersReducedMotion(message.prefersReducedMotion);
        return true;
    }
  }

  private async runCommand(
    command: 'toggle' | 'previewInEditor' | 'openSettings' | 'openDocs' | 'openSoundView',
  ): Promise<boolean> {
    switch (command) {
      case 'toggle':
        await vscode.commands.executeCommand('keyblaze.toggle');
        break;
      case 'previewInEditor': {
        const editor = vscode.window.visibleTextEditors[0];
        if (!editor) {
          this.post({
            type: 'notice',
            level: 'info',
            text: 'Open a text editor to preview the effect there.',
          });
          return true;
        }
        await vscode.window.showTextDocument(editor.document, {
          viewColumn: editor.viewColumn,
          preserveFocus: false,
        });
        await vscode.commands.executeCommand('keyblaze.previewEffect');
        break;
      }
      case 'openSettings':
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          `@ext:${this.context.extension.id}`,
        );
        break;
      case 'openSoundView':
        await vscode.commands.executeCommand('keyblaze.openSoundView');
        break;
      case 'openDocs': {
        // vsce packages the README as `readme.md`; the source tree has `README.md`. Case matters on Linux.
        for (const name of ['readme.md', 'README.md']) {
          const readme = vscode.Uri.joinPath(this.context.extensionUri, name);
          try {
            await vscode.workspace.fs.stat(readme);
            await vscode.commands.executeCommand('markdown.showPreview', readme);
            return true;
          } catch {
            // try the next name
          }
        }
        this.post({
          type: 'notice',
          level: 'error',
          text: 'README not found in the extension folder.',
        });
        break;
      }
    }
    return true;
  }

  private state(): PanelState {
    const pkg = this.context.extension.packageJSON as { version?: string };
    const policy = this.env?.policy;
    return {
      settings: this.settings.get(),
      overridden: this.settings.overriddenPresetKeys(),
      presets: PRESET_IDS.map((id) => ({ ...PRESETS[id] })),
      effects: EFFECT_IDS.map((id) => ({
        id,
        label: EFFECT_LABELS[id],
        description: EFFECT_DESCRIPTIONS[id],
      })),
      version: pkg.version ?? '0.0.0',
      vscodeVersion: vscode.version,
      bestCombo: this.combo.snapshot().best,
      status: {
        active: policy?.active ?? true,
        ...(policy?.reason ? { reason: policy.reason } : {}),
        description: describeInactive(policy?.active === false ? policy.reason : undefined),
        reducedMotion: policy?.reducedMotion ?? false,
        windowFocused: this.env?.environment.windowFocused ?? true,
        soundAllowed: policy?.sound ?? false,
      },
    };
  }

  private postState(): void {
    if (!this.panel) return;
    this.post({ type: 'state', state: this.state() });
    this.statesPosted++;
  }

  private post(message: HostMessage): void {
    void this.panel?.webview
      .postMessage(message)
      .then(undefined, (err: unknown) =>
        this.logger.warn(`Control Panel: postMessage failed: ${String(err)}`),
      );
  }

  private html(webview: vscode.Webview, mediaRoot: vscode.Uri, scriptRoot: vscode.Uri): string {
    const nonce = createNonce();
    const css = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'styles', 'controlPanel.css'));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(scriptRoot, 'controlPanel.js'));
    const asset = (...parts: string[]): string =>
      webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, ...parts)).toString();
    const brand = {
      icon: asset('icons', 'icon.png'),
      logoDark: asset('logo', 'Full_Logo.png'),
      logoLight: asset('logo', 'Light_Background_application.png'),
    };
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css.toString()}">
<title>KeyBlaze</title>
</head>
<body>
<div id="app" aria-live="polite" data-icon="${brand.icon}" data-logo-dark="${brand.logoDark}" data-logo-light="${brand.logoLight}"><p class="loading">Loading KeyBlaze…</p></div>
<script nonce="${nonce}" src="${js.toString()}"></script>
</body>
</html>`;
  }
}

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 200);
  } catch {
    return String(value);
  }
}
