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
- Combo badge: at most 4 re-renders per second. Cursor aura: at most 10 moves per second.
- Fireworks glow on one in three particles. The Cosmic Explosion preset uses 24 particles.
- No work at all while KeyBlaze is disabled, a screen reader is in use, or the window is unfocused.
  Inlay-hint queries run only when they can affect placement.
- No leaks: CSS rule and DOM node counts return to baseline after hundreds of bursts (spike run 4).
