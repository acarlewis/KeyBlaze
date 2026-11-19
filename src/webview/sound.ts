/**
 * KeyBlaze Sound view (webview entry). It plays synthesised recipes from the host through WebAudio.
 * Audio can only start after a user gesture, so it shows an "Enable sound" button until the
 * AudioContext is running. It also reports the OS reduced-motion preference to the host.
 */
import type { ToneStep } from '../core/sound';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();

type HostMessage =
  | { type: 'play'; recipe: ToneStep[]; volume: number }
  | { type: 'status'; enabled: boolean; allowed: boolean; theme: string };

const status = document.getElementById('status') as HTMLElement;
const enableBtn = document.getElementById('enable') as HTMLButtonElement;
const testRow = document.getElementById('test') as HTMLElement;
let ctx: AudioContext | undefined;
let noise: AudioBuffer | undefined;
let last: { enabled: boolean; allowed: boolean; theme: string } = {
  enabled: false,
  allowed: false,
  theme: 'soft',
};

window.addEventListener('error', (e) => vscode.postMessage({ type: 'error', message: e.message }));

function audio(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    ctx.addEventListener('statechange', () => {
      vscode.postMessage({ type: 'audioState', state: ctx?.state });
      render();
    });
    // One second of white noise, reused for clicky sounds.
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return ctx;
}

function play(recipe: ToneStep[], volume: number): void {
  const ac = audio();
  if (ac.state !== 'running') return;
  const master = ac.createGain();
  master.gain.value = Math.max(0, Math.min(1, volume));
  master.connect(ac.destination);
  const t0 = ac.currentTime + 0.005;
  for (const step of recipe) {
    const start = t0 + step.atMs / 1000;
    const end = start + step.durationMs / 1000;
    const env = ac.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, step.gain), start + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    env.connect(master);
    if (step.wave === 'noise') {
      const src = ac.createBufferSource();
      src.buffer = noise ?? null;
      const band = ac.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = step.from;
      band.Q.value = 1.2;
      src.connect(band).connect(env);
      src.start(start);
      src.stop(end + 0.01);
    } else {
      const osc = ac.createOscillator();
      osc.type = step.wave;
      osc.frequency.setValueAtTime(step.from, start);
      if (step.to !== step.from) osc.frequency.exponentialRampToValueAtTime(step.to, end);
      osc.connect(env);
      osc.start(start);
      osc.stop(end + 0.01);
    }
  }
  vscode.postMessage({ type: 'played' });
}

function render(): void {
  const running = ctx?.state === 'running';
  if (!last.enabled) {
    status.textContent = 'Sound is off. Turn on "keyblaze.sound.enabled" or use the Control Panel.';
  } else if (!last.allowed) {
    status.textContent =
      'Sound is paused (KeyBlaze is inactive, the window is unfocused, or a screen reader is in use).';
  } else if (!running) {
    status.textContent = 'Click "Enable sound" once to allow audio in this session.';
  } else {
    status.textContent = `Sound is on (${last.theme} theme).`;
  }
  enableBtn.hidden = !last.enabled || running;
  testRow.hidden = !last.enabled || !running;
}

enableBtn.addEventListener('click', () => {
  void audio()
    .resume()
    .then(() => {
      vscode.postMessage({ type: 'audioState', state: ctx?.state });
      render();
    });
});
document
  .getElementById('testKey')
  ?.addEventListener('click', () => vscode.postMessage({ type: 'preview', kind: 'key' }));
document
  .getElementById('testMilestone')
  ?.addEventListener('click', () => vscode.postMessage({ type: 'preview', kind: 'milestone' }));

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  const m = event.data;
  if (m.type === 'play') play(m.recipe, m.volume);
  else if (m.type === 'status') {
    last = m;
    render();
  }
});

const motion = matchMedia('(prefers-reduced-motion: reduce)');
const reportMotion = (): void =>
  vscode.postMessage({ type: 'reducedMotion', value: motion.matches });
motion.addEventListener('change', reportMotion);
reportMotion();
vscode.postMessage({ type: 'ready' });
render();
