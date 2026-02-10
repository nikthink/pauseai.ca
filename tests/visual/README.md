# Visual regression checks

This repo uses a script-based visual regression harness that combines OCR, structural checks, and pixel diffs.

## Goals

- Validate text legibility (OCR vs expected text).
- Detect structure or layout changes in key regions.
- Compare region screenshots to baselines.

## How it works

The `visual-regression` script:

- Builds the Hugo site (unless `--skip-build` is passed).
- Runs internal link checks.
- Serves `public/` on a local HTTP server.
- Uses Playwright + Chromium to render target pages in light and dark modes on multiple devices.
- Captures annotated page screenshots with marked regions.
- Captures region screenshots for pixel diffs and OCR.
- Runs Tesseract OCR and compares it to the expected text (per region).
- Compares DOM text + structure metrics against baselines.

## Run

```bash
npm install
npm run test:visual-regression
```

Fast profile (used by pre-commit):

```bash
npm run test:visual-regression -- --profile fast
```

To update baselines:

```bash
npm run test:visual-regression -- --update-baseline
```

Optional flags:

- `--update-baseline` (write baselines + images)
- `--profile fast|full`
- `--skip-build`
- `--skip-links`
- `--verbose`
- `--report` (write `build/visual/report.html`)
- `--config tests/visual/regions.json`
- `--baselines tests/visual/baselines.json`
- `--allowlist tests/visual/allowlist.json`

## Notes

- Baseline images live in `tests/visual/baselines/`.
- Current run artifacts are written under `build/visual/`.
- Profiles live in `tests/visual/regions.json` under `profiles`.
- Changes can be whitelisted in `tests/visual/allowlist.json`.
- Install French OCR data on Ubuntu with: `sudo apt-get install -y tesseract-ocr-fra`

## CI example

```bash
npm run test:visual-regression
```
