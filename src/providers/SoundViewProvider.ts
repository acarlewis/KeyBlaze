import * as vscode from 'vscode';
import type { SoundTheme } from '../config/schema';
import type { SoundKind } from '../core/sound';
import { soundRecipe } from '../core/sound';
import type { EnvironmentService } from '../services/EnvironmentService';
import type { SettingsService } from '../services/SettingsService';
import type { Logger } from '../utils/logger';

export const SOUND_VIEW_ID = 'keyblaze.sound';

export type SoundHostMessage =
  | {
      readonly type: 'play';
      readonly recipe: ReturnType<typeof soundRecipe>;
      readonly volume: number;
    }
  | {
      readonly type: 'status';
      readonly enabled: boolean;
      readonly allowed: boolean;
      readonly theme: SoundTheme;
    };

type AudioState = 'unknown' | 'suspended' | 'running' | 'closed';

/**
 * "KeyBlaze Sound" webview view. The extension host has no audio output, so sounds play here through
 * WebAudio. Browsers require one user gesture before audio can start, so the view shows an
 * "Enable sound" button until the AudioContext is running. `retainContextWhenHidden` keeps the audio
 * context alive when the view is collapsed, after it has been opened once.
 */
export class SoundViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private audio: AudioState = 'unknown';
  private played = 0;
  private sent = 0;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly settings: SettingsService,
    private readonly env: EnvironmentService,
    private readonly logger: Logger,
  ) {
    this.disposables.push(
      settings.onDidChange(() => this.postStatus()),
      env.onDidChange(() => this.postStatus()),
    );
  }

  /** Diagnostics for tests. */
  get stats(): { resolved: boolean; audio: AudioState; sent: number; played: number } {
    return {
      resolved: this.view !== undefined,
      audio: this.audio,
      sent: this.sent,
      played: this.played,
    };
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const scriptRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [scriptRoot, mediaRoot] };
    view.webview.html = this.html(view.webview, scriptRoot, mediaRoot);
    view.webview.onDidReceiveMessage(
      (raw: unknown) => this.onMessage(raw),
      undefined,
      this.disposables,
    );
    view.onDidDispose(() => {
      this.view = undefined;
      this.audio = 'unknown';
    });
  }

  /** Plays a sound if sound is allowed and the view is alive. Returns true when a play was sent. */
  play(kind: SoundKind, tier = 0): boolean {
    const s = this.settings.get();
    if (!this.view || !this.env.policy.sound || s['sound.volume'] <= 0) return false;
    this.sent++;
    void this.view.webview.postMessage({
      type: 'play',
      recipe: soundRecipe(s['sound.theme'], kind, tier),
      volume: s['sound.volume'],
    } satisfies SoundHostMessage);
    return true;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }

  private onMessage(raw: unknown): void {
    if (typeof raw !== 'object' || raw === null) return;
    const m = raw as Record<string, unknown>;
    switch (m.type) {
      case 'ready':
        this.postStatus();
        break;
      case 'audioState':
        if (m.state === 'suspended' || m.state === 'running' || m.state === 'closed')
          this.audio = m.state;
        break;
      case 'played':
        this.played++;
        break;
      case 'reducedMotion':
        if (typeof m.value === 'boolean') this.env.setOsPrefersReducedMotion(m.value);
        break;
      case 'preview':
        this.play(m.kind === 'milestone' ? 'milestone' : 'key', 1);
        break;
      case 'error':
        if (typeof m.message === 'string')
          this.logger.error(`Sound view: ${m.message.slice(0, 500)}`);
        break;
      default:
        break;
    }
  }

  private postStatus(): void {
    if (!this.view) return;
    const s = this.settings.get();
    void this.view.webview.postMessage({
      type: 'status',
      enabled: s['sound.enabled'],
      allowed: this.env.policy.sound,
      theme: s['sound.theme'],
    } satisfies SoundHostMessage);
  }

  private html(webview: vscode.Webview, scriptRoot: vscode.Uri, mediaRoot: vscode.Uri): string {
    const nonce = Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 36).toString(36),
    ).join('');
    const js = webview.asWebviewUri(vscode.Uri.joinPath(scriptRoot, 'sound.js'));
    const css = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'styles', 'sound.css'));
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css.toString()}">
</head>
<body>
<p id="status" role="status">Loading…</p>
<button id="enable" type="button" hidden>Enable sound</button>
<div id="test" class="row" hidden>
  <button id="testKey" type="button" class="secondary">Test keystroke</button>
  <button id="testMilestone" type="button" class="secondary">Test milestone</button>
</div>
<p class="hint">Sounds are synthesised (no recorded assets). Keep this view open once per session; it can be collapsed afterwards.</p>
<script nonce="${nonce}" src="${js.toString()}"></script>
</body>
</html>`;
  }
}
