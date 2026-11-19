<p align="left">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="../media/logo/Light_Background_application.png">
    <img src="../media/logo/Full_Logo.png" alt="KeyBlaze" width="240">
  </picture>
</p>

# KeyBlaze performance

Measured with the real extension in VS Code 1.147.0 (Windows 11, 144 Hz display) using
`npm run test:performance` (`test/visual/verify-performance.mjs`). Keystrokes are genuine, sent through
the Chrome DevTools Protocol at fixed rates into a plaintext document. A non-blocking probe inside the
page measures the time from keydown to the first animation frame in which VS Code moved the caret.

"Renderer busy" is the VS Code window's renderer task time per second. It includes painting at the
display's refresh rate, so it reads lower on 60 Hz displays.

| Typing | Configuration                          | Keystroke → caret p50 / p95 | Frames > 50 ms | Renderer busy |
| ------ | -------------------------------------- | --------------------------- | -------------- | ------------- |
| 12/s   | KeyBlaze disabled                      | 10.3 / 17.2 ms              | 0              | 23 %          |
| 12/s   | Defaults (Classic Burst + combo badge) | 10.3 / 13.8 ms              | 0              | 63 %          |
| 12/s   | Defaults + cursor glow + Impact Pulse  | 10.0 / 13.4 ms              | 0              | 72 %          |
| 12/s   | Cosmic Explosion (heaviest preset)     | 9.6 / 19.5 ms               | 1              | 74 %          |
| 12/s   | Cosmic Explosion + performance mode    | 9.9 / 16.3 ms               | 0              | 68 %          |
| 25/s   | KeyBlaze disabled                      | 10.6 / 16.0 ms              | 0              | 42 %          |
| 25/s   | Defaults                               | 9.6 / 13.9 ms               | 0              | 85 %          |
| 25/s   | Defaults + cursor glow + Impact Pulse  | 9.5 / 14.3 ms               | 0              | 89 %          |
| 25/s   | Cosmic Explosion                       | 10.2 / 18.6 ms              | 0              | 92 %          |
| 25/s   | Cosmic Explosion + performance mode    | 9.5 / 13.2 ms               | 0              | 82 %          |

**Typing latency is unaffected in every configuration.** Renderer headroom shrinks with heavier
looks at very fast typing rates. On slower machines, use performance mode, lower the quality, or lower
the bursts-per-second limit.

## CPU across all VS Code processes

Measured with `node test/visual/measure-cpu.mjs`: operating-system CPU time of every process of an
isolated VS Code 1.147.0 (renderer, GPU, extension host, main and helpers), as a percentage of one
core. Windows 11, high-refresh (≥ 144 Hz) display, genuine keystrokes at 8 per second (about
95 words per minute). Repeated runs vary by roughly ±15 %.

| Configuration                       | Typing | First 1.5 s after typing | Idle, 10–18 s after typing |
| ----------------------------------- | ------ | ------------------------ | -------------------------- |
| KeyBlaze disabled                   | 32 %   | 16 %                     | 1 %                        |
| Classic Burst (default)             | 121 %  | 32 %                     | 2 %                        |
| Firestorm (cursor glow)             | 180 %  | 46 %                     | 0–7 %                      |
| Lightning Strike                    | 102 %  | 18 %                     | 0–6 %                      |
| Neon Energy (cursor ring)           | 117 %  | 47 %                     | 0–5 %                      |
| Cosmic Explosion                    | 178 %  | 20 %                     | 0–6 %                      |
| Starfall (cursor glow)              | 128 %  | 53 %                     | 0–5 %                      |
| Minimal Sparks                      | 89 %   | 34 %                     | 0–5 %                      |
| Rainbow Rush                        | 153 %  | 22 %                     | 0–6 %                      |
| Cyberpunk                           | 113 %  | 18 %                     | 0–10 %                     |
| Clean Mode                          | 94 %   | 15 %                     | 0–5 %                      |
| Cosmic Explosion + performance mode | 111 %  | 24 %                     | 0–5 %                      |

- **While typing**, the renderer and the GPU process carry the cost (Cosmic Explosion: 78 % renderer,
  95 % GPU, 4 % extension host). Animated SVG images are repainted on every display frame, so the
  cost scales with the refresh rate and is lower on 60 Hz displays.
