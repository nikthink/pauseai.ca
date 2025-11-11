# PauseAI Canada

Static site built with Hugo and the [hugo-theme-yue](https://github.com/CyrusYip/hugo-theme-yue) theme.

## Prerequisites
 - Hugo **extended** (install from https://gohugo.io/installation/)
 - Git

## First-Time Setup
```bash
git clone --recurse-submodules https://github.com/nikthink/pauseai.ca.git
cd pauseai.ca
# If you cloned without --recurse-submodules, run:
git submodule update --init --recursive
```

## Local Preview
```bash
hugo server -D
```
The site serves at `http://localhost:1313/`. Because multilingual mode is enabled, the French home page is at `/fr/` and the English home page is at `/en/`.

## Production Build
Use the helper script to build the deployable output into `public/` and bundle an archive:
```bash
./serve.sh
```
The script removes the existing `public/` directory, runs `hugo -b /` with additional warnings enabled, creates `public/archives/`, and writes a tarball (`pauseai-ca-full-latest.tgz`) containing the repository contents. While it runs, `inotifywait` watches for changes and rebuilds automatically; stop it with `Ctrl+C` once the final build is ready for deployment (e.g., to GitHub Pages).
