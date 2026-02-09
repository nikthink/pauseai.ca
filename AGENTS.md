# AGENTS.md

Project-specific agent guidance for the PauseAI Canada Hugo site.

Last updated: 2026-02-09

## 1. Goals

### 1.1 Primary goals
- Keep the site correct, bilingual, and easy to update.
- Preserve the visual language of `hugo-theme-yue` while making project-specific tweaks.
- Maintain a fast, low-friction local preview workflow.

### 1.2 Secondary goals
- Avoid duplicating `README.md`. Link to it for setup and local preview commands.
- Prefer minimal, reversible changes.

## 2. Non-negotiables

### 2.1 Always do first
- **ALWAYS** read `README.md` at the beginning of a conversation or after /clean.

### 2.2 Content and i18n integrity
- This repo is multilingual. Do **not** strip accents or enforce ASCII-only content.
- Maintain English and French parity for user-facing pages. If only one language is provided, ask before proceeding.
- For Canadian French, **no space before punctuation signs** (example: `Prénom: Olivier`).
- Keep URLs, menus, and navigation consistent across languages.

### 2.3 Theme and layout discipline
- Treat `themes/` as upstream. Prefer overrides in `layouts/`, `assets/`, or `static/`.
- Do not edit files under `public/` by hand; it is build output.

### 2.4 Git hygiene
- Never add AI attribution to commit messages.
- Keep commits focused and scoped to the request.

## 3. Standard workflow

### 3.1 Sync and inspect
- `git status`
- Check existing content and patterns before adding new pages.

### 3.2 Local preview
Pick one:
- `hugo server -D`
- `./serve.sh` (builds files for `public/` and allows `file://` viewing)

If `hugo server` or `hugo` fails, stop and report the error.

## 4. Quality checks

There are no unit tests in this repo yet. The minimum quality check is a clean Hugo build:

```bash
hugo
```

If drafts are involved, use:

```bash
hugo -D
```

Optional visual legibility check (OCR-based):

```bash
npm run test:visual-ocr
```

## 5. Content structure (Hugo)

- Content files live in `content/` and use language suffixes (e.g., `.en.md`, `.fr.md`).
- Reuse front matter patterns from existing pages in `content/`.
- Static files (images, downloads) go in `static/` unless the asset pipeline is required.
- CSS/JS pipeline assets go in `assets/`.

## 6. Assets and navigation

- Ensure menus and links remain consistent across English and French.
- Keep the site compatible with both light and dark modes.

## 7. Tooling freshness

- Prefer current Hugo commands and avoid introducing new tooling unless clearly beneficial.
- If a theme update is required, update the git submodule explicitly and note it in the change summary.
