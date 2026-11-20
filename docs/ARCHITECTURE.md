<p align="left">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="../media/logo/Light_Background_application.png">
    <img src="../media/logo/Full_Logo.png" alt="KeyBlaze" width="240">
  </picture>
</p>

# KeyBlaze — Phase 1: Feasibility & Architecture

Status: **Approved** (Impact Pulse instead of text shake; sound via webview view; git checkpoints per phase)
Environment inspected: empty directory · Node 22.23.1 · npm 12.2.1 · VS Code 1.147.0 (Win32 x64) · git 2.51.2

---

## 1. The core constraint

VS Code extensions run in the **extension host** (a Node process). They have **no access to the
workbench DOM**: they cannot add a `<canvas>` over the editor, read pixel coordinates of the cursor,
or apply CSS transforms to the editor. Webviews are isolated iframes in their own panels/views and
**cannot overlay a text editor**.

The original Power Mode got around this by abusing the decoration API: it put raw CSS into the
`textDecoration` string (e.g. `"none; position: absolute; transform: ..."`), which VS Code pasted
into a generated stylesheet without sanitising it. That is undocumented, has been the subject of
tightening in the past, and is exactly the "fragile hack" this project must avoid.

## 2. The supported rendering path: decorations + generated animated SVG

The `TextEditorDecorationType` API is fully supported and is **anchored to document ranges, not
pixels**. That means we don't need cursor coordinates: we attach the effect to the cursor's position
and VS Code places it, keeps it there through scrolling and edits, and handles split editors.

Per keystroke:

1. The **ParticleEngine** (pure TypeScript, no `vscode` import) simulates a burst: spawn particles
   with position/velocity/colour/size/lifetime, integrate physics (gravity, drag, flicker) and
   sample each particle's trajectory into a few keyframes.
2. The **SvgRenderer** turns those keyframes into a small self-contained **animated SVG** (SMIL
   `<animate>` / `<animateTransform>` with `fill="freeze"` and fade-out). Each burst is unique.
3. The SVG is shown through a decoration `after` attachment using only documented properties:
   `contentIconPath` (data URI), `width`, `height` and `margin`. A negative margin equal to the
   width gives the attachment **zero net layout width**, so the text, the caret and column
   measurement are not shifted.
4. After the burst's lifetime the decoration is cleared and its slot goes back to the pool.

**Decoration slot pool.** Calling `setDecorations` again on a decoration type can re-render its
existing instances and restart their animations. So KeyBlaze keeps a fixed ring of N decoration
types (N = the "max concurrent bursts" setting) and each burst takes one slot. This is object
pooling for decorations, and it puts a hard cap on DOM and CSS growth.

**What this supports:** particle bursts, fire, lightning, energy rings, fireworks, stars, minimal mode,
cursor glow/ring/trails, multi-cursor, and every visible editor in every editor group.

**Risks to verify in a Phase 2 spike** (I can't see VS Code's rendering myself, so you will need to
check these by eye with F5):

| Risk                                                       | Fallback                                                                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Attachment taller than the line gets clipped               | Smaller vertical extent and wider horizontal spread; or stack the burst across adjacent-line decorations |
| `data:` URI rejected by `contentIconPath`                  | Write the generated SVGs to `globalStorageUri` (a small recycled file pool) and use file URIs            |
| Re-rendering a line (scrolling) restarts the SVG animation | Acceptable: bursts are short (≤ 1 s) and are cleared on schedule                                         |
| Particles drawn under the text of the next line            | Cosmetic only. Mitigate with semi-transparent particles near the glyph centre                            |

## 3. Feature-by-feature feasibility

