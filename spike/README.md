# Rendering spike harness

This is a throwaway proof of concept and test harness. It's not part of the shipped extension, and nothing here is imported by `src/`.

- `poc/`: a minimal extension that uses only official VS Code APIs. A localhost control server (port 9555) lets the driver run scenarios. It reuses KeyBlaze's compiled engine from `out/src` (read-only) for real bursts.
- `lib.mjs`: the driver library. It launches an isolated VS Code 1.147.0 (from `.vscode-test/`) with `--remote-debugging-port=9444`. It then uses the Chrome DevTools Protocol as **test tooling only**, to:
  - send real keystrokes;
  - measure pixel positions of the caret and the `::after` effect boxes;
  - read renderer performance metrics;
  - take screenshots.
- `run.mjs` … `run7.mjs`, `evidence.mjs`, `demo.mjs`: the scenarios. See `docs/SPIKE_REPORT.md` for what each one established.

## Running

```sh
npm run compile-tests        # builds out/src (engine used by the PoC)
npx @vscode/test-electron    # or: npm run test:integration once, to download VS Code 1.147.0
node spike/run.mjs           # writes spike/results/results.json + screenshots
```

Each run uses a fresh profile under `spike/results/user-data`, which is git-ignored, and kills only its own process tree when it finishes.