- **After typing**, bursts end within their lifetime (0.3–1 s) and the combo badge 3 s later. The
  0–10 % in the idle column is a one-off renderer clean-up about 15–20 s after typing (no script,
  layout or style work), followed by 0 %.
- **Window unfocused:** 0–2 %. Effects pause and the cursor aura is removed.
- **Switching tabs while bursts are on screen:** bursts in the hidden editor are released, nothing
  stays active, and idle CPU returns to baseline.
- **Control Panel:** 50–60 % while it is open and visible (the live preview animates by design),
  1 % while it is behind another tab (the webview is suspended), and back to baseline once closed.
- **Reduced motion:** Cosmic Explosion typing drops from 178 % to 97 %, and the cursor aura is static.
  **Screen reader optimisation:** 38 %, the same as with KeyBlaze disabled.

### Cursor aura at rest

The glow and ring cursor effects (also part of Firestorm, Starfall and Neon Energy) pulse with a
looping animation. A looping animated image makes Chromium paint every display frame, which measured
25–45 % of a core for as long as the editor stayed focused, even with no typing at all. The aura now
pulses while the caret is in use and rests as a static image after 5 seconds without caret activity.
The next keystroke or caret move starts the pulse again.

| Idle, cursor aura on screen | Before | After (resting) |
| --------------------------- | ------ | --------------- |
| Firestorm                   | 43 %   | 0–7 %           |
| Neon Energy                 | 37 %   | 0–5 %           |
| Starfall                    | 31 %   | 0–5 %           |
| Classic Burst + glow        | 26 %   | 0–4 %           |
| Classic Burst + ring        | 24 %   | 0–6 %           |

A stepped (`calcMode="discrete"`) animation was also measured. It saves little: 25 % → 9 % for the
aura and 64 % → 55 % for bursts. It wasn't adopted.

## Memory over a 30-minute session

Measured with `node test/visual/soak-memory.mjs`: 30 minutes of typing with every preset in rotation,
7,350 bursts, 95 milestone celebrations with Impact Pulse, palette changes, tab switches, and the
Control Panel opened and closed 6 times. Samples are taken after a forced garbage collection.

| Sample                                | Start   | 10 min  | 20 min  | 30 min  |
| ------------------------------------- | ------- | ------- | ------- | ------- |
| Extension host heap after GC          | 43.6 MB | 38.5 MB | 39.1 MB | 39.6 MB |
| Workbench renderer JS heap after GC   | 89 MB   | 94 MB   | 95 MB   | 96 MB   |
| Workbench CSS rules                   | 12,572  | 12,613  | 12,613  | 12,613  |
| KeyBlaze active bursts / tracked docs | 0 / 2   | 0 / 2   | 0 / 2   | 0 / 2   |

No leak: CSS rules and KeyBlaze's own bookkeeping stay constant. The cached flash decoration types
stay at 12 or fewer and are released on every palette change. Renderer process memory rises from
about 300 MB to a plateau of 390–480 MB within the first five minutes (image and raster caches) and
stays there.

## Where the cost goes

Isolated measurements, from the rendering spike ([SPIKE_REPORT.md](SPIKE_REPORT.md) §Q6):

- **Extension host:** 0.1–1 ms per burst (simulation, SVG and encoding). Negligible.
- **Renderer style recalculation:** ~4.5 ms per new effect image. Every unique image adds a CSS rule to
  a workbench with ~12,500 rules.
- **Renderer rasterisation:** ~50 ms of renderer time per burst over its life. The animated SVG is
  re-rasterised every frame. Glow halos and image area dominate.

## Budget decisions

- Bursts: at most 12/s, evenly paced. 8 on screen at once. At most 40 particles. Glow only at
  `high` quality. Half-extent ≤ 120 px.
- Above 12 keystrokes/s, bursts shrink (fewer particles, shorter life), down to half at 24/s.
- Combo badge: at most 4 re-renders per second. Cursor aura: at most 10 moves per second, and no
  pulsing after 5 seconds without caret activity.
- Fireworks glow on one in three particles. The Cosmic Explosion preset uses 24 particles.
- No work at all while KeyBlaze is disabled, a screen reader is in use, or the window is unfocused.
  Inlay-hint queries run only when they can affect placement.
- No leaks: CSS rule and DOM node counts return to baseline after hundreds of bursts (spike run 4).
