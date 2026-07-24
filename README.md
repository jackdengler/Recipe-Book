# Recipe Book

A blank, installable Progressive Web App (PWA) scaffold — ready to publish on GitHub Pages and build on.

## What's included

- `index.html` — the app shell (blank landing page)
- `manifest.webmanifest` — PWA metadata (name, icons, theme, standalone display)
- `sw.js` — service worker (offline caching, installability)
- `icons/` — generated app icons (192, 512, and a maskable 512)
- `.nojekyll` — tells GitHub Pages to serve files as-is

All paths are relative, so it works whether served from a domain root or a `/Recipe-Book/` subpath.

## Publish with GitHub Pages

1. Push this branch and merge it to your default branch (e.g. `main`).
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Select the branch (e.g. `main`) and folder `/ (root)`, then **Save**.
5. Your PWA goes live at `https://<username>.github.io/Recipe-Book/`.

Open the URL in Chrome/Edge and you'll get an **Install** prompt. The app works offline after the first load.

## Develop locally

A service worker requires `http://` (not `file://`). Serve the folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```
