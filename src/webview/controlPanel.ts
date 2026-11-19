/**
 * KeyBlaze Control Panel (webview entry point). Plain DOM, no framework.
 * The host owns the settings. This UI sends validated-on-arrival `update` messages and re-renders from
 * every `state` message. Slider drags update the live preview immediately and are written to the
 * settings when released (or after a short idle).
 */
import type { HostMessage, PanelState, WebviewMessage } from '../config/messages';
import type { KeyBlazeSettings, SettingKey } from '../config/schema';
import {
  CURSOR_EFFECT_IDS,
  PARTICLE_SHAPES,
  PLACEMENT_MODES,
  PRESETABLE_KEYS,
  QUALITY_LEVELS,
  SETTING_SPECS,
  SOUND_MODES,
  SOUND_THEMES,
} from '../config/schema';
import { Preview } from './preview';

declare function acquireVsCodeApi(): {
  postMessage(message: WebviewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();
const send = (message: WebviewMessage): void => vscode.postMessage(message);

window.addEventListener('error', (e) =>
  send({ type: 'error', message: `${e.message} @${e.filename}:${e.lineno}` }),
);

type Control =
  | { kind: 'toggle'; key: SettingKey; label: string; help?: string }
  | {
      kind: 'select';
      key: SettingKey;
      label: string;
      options: readonly (readonly [string, string])[];
      help?: string;
    }
  | { kind: 'range'; key: SettingKey; label: string; step: number; unit?: string; help?: string }
  | { kind: 'colors'; key: 'colors'; label: string; help?: string }
  | { kind: 'numberList'; key: 'combo.milestones'; label: string; help?: string }
  | {
      kind: 'stringList';
      key: 'excludeLanguages' | 'excludeFiles';
      label: string;
      placeholder: string;
      help?: string;
    };

interface Section {
  title: string;
  description?: string;
  controls: Control[];
}

const TABS = ['dashboard', 'effects', 'personalization', 'performance', 'about'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  dashboard: 'Dashboard',
  effects: 'Effects',
  personalization: 'Personalization',
  performance: 'Performance',
  about: 'About',
};

const label = (s: string): string =>
  s.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
const options = (
  values: readonly string[],
  names?: Record<string, string>,
): (readonly [string, string])[] => values.map((v) => [v, names?.[v] ?? label(v)] as const);

const SECTIONS: Record<Exclude<Tab, 'dashboard' | 'about'>, Section[]> = {
  effects: [
    {
      title: 'Animation',
      description:
        'Settings you change here override the active preset. Use ↺ to go back to the preset value.',
      controls: [
        { kind: 'select', key: 'effect', label: 'Effect', options: [] },
        { kind: 'range', key: 'intensity', label: 'Intensity', step: 1 },
        { kind: 'range', key: 'particleCount', label: 'Particles per keystroke', step: 1 },
        { kind: 'range', key: 'particleSize', label: 'Particle size', step: 0.5, unit: 'px' },
        { kind: 'range', key: 'particleSpeed', label: 'Particle speed', step: 0.05, unit: '×' },
        {
          kind: 'range',
          key: 'particleLifetime',
          label: 'Animation duration',
          step: 10,
          unit: 'ms',
        },
        {
          kind: 'select',
          key: 'particleShape',
          label: 'Particle shape',
          options: options(PARTICLE_SHAPES, { auto: 'Effect default' }),
        },
      ],
    },
  ],
  personalization: [
    {
      title: 'Colours',
      controls: [
        {
          kind: 'colors',
          key: 'colors',
          label: 'Particle palette',
          help: 'Up to 12 colours. Effects pick from this palette; Fire treats it as hot → cool.',
        },
      ],
    },
    {
      title: 'Cursor and background effects',
      controls: [
        {
          kind: 'select',
          key: 'cursor.effect',
          label: 'Cursor effect',
          options: options(CURSOR_EFFECT_IDS, {
            none: 'None',
            glow: 'Glow',
            sparks: 'Sparks when moving',
            ring: 'Energy ring',
            trail: 'Trail when moving',
          }),
        },
        {
          kind: 'toggle',
          key: 'screenShake.enabled',
          label: 'Impact Pulse on combo milestones',
          help: 'Shakes the celebration burst and the combo badge. The editor text never moves.',
        },
        { kind: 'range', key: 'screenShake.intensity', label: 'Impact Pulse strength', step: 1 },
        {
          kind: 'range',
          key: 'screenShake.duration',
          label: 'Impact Pulse duration',
          step: 10,
          unit: 'ms',
        },
        {
          kind: 'toggle',
          key: 'screenShake.flashLine',
          label: 'Flash the cursor line on milestones',
        },
      ],
    },
    {
      title: 'Animation preferences',
      controls: [
        {
          kind: 'select',
          key: 'placement',
          label: 'Placement',
          options: options(PLACEMENT_MODES, {
            auto: 'Full-circle where possible',
            cursorLine: 'Always rise from the cursor line',
          }),
          help: 'Use "Always rise" with editor font zoom or proportional fonts.',
        },
        { kind: 'toggle', key: 'triggerOnDelete', label: 'Effects for Backspace and Delete' },
      ],
    },
    {
      title: 'Combo display',
      controls: [
        { kind: 'toggle', key: 'combo.enabled', label: 'Track combos' },
        {
          kind: 'toggle',
          key: 'combo.showIndicator',
          label: 'Show the combo badge next to the code',
        },
        { kind: 'toggle', key: 'combo.showInStatusBar', label: 'Show the combo in the status bar' },
        {
          kind: 'range',
          key: 'combo.resetTime',
          label: 'Reset after inactivity',
          step: 100,
          unit: 'ms',
        },
        {
          kind: 'numberList',
          key: 'combo.milestones',
          label: 'Milestones',
          help: 'Comma-separated counts, e.g. 10, 25, 50, 100.',
        },
      ],
    },
    {
      title: 'Where KeyBlaze runs',
      controls: [
        {
          kind: 'stringList',
          key: 'excludeLanguages',
          label: 'Excluded languages',
          placeholder: 'markdown, plaintext',
        },
        {
          kind: 'stringList',
          key: 'excludeFiles',
          label: 'Excluded files (glob)',
          placeholder: '**/*.min.js',
        },
      ],
    },
  ],
  performance: [
    {
      title: 'Performance',
      description:
        'Defaults are based on renderer measurements in VS Code. Lower them on slower machines.',
      controls: [
        {
          kind: 'toggle',
          key: 'performanceMode',
          label: 'Performance mode',
          help: 'Fewer particles, no glow and simpler animation.',
        },
        {
          kind: 'select',
          key: 'performance.quality',
          label: 'Animation quality',
          options: options(QUALITY_LEVELS),
        },
        {
          kind: 'range',
          key: 'performance.maxBurstsPerSecond',
          label: 'Max bursts per second',
          step: 1,
        },
        {
          kind: 'range',
          key: 'performance.maxConcurrentBursts',
          label: 'Max bursts on screen',
          step: 1,
        },
        {
          kind: 'range',
          key: 'performance.frameRateLimit',
          label: 'Preview frame-rate limit',
          step: 1,
          unit: 'fps',
          help: 'Applies to this preview; the editor animates with the renderer.',
        },
      ],
    },
    {
      title: 'Accessibility',
      description: 'KeyBlaze follows VS Code and OS accessibility preferences.',
      controls: [
        {
          kind: 'toggle',
          key: 'accessibility.respectReducedMotion',
          label: 'Respect reduced motion',
          help: 'With workbench.reduceMotion on (or auto + OS preference): tiny sparks, no Impact Pulse, no pulsing.',
        },
        {
          kind: 'toggle',
          key: 'accessibility.disableWithScreenReader',
          label: 'Pause while a screen reader is in use',
          help: 'When editor.accessibilitySupport is on: no effects, combos or sounds.',
        },
      ],
    },
    {
      title: 'Sound',
      description:
        'Original synthesised sounds, played through the KeyBlaze Sound view in the Explorer.',
      controls: [
        { kind: 'toggle', key: 'sound.enabled', label: 'Enable sound' },
        { kind: 'range', key: 'sound.volume', label: 'Volume', step: 0.05 },
        { kind: 'select', key: 'sound.theme', label: 'Theme', options: options(SOUND_THEMES) },
        {
          kind: 'select',
          key: 'sound.mode',
          label: 'When to play',
          options: options(SOUND_MODES, {
            milestones: 'Combo milestones only',
            everyKeystroke: 'Every keystroke (subtle)',
          }),
        },
      ],
    },
  ],
};

let state: PanelState | undefined;
/** Values changed in the UI but not yet confirmed by the host (keeps the preview responsive). */
const pending = new Map<SettingKey, unknown>();
const timers = new Map<SettingKey, ReturnType<typeof setTimeout>>();
const refreshers: (() => void)[] = [];
let activeTab: Tab = (vscode.getState() as { tab?: Tab } | undefined)?.tab ?? 'dashboard';
let preview: Preview | undefined;
let notice: HTMLElement | undefined;

function settings(): KeyBlazeSettings {
  if (!state) throw new Error('no state');
  const merged = { ...state.settings } as Record<string, unknown>;
  for (const [k, v] of pending) merged[k] = v;
  return merged as unknown as KeyBlazeSettings;
}

function setValue(key: SettingKey, value: unknown, immediate: boolean): void {
  pending.set(key, value);
  clearTimeout(timers.get(key));
  const flush = (): void => {
    timers.delete(key);
    send({ type: 'update', key, value });
  };
  if (immediate) flush();
  else timers.set(key, setTimeout(flush, 300));
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

function overrideMarker(key: SettingKey): HTMLElement {
  const wrap = el('span', { class: 'override' });
  const refresh = (): void => {
    wrap.replaceChildren();
    if (
      !state ||
      !(PRESETABLE_KEYS as readonly string[]).includes(key) ||
      !state.overridden.includes(key)
    )
      return;
    const btn = el(
      'button',
      {
        class: 'link',
        title: 'Overrides the preset. Click to use the preset value.',
        'aria-label': `Reset ${key} to the preset value`,
      },
      '↺',
    );
    btn.addEventListener('click', () => {
      pending.delete(key);
      send({ type: 'resetKey', key });
    });
    wrap.append(el('span', { class: 'dot', title: 'Overrides the preset' }, '•'), btn);
  };
  refreshers.push(refresh);
  return wrap;
}

function renderControl(c: Control): HTMLElement {
  const id = `ctl-${c.key.replace(/\./g, '-')}`;
  const row = el('div', { class: `row row-${c.kind}` });
  const head = el(
    'div',
    { class: 'row-head' },
    el('label', { for: id }, c.label),
    overrideMarker(c.key),
  );
  row.append(head);
  const spec = SETTING_SPECS[c.key];

  switch (c.kind) {
    case 'toggle': {
      const input = el('input', { type: 'checkbox', id, role: 'switch' });
      input.addEventListener('change', () => setValue(c.key, input.checked, true));
      refreshers.push(() => {
        input.checked = Boolean(settings()[c.key]);
        input.setAttribute('aria-checked', String(input.checked));
      });
      head.prepend(input);
      row.classList.add('inline');
      break;
    }
    case 'select': {
      const select = el('select', { id });
      const fill = (): void => {
        const opts =
          c.key === 'effect' && state
            ? state.effects.map((e) => [e.id, e.label] as const)
            : c.options;
        if (select.options.length !== opts.length) {
          select.replaceChildren(...opts.map(([v, l]) => el('option', { value: v }, l)));
        }
        select.value = String(settings()[c.key]);
      };
      select.addEventListener('change', () => setValue(c.key, select.value, true));
      refreshers.push(fill);
      row.append(select);
      break;
    }
    case 'range': {
      const { minimum = 0, maximum = 100 } = spec.meta;
      const input = el('input', {
        type: 'range',
        id,
        min: String(minimum),
        max: String(maximum),
        step: String(c.step),
      });
      const out = el('output', { for: id });
      const show = (v: number): void => {
        out.textContent = `${Number.isInteger(c.step) ? Math.round(v) : v.toFixed(2).replace(/\.?0+$/, '')}${c.unit ?? ''}`;
      };
      input.addEventListener('input', () => {
        show(Number(input.value));
        setValue(c.key, Number(input.value), false);
      });
      input.addEventListener('change', () => setValue(c.key, Number(input.value), true));
      refreshers.push(() => {
        if (document.activeElement === input && timers.has(c.key)) return; // don't fight the user's drag
        const v = Number(settings()[c.key]);
        input.value = String(v);
        show(v);
      });
      row.append(el('div', { class: 'range' }, input, out));
      break;
    }
    case 'colors': {
      const list = el('div', { class: 'colors', id, role: 'group', 'aria-label': c.label });
      const draw = (): void => {
        const colors = settings().colors;
        list.replaceChildren(
          ...colors.map((color, i) => {
            const input = el('input', {
              type: 'color',
              value: color,
              'aria-label': `Colour ${i + 1}`,
            });
            input.addEventListener('input', () => {
              const next = [...settings().colors];
              next[i] = input.value;
              setValue('colors', next, false);
            });
            input.addEventListener('change', () => setValue('colors', settings().colors, true));
            const remove = el(
              'button',
              { class: 'icon', title: 'Remove colour', 'aria-label': `Remove colour ${i + 1}` },
              '×',
            );
            remove.disabled = colors.length <= 1;
            remove.addEventListener('click', () =>
              setValue(
                'colors',
                colors.filter((_, j) => j !== i),
                true,
              ),
            );
            return el('span', { class: 'swatch' }, input, remove);
          }),
        );
        if (colors.length < 12) {
          const add = el(
            'button',
            { class: 'icon add', title: 'Add colour', 'aria-label': 'Add colour' },
            '+',
          );
          add.addEventListener('click', () =>
            setValue('colors', [...colors, colors[colors.length - 1] ?? '#ffffff'], true),
          );
          list.append(add);
        }
      };
      refreshers.push(() => {
        if (!list.contains(document.activeElement) || !timers.has('colors')) draw();
      });
      row.append(list);
      break;
    }
    case 'numberList':
    case 'stringList': {
      const input = el('input', {
        type: 'text',
        id,
        spellcheck: 'false',
        ...(c.kind === 'stringList' ? { placeholder: c.placeholder } : {}),
      });
      const commit = (): void => {
        const parts = input.value
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean);
        setValue(
          c.key,
          c.kind === 'numberList' ? parts.map(Number).filter((n) => Number.isFinite(n)) : parts,
          true,
        );
      };
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') commit();
      });
      refreshers.push(() => {
        if (document.activeElement !== input)
          input.value = (settings()[c.key] as unknown[]).join(', ');
      });
      row.append(input);
      break;
    }
  }
  if (c.help) row.append(el('p', { class: 'help' }, c.help));
  return row;
}

