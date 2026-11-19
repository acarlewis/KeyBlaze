# Changelog

All notable changes to KeyBlaze are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-19

First preview release.

### Added

- Typing effects rendered with supported decoration APIs: Particle Explosion, Fire, Lightning, Energy
  Burst, Fireworks, Stars and Minimal. Each has a full-circle and a rising variant.
- Ten presets: Classic Burst, Firestorm, Lightning Strike, Neon Energy, Cosmic Explosion, Starfall,
  Minimal Sparks, Rainbow Rush, Cyberpunk and Clean Mode. User settings override preset values.
- Per-keystroke placement: full-circle bursts centred on the cursor, with automatic fallback to
  rising effects next to wide characters, inlay hints, folds, word wrap and the end of the document.
  The `keyblaze.placement` setting controls this.
- Detection of genuine typing that ignores paste, undo/redo, completions, formatting and programmatic
  edits. Multi-cursor aware.
- Combo system with an animated badge next to the code, status bar display, configurable milestones,
  milestone celebrations and a persisted best combo.
- Impact Pulse: an optional milestone shake of the effect layer and badge, plus a cursor-line flash.
- Cursor effects: glow, energy ring, sparks and trail.
- KeyBlaze Control Panel with Dashboard, Effects, Personalization, Performance and About tabs, a
  live preview that uses the same engine as the editor, and light, dark and high-contrast theme support.
- Optional synthesised sound effects in four themes (soft, mechanical, arcade, chime) via the KeyBlaze
  Sound view.
- Accessibility: reduced-motion support, a pause for screen-reader optimisation, and a pause while
  VS Code is unfocused.
- Performance safeguards: paced rate limiting, a concurrent-burst cap, quality levels, performance
  mode and smaller bursts during very fast typing.
- Commands: Enable, Disable, Toggle, Open Control Panel, Change Effect, Next / Previous Effect, Apply
  Preset, Preview Effect, Open Sound View, Reset Settings. A status bar toggle.