| Feature                                                                  | Feasible with supported APIs? | Approach                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Particle / Fire / Lightning / Energy / Fireworks / Stars / Minimal       | ✅ Yes                        | Engine → animated SVG → decoration slot (§2)                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Customisable colours, size, speed, lifetime, count, intensity            | ✅ Yes                        | Engine parameters from settings; live reload through `onDidChangeConfiguration`                                                                                                                                                                                                                                                                                                                                                                                   |
| Combo counter + streaks + milestones                                     | ✅ Yes                        | `ComboManager` (pure). Indicator = animated SVG badge decoration at the end of the cursor line (never over code), plus a status-bar mirror                                                                                                                                                                                                                                                                                                                        |
| **Screen shake (moving the editor text)**                                | ❌ **Not reliably**           | Moving the text needs CSS-injection hacks or `margin` decorations on every visible line. That forces a relayout on every frame and makes the caret and the text visibly jump. **Rejected.**                                                                                                                                                                                                                                                                       |
| ↳ Proposed alternative: **Impact Pulse**                                 | ✅ Yes                        | Milestone hits shake _the effect layer itself_ (the burst SVG jitters and the combo badge shakes), plus an optional brief flash on the cursor line using a stepped `backgroundColor` decoration. The editor text never moves. Setting names stay `keyblaze.screenShake.*`                                                                                                                                                                                         |
| Cursor effects (glow, sparks, ring, trails)                              | ✅ Yes                        | Same SVG pipeline, anchored at `selection.active` for every selection, refreshed on `onDidChangeTextEditorSelection` (throttled)                                                                                                                                                                                                                                                                                                                                  |
| Multiple editor groups / split editors                                   | ✅ Yes                        | Decorations are per-`TextEditor`; the effect is applied to the editor whose document changed (all visible editors of that doc)                                                                                                                                                                                                                                                                                                                                    |
| Sound effects                                                            | ⚠️ Partially                  | The extension host has no audio. Sound plays inside a **webview** using **WebAudio-synthesised** sounds: original, no licensing issues, several themes. Needs the KeyBlaze webview _view_ (Explorer/Panel, `retainContextWhenHidden`) to have been opened once, and one click in it to satisfy Chromium's autoplay policy. Off by default; milestone-only unless "every keystroke" is chosen. Spawning OS audio processes per keystroke was rejected as too heavy |
| Control Panel                                                            | ✅ Yes                        | `WebviewPanel`, VS Code theme CSS variables (light/dark/high-contrast), strict CSP with nonce, typed message protocol                                                                                                                                                                                                                                                                                                                                             |
| Effect preview                                                           | ✅ Yes                        | The same ParticleEngine, drawn by a **Canvas2D renderer** in the webview (accurate preview, frame-rate limited)                                                                                                                                                                                                                                                                                                                                                   |
| Reduced motion                                                           | ✅ Yes                        | Honour `workbench.reduceMotion` (`on` / `auto` / `off`) in the host and `prefers-reduced-motion` in webviews. With screen-reader mode (`editor.accessibilitySupport`) effects are off by default                                                                                                                                                                                                                                                                  |
| Reduced animation when unfocused                                         | ✅ Yes                        | `window.state.focused` / `onDidChangeWindowState`. No new bursts while unfocused; timers paused                                                                                                                                                                                                                                                                                                                                                                   |
| Ignore programmatic / bulk edits                                         | ✅ Mostly                     | `onDidChangeTextDocument` heuristics: ignore `reason === Undo/Redo`, documents not in a visible editor, non-file schemes (output, git, …), large inserts (paste, format, completion), and changes of more than K ranges. Small auto-closing pairs and multi-cursor typing count as one keystroke. VS Code cannot tell a _keystroke_ from an extension's tiny edit, so this is a heuristic, documented as such                                                     |
| Frame-rate limit                                                         | ⚠️ Partially                  | It applies to the canvas preview. In the editor the browser drives SVG animation, so performance is controlled through burst throttling (bursts/sec), max concurrent bursts, particle count and keyframe count instead                                                                                                                                                                                                                                            |
| Does not interfere with typing, undo, IntelliSense, debugging, scrolling | ✅ Yes, by design             | Decorations never modify the document or the undo stack, never take focus, and have zero net width. Work done on each keystroke is O(particles) string building, debounced                                                                                                                                                                                                                                                                                        |

## 4. Proposed project layout

```
src/
  extension.ts                 activate/deactivate: composition root only
  commands/registerCommands.ts all 9 commands
  config/
    schema.ts                  typed settings model + defaults + validation/clamping
    presets.ts                 10 presets (pure data)
  core/                        ── NO `vscode` imports (unit-testable in plain Node) ──
    ParticleEngine.ts          pooled particles, physics, keyframe sampling
    AnimationEngine.ts         burst scheduling, throttle, lifetime, slot accounting
    ComboManager.ts            count, milestones, inactivity reset (injectable clock)
    PerformanceManager.ts      budgets, perf mode, focus/reduced-motion scaling
    random.ts                  seeded PRNG (deterministic tests)
  effects/                     each effect = pure spawn/update strategy
    Effect.ts                  interface
    ParticleBurst.ts FireEffect.ts LightningEffect.ts EnergyBurst.ts
    FireworksEffect.ts StarEffect.ts MinimalEffect.ts
    registry.ts
  render/
    SvgRenderer.ts             burst → animated SVG string (pure)
  services/
    SettingsService.ts         reads/writes config, emits typed change events
    TypingDetector.ts          genuine-typing heuristics
    DecorationRenderer.ts      slot pool of decoration types (vscode adapter)
    EditorPositionService.ts   active positions for editors/selections
    StatusBarService.ts
  providers/
    ControlPanelProvider.ts    WebviewPanel host + message protocol
    SoundViewProvider.ts       WebviewView for WebAudio sound
  webview/                     browser-side code (bundled separately)
    controlPanel.ts  canvasRenderer.ts  sound.ts  protocol.ts
  types/
media/ icons/ styles/          (no sound files: synthesised)
test/
  unit/                        mocha in Node: engine, combo, effects, svg, config, detector
  suite/                       @vscode/test-electron: activation, commands, config, editors, webview msgs
  fixtures/
```