function renderSections(sections: Section[]): HTMLElement {
  const wrap = el('div', { class: 'sections' });
  for (const s of sections) {
    const box = el('section', { class: 'card' }, el('h2', {}, s.title));
    if (s.description) box.append(el('p', { class: 'muted' }, s.description));
    for (const c of s.controls) box.append(renderControl(c));
    wrap.append(box);
  }
  return wrap;
}

/** Colour chip. Styles are set through the CSSOM: the CSP blocks inline style attributes. */
function swatch(color: string): HTMLElement {
  const chip = el('span');
  chip.style.background = color;
  return chip;
}

function renderPresetGallery(): HTMLElement {
  const grid = el('div', { class: 'presets', role: 'list' });
  const draw = (): void => {
    if (!state) return;
    const current = settings().preset;
    grid.replaceChildren(
      ...state.presets.map((p) => {
        const colors = p.values.colors ?? settings().colors;
        const card = el(
          'div',
          { class: `preset${p.id === current ? ' active' : ''}`, role: 'listitem' },
          el(
            'div',
            { class: 'swatches', 'aria-hidden': 'true' },
            ...colors.slice(0, 6).map(swatch),
          ),
          el('strong', {}, p.label),
          el('span', { class: 'muted small' }, p.description),
        );
        const actions = el('div', { class: 'actions' });
        const apply = el(
          'button',
          {
            class: p.id === current ? 'secondary' : 'primary',
            'aria-pressed': String(p.id === current),
          },
          p.id === current ? 'Active' : 'Apply',
        );
        apply.addEventListener('click', () => {
          for (const k of PRESETABLE_KEYS) pending.delete(k);
          send({ type: 'applyPreset', id: p.id });
        });
        const show = el(
          'button',
          { class: 'secondary', title: `Preview ${p.label} without applying it` },
          'Preview',
        );
        show.addEventListener('click', () => preview?.previewValues({ ...p.values }));
        actions.append(apply, show);
        card.append(actions);
        return card;
      }),
    );
  };
  refreshers.push(draw);
  return el('section', { class: 'card' }, el('h2', {}, 'Presets'), grid);
}

