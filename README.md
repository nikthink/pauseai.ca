# PauseAI Canada

Static site built with Hugo and the [hugo-theme-yue](https://github.com/CyrusYip/hugo-theme-yue) theme.

## Prerequisites
 - Hugo (install from https://gohugo.io/installation/)
 - Git
 - Node.js 20+ and npm
 - Tesseract OCR (for visual regression checks)
   - Ubuntu: `sudo apt-get install -y tesseract-ocr tesseract-ocr-fra`

## First-Time Setup
```bash
git clone --recurse-submodules https://github.com/nikthink/pauseai.ca.git
cd pauseai.ca
# If you cloned without --recurse-submodules, run:
git submodule update --init --recursive
```

## Local Preview
You can use the hugo http server or just build the files viewable with `file://` protocol (without http server).

### Hugo http server
```bash
hugo server -D
```

The site serves at `http://localhost:1313/`. Because multilingual mode is enabled, the French home page is at `/fr/` and the English home page is at `/en/`.

### Local files no server
```bash
./serve.sh
```

open `public/fr/index.html` in your browser.

# Quality checks

Pre-commit runs the unified visual regression gate in the fast profile. It builds the site, checks internal links, runs OCR legibility checks, and performs structural + pixel diffs on key regions across devices.

Run it manually:

```bash
npm install
npm run test:visual-regression
```

Fast profile (pre-commit default):

```bash
npm run test:visual-regression -- --profile fast
```

To update baselines:

```bash
npm run test:visual-regression -- --update-baseline
```

Useful flags:
- `--verbose` (progress + per-region details)
- `--profile fast|full`
- `--skip-build`
- `--skip-links`
- `--report` (write `build/visual/report.html`)

Baselines live in `tests/visual/baselines.json` and `tests/visual/baselines/`. Local run artifacts are written to `build/visual/`.

Baseline workflow:
- Baselines are versioned in the repo, so after cloning you should be able to run checks immediately.
- Only regenerate baselines when you intentionally change UI/layout/text that affects the regions under test.
- When you do, run `npm run test:visual-regression -- --update-baseline` and commit the updated baselines.

# Design guidelines

This Hugo site must satisfy both Canada-wide and Montréal-specific requirements.
All content and UI need to function fully in English and French (including accents, using non ASCII chars).
Every page has to support consistent light and dark modes.

# Contributing

TODO:
- [x] increase opacity where there is text, the text on the protest signs mess up with the page's text (though way less on nik's screen (in dark mode))
    Details: light overlay set to 0.8 and dark overlay set to 0.75; link colors darkened for legibility; OCR legibility checks added.
- [x] have the "Canada, Montreal, Events" menu parallel to "PauseAI" (at its right), like the other PauseAI websites
    Details: header title now shows "PauseAI"; menu stays inline on desktop and collapses to a hamburger under 900px; removed duplicate translation links and TOC from Montréal pages.
- [x] CTA buttons: Join Discord, MTL Events, Join MTL Mailing List
    Details: CTA buttons stack full-width on mobile with added spacing.
- [x] tooling: snapshot and internal link checks + Husky pre-commit hook
    Details: visual regression gate (OCR + structure + pixel diffs) runs in `pre-commit` and CI; baselines live under `tests/visual/`.
- [ ] pauseai.ca home page: CTA + list of risks.
    - List of risks expands like accordion / html details element (pauseia.fr-FAQ style)
- [ ] nav
- [ ] home
- [ ] communities: lists Canada communities with link to MTL page
