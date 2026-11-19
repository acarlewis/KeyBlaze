<p align="left">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="media/logo/Light_Background_application.png">
    <img src="media/logo/Full_Logo.png" alt="KeyBlaze" width="240">
  </picture>
</p>

# Contributing to KeyBlaze

Thanks for helping. This guide covers the layout, the workflow, the tests and how to package a release.

## Ground rules

- **Supported VS Code APIs only.** No workbench patching, DOM access or CSS injection through
  decoration `textDecoration` strings. If something can't be done with supported APIs, document
  the limitation and propose an alternative.
- **Typing comes first.** Nothing may slow down typing, undo, completions or scrolling. Changes to
  rendering must keep `npm run test:performance` within the budgets in [docs/PERFORMANCE.md](docs/PERFORMANCE.md).
- **Strict TypeScript, no runtime dependencies.**

## Setup

```sh
npm install
npm run build        # bundles dist/extension.js and dist/webview/*.js
```

Press **F5** in VS Code ("Run KeyBlaze") to start an Extension Development Host.

## Project layout

```
src/
  extension.ts          activation; createKeyBlaze() is the composition root
  config/               settings schema, presets, resolution, labels, Control Panel protocol
  core/                 pure logic (no vscode import): engines, placement, combo, motion, sound recipes
  effects/              one spawn strategy per effect (full and upward variants)
  render/               SVG renderer, combo badge, cursor aura, frame sampler
  services/             VS Code adapters: typing detection, decorations, combo, cursor effects, ...
  providers/            Control Panel (WebviewPanel) and Sound view (WebviewView)
  webview/              browser-side code for the two webviews (bundled separately)
media/                  icons and webview stylesheets
test/unit/              Mocha tests for pure modules (plain Node)
test/suite/             integration tests inside VS Code (@vscode/test-cli)
test/visual/            behavioural and visual checks in a real VS Code over CDP
spike/                  the rendering spike (proof of concept and harness), see docs/SPIKE_REPORT.md
docs/                   architecture, spike report, testing, performance, images
```

Keep `src/core`, `src/effects`, `src/render` and `src/config` free of `vscode` imports. The webview
bundles and the unit tests depend on that.

## Checks and tests

| Command                    | Purpose                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `npm run check`            | Typecheck, lint, formatting and unit tests. Run before every commit.                                               |
| `npm run test:coverage`    | Unit coverage of the pure modules                                                                                  |
| `npm run test:integration` | Integration tests in the current stable VS Code                                                                    |
| `npm run test:min-vscode`  | Integration tests in VS Code 1.90.0 (the minimum in `engines`)                                                     |
| `npm run test:visual`      | Placement, combo, Control Panel and sound checks in a real VS Code (Windows paths, needs Chrome DevTools Protocol) |
| `npm run test:performance` | Typing latency and renderer load                                                                                   |

When you change settings, update `src/config/schema.ts` **and** `package.json`. A unit test fails if
they drift apart.

See [docs/TESTING.md](docs/TESTING.md) for what each suite covers and the manual checklist.

## Pull requests

1. Branch from `main`, keep changes focused, and add tests with the change.
2. `npm run check` and `npm run test:integration` must pass. For rendering changes, also run
   `npm run test:visual`.
3. Describe user-visible changes in `CHANGELOG.md` under an "Unreleased" heading.

## Brand assets

The official logo files live in `media/logo/` and are kept exactly as generated. Don't edit them; derive
production copies instead.

| File                                          | Use                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `media/logo/Application_Icon.png`             | Source of the extension icon                                                                            |
| `media/icons/icon.png`                        | Marketplace / extension icon: 256×256, transparent rounded corners, derived from `Application_Icon.png` |
| `media/logo/Full_Logo.png`                    | Full logo for dark backgrounds (README, docs, Control Panel About on dark themes)                       |
| `media/logo/Light_Background_application.png` | Full logo for light backgrounds (GitHub light mode, Control Panel About on light themes)                |
| `media/logo/Monochrome_version.png`           | Single-colour variant; not used (the source has stray lines along its top edge)                         |
| `docs/images/brand/social-preview.png`        | GitHub social preview (1280×640). Upload it under _Settings → General → Social preview_                 |

Always write the product name as **KeyBlaze**.

## Packaging and publishing

```sh
npm run package      # → keyblaze-<version>.vsix (runs the production build first)
```

Install the result with **Extensions → … → Install from VSIX…** or
`code --install-extension keyblaze-<version>.vsix`.

Before publishing to the Visual Studio Code Marketplace:

1. Create a publisher (see the [publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension))
   and replace the placeholder `"publisher": "your-publisher-id"` in `package.json`. Also update the
   extension ID used by the tests (`test/suite/helpers.ts` reads it from `package.json`) and the
   visual scripts (`your-publisher-id.keyblaze`).
2. Add a `repository` field (and optionally `homepage` and `bugs`) to `package.json`. Then remove
   `--allow-missing-repository --no-rewrite-relative-links` from the `package` script, so that `vsce`
   rewrites the README's relative image links to absolute URLs in your repository. Until then, the
   README images render on GitHub but not in VS Code's extension details view. The image files are
   deliberately not packaged.
3. Bump `version`, update `CHANGELOG.md`, and remove `"preview": true` when it's ready for a stable release.
4. `npx vsce login <publisher>` and `npx vsce publish`.