function renderDashboard(): HTMLElement {
  const wrap = el('div', { class: 'sections' });
  const cards = el('div', { class: 'stats' });
  const stat = (title: string, value: () => string, cls = ''): HTMLElement => {
    const v = el('div', { class: `stat-value ${cls}` });
    refreshers.push(() => (v.textContent = value()));
    return el('div', { class: 'stat' }, el('div', { class: 'stat-title' }, title), v);
  };
  cards.append(
    stat('Status', () => (settings().enabled ? 'Enabled' : 'Disabled'), 'status'),
    stat('Preset', () => state?.presets.find((p) => p.id === settings().preset)?.label ?? ''),
    stat('Effect', () => state?.effects.find((e) => e.id === settings().effect)?.label ?? ''),
    stat('Intensity', () => `${settings().intensity} / 10`),
    stat('Combo', () =>
      settings()['combo.enabled'] ? `On · best ${state?.bestCombo ?? 0}` : 'Off',
    ),
    stat('Performance mode', () => (settings().performanceMode ? 'On' : 'Off')),
    stat(
      'Activity',
      () =>
        (state?.status.active ? 'Active' : (state?.status.description ?? '')) +
        (state?.status.reducedMotion ? ' · reduced motion' : ''),
    ),
  );
  refreshers.push(() => cards.classList.toggle('disabled', !settings().enabled));
  const actions = el('div', { class: 'actions' });
  const toggle = el('button', { class: 'primary' });
  refreshers.push(
    () => (toggle.textContent = settings().enabled ? 'Disable KeyBlaze' : 'Enable KeyBlaze'),
  );
  toggle.addEventListener('click', () => send({ type: 'command', command: 'toggle' }));
  const tryIt = el('button', { class: 'secondary' }, 'Preview in editor');
  tryIt.addEventListener('click', () => send({ type: 'command', command: 'previewInEditor' }));
  const settingsBtn = el('button', { class: 'secondary' }, 'Open settings');
  settingsBtn.addEventListener('click', () => send({ type: 'command', command: 'openSettings' }));
  const soundBtn = el('button', { class: 'secondary' }, 'Sound view');
  soundBtn.addEventListener('click', () => send({ type: 'command', command: 'openSoundView' }));
  actions.append(toggle, tryIt, settingsBtn, soundBtn);
  wrap.append(el('section', { class: 'card' }, el('h2', {}, 'Dashboard'), cards, actions));
  return wrap;
}