**Tooling:** TypeScript (strict), **esbuild** to bundle (two small bundles: extension and webview;
fast, one dev dependency), ESLint 9 flat config + typescript-eslint, Prettier, Mocha,
`@vscode/test-cli` + `@vscode/test-electron`, `@vscode/vsce`. **Zero runtime dependencies.**

**Minimum VS Code version:** a target of `^1.90.0` is proposed. It will be verified in Phase 8 by
running the integration suite against both 1.90.0 and current stable (1.147.0) via test-electron.
Only versions that were actually tested will be claimed.

---

## Update after the rendering spike (Phase 4)

The spike ([SPIKE_REPORT.md](SPIKE_REPORT.md)) changed §2 in two ways:

- **Decoration images are baseline-pinned.** Their bottom edge sits on the anchor line's text baseline,
  and margins can't move them vertically. A zero-height margin (`margin-top = -height`) is required,
  otherwise the line's own text is pushed down.
- **Placement is decided per keystroke** in `src/core/placement.ts` (pure, unit-tested):
  - **below-anchored**: full-circle effects. The decoration sits at column 0 of a line N below the caret,
    is shifted right by the caret's visual column in `ch`, and its SVG is padded so that the origin
    lands on the caret line.
  - **caret-anchored**: effects use their _upward_ variant. This is the fallback next to wide
    characters, inlay hints (cached by `InlayHintTracker`), folds or the viewport edge (`visibleRanges`),
    possible word wrap and the end of the document. It's also used for `keyblaze.placement:
cursorLine`.
- **Every burst SVG carries a nonce.** Chromium shares one SMIL timeline per image URL.
- **Renderer budget:** ≤ 12 bursts/s, evenly paced (minimum gap 0.75 × 1000/limit), 8 concurrent,
  ≤ 40 particles, glow only at high quality, half-extent ≤ 120 px.

`test/visual/verify-placement.mjs` (`npm run test:visual`) measures the real extension in VS Code over
CDP: the burst origin versus the caret, and the text shift.

## Fire: vector flame tongues

Fire is drawn with a dedicated `flame` element rather than particles. Each tongue is a closed outline
of four cubic Béziers (pointed tip, shoulders, rounded base) whose width, height, lean and asymmetry
change on every keyframe (`ParticleEngine` `flameTrack`). The SVG renderer morphs the outline with
SMIL (`<animate attributeName="d">`, constant command structure) and fills it with a shared vertical
gradient (cool edge at the tip, hot colour at the base). A radial-gradient ellipse adds a white-hot
core, and on the main tongues a soft glow. The Canvas preview draws the same geometry from
`render/flamePath.ts`. Tongues of one burst sway together, and typing heat (keystroke rate) makes
them burn higher.

Why vectors instead of sprites:

- **Animated GIF/APNG/WebP sprites** work through `contentIconPath`, but Chromium shares one
  animation timeline per image URL. Every burst would need its own copy of the bitmap to start at
  frame 0 (tens of kilobytes per keystroke). GIF also has only 1-bit transparency (fringes on light
  and dark themes), and bitmaps blur at window zoom.
- **Sprite sheets** need CSS keyframe animation of `background-position`. Decorations expose no such
  property, and injecting raw CSS through `textDecoration` is the unsupported hack KeyBlaze avoids.
- **Vector SMIL** keeps every burst unique (its own timeline), crisp at any zoom, fully transparent,
  palette-driven, and inside the existing pipeline. Per animated image it costs less than the old
  particle fire, because the images are smaller (see PERFORMANCE.md).
