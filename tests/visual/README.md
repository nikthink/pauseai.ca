# Visual OCR checks

This repo uses a lightweight, script-based visual test harness for legibility checks.

## Goals

- Validate text legibility on top of the hero background image.
- Compare OCR output for multiple overlay opacities.
- Keep checks deterministic and fast (local-only, no external services).

## How it works

The script:

- Builds the Hugo site (unless `--skip-build` is passed).
- Serves `public/` on a local HTTP server.
- Uses Playwright + Chromium to render the target page in light and dark modes.
- Captures a screenshot of the first few paragraphs after the shared CTA.
- Runs Tesseract OCR and compares it to the expected text (per paragraph).

## Run

```bash
npm install
npm run test:visual-ocr
```

Optional flags:

- `--path /en/montreal.html`
- `--opacities 0.6,0.7,0.75,0.8,0.85`
- `--paragraphs 0` (0 = all paragraphs)
- `--selector "main p"`
- `--lang eng` (use `fra+eng` for French pages if `tesseract-ocr-fra` is installed)
- `--psm 6`
- `--light-opacity 0.8`
- `--dark-opacity 0.7`
- `--min-score 0.97`
- `--viewport 1280x720`
- `--device-scale-factor 2`
- `--out /tmp/pauseai-visual-ocr`
- `--skip-build`
- `--verbose`

## Notes

- Results are printed with a score per opacity and mode.
- Screenshots are written to the output directory for visual inspection.
- Short paragraphs are scored using token recall to avoid false negatives from punctuation/diacritics.
- Install French OCR data on Ubuntu with: `sudo apt-get install -y tesseract-ocr-fra`

## CI example

```bash
npm run test:visual-ocr -- --path /en/montreal.html --light-opacity 0.8 --dark-opacity 0.75 --min-score 0.97 --lang eng
npm run test:visual-ocr -- --path /fr/montreal.html --light-opacity 0.8 --dark-opacity 0.75 --min-score 0.97 --lang fra+eng --skip-build
```
