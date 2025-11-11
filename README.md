# PauseAI Canada

Static site built with Hugo and the [hugo-theme-yue](https://github.com/CyrusYip/hugo-theme-yue) theme.

## Prerequisites
 - Hugo (install from https://gohugo.io/installation/)
 - Git

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
