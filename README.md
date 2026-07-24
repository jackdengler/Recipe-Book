# Recipe Book

A private recipe collection, delivered as an installable PWA and surfaced
inside the [Central Optimus](https://github.com/jackdengler/central-optimus)
launcher.

## How it works

- **Static PWA** — plain HTML/CSS/JS, no build step. Deployed to GitHub
  Pages at `https://jackdengler.github.io/Recipe-Book/` by
  `.github/workflows/deploy.yml`.
- **Data** lives in `recipes.json` in the private
  [`private-data-storage`](https://github.com/jackdengler/private-data-storage)
  repo, read and written through the GitHub Contents API.
- **Auth** — the app needs a GitHub personal access token (PAT) with
  `repo` scope. When embedded in Central Optimus the launcher hands the
  token over via `postMessage({ type: "co.pat", pat })`. Opened standalone,
  a small gate accepts a pasted token (kept in `sessionStorage` for the
  tab only).

## Data shape

```json
{
  "recipes": [
    {
      "id": "uuid",
      "title": "Weeknight Bolognese",
      "description": "Rich and quick.",
      "servings": "4",
      "prepTime": "15 min",
      "cookTime": "40 min",
      "ingredients": ["2 tbsp olive oil", "1 onion, diced"],
      "steps": ["Heat the oil.", "Soften the onion."],
      "tags": ["dinner", "pasta"],
      "createdAt": "2026-07-24T00:00:00Z",
      "updatedAt": "2026-07-24T00:00:00Z"
    }
  ]
}
```

## Setup notes

1. **Pages** — Settings → Pages → Source = **GitHub Actions** (one time).
2. The workflow rasterizes `icons/icon.svg` into the PNG icon sizes, so no
   image binaries are committed.

## Local dev

```
python3 -m http.server 8000
# open http://localhost:8000 and paste a PAT at the gate
```