/** Brand asset URIs provided by the host (see ControlPanelProvider.html). */
function brandAsset(name: 'icon' | 'logoDark' | 'logoLight'): string {
  return document.getElementById('app')?.dataset[name] ?? '';
}

function renderAbout(): HTMLElement {
  const version = el('span');
  const vscodeVersion = el('span');
  refreshers.push(() => {
    version.textContent = state?.version ?? '';
    vscodeVersion.textContent = state?.vscodeVersion ?? '';
  });
  const docs = el('button', { class: 'secondary' }, 'Documentation');
  docs.addEventListener('click', () => send({ type: 'command', command: 'openDocs' }));
  const reset = el('button', { class: 'danger' }, 'Reset all settings…');
  reset.addEventListener('click', () => {
    pending.clear();
    send({ type: 'resetAll' });
  });
  return el(
    'div',
    { class: 'sections' },
    el(
      'section',
      { class: 'card about' },
      // Full logo: the dark-background artwork on dark/high-contrast themes, the light one on light themes.
      el(
        'div',
        { class: 'about-logo' },
        el('img', { class: 'logo-dark', src: brandAsset('logoDark'), alt: 'KeyBlaze' }),
        el('img', { class: 'logo-light', src: brandAsset('logoLight'), alt: 'KeyBlaze' }),
      ),
      el('h2', { class: 'visually-hidden' }, 'KeyBlaze'),
      el('p', { class: 'tagline' }, 'Make Every Keystroke Count.'),
      el(
        'dl',
        {},
        el('dt', {}, 'Version'),
        el('dd', {}, version),
        el('dt', {}, 'VS Code'),
        el('dd', {}, vscodeVersion),
      ),
      el(
        'p',
        {},
        'Particle bursts, fire, lightning, combos and cursor effects for VS Code, rendered with supported extension APIs only (decorations and webviews), with no changes to VS Code itself.',
      ),
      el('h3', {}, 'Credits'),
      el(
        'p',
        { class: 'muted' },
        'Built by the KeyBlaze contributors. All effects are generated procedurally; no third-party art or assets from the former Power Mode extension are used.',
      ),
      el('div', { class: 'actions' }, docs, reset),
    ),
  );
}

