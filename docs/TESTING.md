<p align="left">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="../media/logo/Light_Background_application.png">
    <img src="../media/logo/Full_Logo.png" alt="KeyBlaze" width="240">
  </picture>
</p>

# Testing and compatibility

## Test layers

| Layer                                          | Command                                                | What it covers                                                                                                                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static checks                                  | `npm run check`                                        | Typecheck (extension and webview), ESLint, Prettier, unit tests                                                                                                                                                                                         |
| Unit (Mocha, plain Node)                       | `npm run test:unit`                                    | Pure modules: settings schema and resolution, typing classifier, particle and animation engines, every effect in both variants, placement maths, SVG and Canvas sampling, combo manager, Impact Pulse, motion policy, sound recipes, message validation |
| Coverage                                       | `npm run test:coverage`                                | `c8` over the pure modules (the VS Code-dependent services are covered by the next two layers)                                                                                                                                                          |
| Integration (real VS Code)                     | `npm run test:integration` / `npm run test:min-vscode` | The extension running in VS Code (current stable / 1.90.0), driven through the VS Code API and real commands                                                                                                                                            |
| Visual and behavioural (real VS Code over CDP) | `npm run test:visual`                                  | Genuine keystrokes and clicks. Measures where effects are drawn relative to the caret, text shift, animation, the Control Panel UI, themes and audio playback                                                                                           |
| Performance                                    | `npm run test:performance`                             | Keystroke → caret latency, frame gaps and renderer load for several configurations ([PERFORMANCE.md](PERFORMANCE.md))                                                                                                                                   |

The visual, behavioural and performance scripts use the Chrome DevTools Protocol as **test tooling
only**. The extension itself uses only the official VS Code API.

## Latest results (2026-11-19, Windows 11)

| Suite                                                | VS Code 1.147.0                                | VS Code 1.90.0                  |
| ---------------------------------------------------- | ---------------------------------------------- | ------------------------------- |
| Unit                                                 | 287 passing                                    | n/a (no VS Code)                |
| Integration                                          | 67 passing                                     | 67 passing (3 consecutive runs) |
| Placement (12 cases)                                 | max dx 0.48 px · max dy 0.64 px · text shift 0 | identical                       |
| Combo, badge, Impact Pulse, cursor auras (11 checks) | all pass                                       | all pass                        |
| Control Panel (7 checks, incl. real clicks)          | all pass                                       | all pass                        |
| Sound (real click unlock, WebAudio playback)         | pass                                           | pass                            |
| Unit coverage of pure modules                        | 99.6 % statements · 95.1 % branches            |                                 |

## Requirement → tests

| Requirement                                                    | Unit                                               | Integration                                                                                                                 | Visual / behavioural                         |
| -------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Extension activation                                           |                                                    | Activation suite                                                                                                            | every visual script                          |
| Extension deactivation / disposal                              |                                                    | _Deactivation and disposal_ (an isolated instance goes silent after its subscriptions are disposed; double dispose is safe) |                                              |
| Configuration loading and validation                           | schema, resolve (incl. package.json sync)          | invalid values ignored                                                                                                      |                                              |
| Configuration updates (live, scopes)                           |                                                    | live changes, workspace scope precedence, reset                                                                             | panel slider writes                          |
| Effect selection and presets                                   | effects, presets                                   | change/next/previous effect, apply preset, Change Effect quick pick                                                         | preset gallery clicks                        |
| Particle lifecycle                                             | ParticleEngine (birth, death, pooling, bounds)     | bursts expire, pool cap, editor closed mid-burst                                                                            |                                              |
| Combo counting and reset                                       | ComboManager                                       | Combo suite                                                                                                                 | badge and milestone checks                   |
| Performance limits                                             | rate limiter, typing-rate budget, quality profiles | pacing, fast-typing budget                                                                                                  | performance script                           |
| Multiple editor groups                                         |                                                    | split editors                                                                                                               | split-editor placement                       |
| Webview communication                                          | protocol validation                                | Control Panel suite (real round trip, rejection of malformed input)                                                         | panel round trip and clicks                  |
| Command registration                                           |                                                    | every contributed command registered                                                                                        |                                              |
| Error handling                                                 | `safely`, invalid messages                         | failing handler contained, closed editors, malformed messages                                                               | measurement harness tolerates vanished nodes |
| Not typing: paste, undo, redo, completions, programmatic edits | TypingClassifier                                   | _Edits that are not typing_                                                                                                 |                                              |
| Accessibility                                                  | motion policy                                      | screen reader, reduced motion, opt-outs                                                                                     |                                              |
| Sound                                                          | recipes                                            | view resolves, milestones, rate limit, screen-reader pause                                                                  | real audio playback                          |

## Manual validation checklist

These are things automation can't judge, or that need hardware or environments not available here.

- [ ] Effects look right and feel good in daily use, for every preset, in dark and light editor themes.
- [ ] Sounds are pleasant at the default volume for every theme.
- [ ] A real screen reader (NVDA, JAWS, VoiceOver) with `editor.accessibilitySupport: on`: no effects, no sound.
- [ ] OS "reduce motion" on, with `workbench.reduceMotion: auto`: calm effects after the Control Panel or Sound view has been opened once.
- [ ] Notebooks (`.ipynb` cells), diff editors and the inline chat input: effects only where expected.
- [ ] Remote development (WSL, SSH, Dev Containers) and Codespaces.
- [ ] macOS and Linux (font metrics differ, so check vertical centring).
- [ ] High-DPI displays and 60 Hz displays.

## Compatibility statement

- **Tested:** VS Code **1.90.0** (the minimum declared in `engines`) and **1.147.0**, on **Windows 11 x64**.
- **Not yet tested:** macOS, Linux, remote and Codespaces environments, VS Code Insiders, and VSCodium.
  The CI workflow (`.github/workflows/ci.yml`) is ready to run the unit and integration suites on Windows,
  macOS and Linux against both versions, but it hasn't been executed yet because the project has no remote.
- **Not supported:** VS Code for the Web (vscode.dev). The extension has no `browser` entry point.
- **Version-specific fix found by testing:** VS Code 1.90 doesn't re-evaluate `config.*` view
  `when` clauses at runtime. The Sound view therefore uses an extension-managed context key
  (`keyblaze.soundEnabled`).
