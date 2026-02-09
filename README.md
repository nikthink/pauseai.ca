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

# Design guidelines

This Hugo site must satisfy both Canada-wide and Montréal-specific requirements.
All content and UI need to function fully in English and French (including accents, using non ASCII chars).
Every page has to support consistent light and dark modes.

# Contributing

TODO:
- [x] increase opacity where there is text, the text on the protest signs mess up with the page's text (though way less on nik's screen (in dark mode))
- [x] have the "Canada, Montreal, Events" menu parallel to "PauseAI" (at its right), like the other PauseAI websites
- [ ] CTA buttons: Join Discord, MTL Events, Join MTL Mailing List
- [ ] pauseai.ca home page: CTA + list of risks.
    - List of risks expands like accordion / html details element (pauseia.fr-FAQ style)
- [ ] nav
- [ ] home
- [ ] communities: lists Canada communities with link to MTL page