function render(): void {
  const app = document.getElementById('app');
  if (!app || !state) return;
  refreshers.length = 0;
  const tabs = el('div', {
    class: 'tabs',
    role: 'tablist',
    'aria-label': 'Control Panel sections',
  });
  const panels = el('div', { class: 'panels' });
  for (const t of TABS) {
    const tab = el(
      'button',
      { class: 'tab', role: 'tab', id: `tab-${t}`, 'aria-controls': `panel-${t}` },
      TAB_LABELS[t],
    );
    const panel = el('div', {
      class: 'panel',
      role: 'tabpanel',
      id: `panel-${t}`,
      'aria-labelledby': `tab-${t}`,
    });
    const select = (): void => {
      activeTab = t;
      vscode.setState({ tab: t });
      for (const b of tabs.querySelectorAll<HTMLButtonElement>('.tab')) {
        const on = b.id === `tab-${t}`;
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
      }
      for (const p of panels.querySelectorAll<HTMLElement>('.panel'))
        p.hidden = p.id !== `panel-${t}`;
    };
    tab.addEventListener('click', select);
    tab.addEventListener('keydown', (e) => {
      const i = TABS.indexOf(t);
      const next =
        e.key === 'ArrowRight'
          ? TABS[(i + 1) % TABS.length]
          : e.key === 'ArrowLeft'
            ? TABS[(i + TABS.length - 1) % TABS.length]
            : undefined;
      if (next) {
        e.preventDefault();
        const b = document.getElementById(`tab-${next}`);
        b?.click();
        b?.focus();
      }
    });
    tabs.append(tab);
    if (t === 'dashboard') panel.append(renderDashboard());
    else if (t === 'about') panel.append(renderAbout());
    else if (t === 'effects') panel.append(renderPresetGallery(), renderSections(SECTIONS.effects));
    else panel.append(renderSections(SECTIONS[t]));
    panels.append(panel);
  }

  const canvas = el('canvas', {
    class: 'preview-canvas',
    'aria-label': 'Live effect preview. Click to fire a burst.',
    role: 'img',
  });
  const badge = el('img', { class: 'preview-badge', alt: '' });
  badge.hidden = true;
  const variant = el(
    'select',
    { 'aria-label': 'Preview placement' },
    el('option', { value: 'full' }, 'Full circle'),
    el('option', { value: 'upward' }, 'Rising (cursor line)'),
  );
  variant.addEventListener('change', () =>
    preview?.setVariant(variant.value === 'upward' ? 'upward' : 'full'),
  );
  const burst = el('button', { class: 'secondary' }, 'Burst');
  burst.addEventListener('click', () => preview?.burstNow());
  notice = el('div', { class: 'notice', role: 'status' });
  const aside = el(
    'aside',
    { class: 'preview' },
    el(
      'div',
      { class: 'preview-head' },
      el('h2', {}, 'Live preview'),
      el('div', { class: 'preview-tools' }, variant, burst),
    ),
    el('div', { class: 'preview-stage' }, canvas, badge),
    el(
      'p',
      { class: 'muted small' },
      'Uses the same engine as the editor. Click the preview to fire a burst.',
    ),
  );

  app.replaceChildren(
    el(
      'header',
      { class: 'top' },
      el('img', {
        class: 'brand-mark',
        src: brandAsset('icon'),
        alt: '',
        width: '32',
        height: '32',
      }),
      el('h1', {}, 'KeyBlaze'),
      el('span', { class: 'muted' }, 'Make Every Keystroke Count.'),
    ),
    tabs,
    notice,
    el('div', { class: 'layout' }, panels, aside),
  );
  preview = new Preview(canvas, badge, settings);
  preview.start();
  document.getElementById(`tab-${activeTab}`)?.click();
  refresh();
}

function refresh(): void {
  for (const r of refreshers) r();
}

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  if (message.type === 'state') {
    const first = state === undefined;
    state = message.state;
    // Drop pending values the host has now confirmed (or rejected).
    for (const key of [...pending.keys()]) if (!timers.has(key)) pending.delete(key);
    if (first) render();
    else refresh();
    // The preview pauses while VS Code is unfocused (no work in the background).
    if (state.status.windowFocused) preview?.start();
    else preview?.stop();
  } else if (message.type === 'notice' && notice) {
    notice.textContent = message.text;
    notice.className = `notice ${message.level}`;
    setTimeout(() => notice && (notice.textContent = ''), 5000);
  }
});

const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const reportMotion = (): void =>
  send({ type: 'environment', prefersReducedMotion: motionQuery.matches });
motionQuery.addEventListener('change', reportMotion);
send({ type: 'ready' });
reportMotion();
