# Community repo setup (the BlenderKit loop)

The Decks and Tools panels are a LIVE VIEW of one shared GitHub repo.
Every user's app fetches the same catalog; Download/Install pulls straight
from GitHub into their project. Approval = you merging their pull request.

The app currently points at:

    https://github.com/blank-slate-app/community   (branch: main)

(Change `COMMUNITY_REPO` at the top of the community section in
`js/main.js` if you name it differently.)

## Repo structure

```
community/
├── index.json                  ← THE CATALOG (the app fetches this)
├── decks/
│   └── <Title - Author>/       ← exactly what "Publish Deck…" produces
│       ├── manifest.json
│       ├── project.json
│       ├── <Title - Author>.pdf   ← the card preview: users flip through
│       │                            every page in the panel before
│       │                            downloading (fetched once, cached)
│       ├── images/…
│       └── tools/…             (only the deck's unique tools)
└── community-tools/
    └── <toolname>.js           ← standalone tool submissions
```

## index.json (starter — copy this in as the first commit)

```json
{
  "decks": [
    {
      "dir": "My First Deck - Forma Rosa Creative",
      "title": "My First Deck",
      "author": "Forma Rosa Creative",
      "pages": 6,
      "images": 12,
      "downloads": 0,
      "files": [
        "manifest.json",
        "project.json",
        "My First Deck - Forma Rosa Creative.pdf",
        "images/example.jpg",
        "tools/mytool.js"
      ]
    }
  ],
  "tools": [
    {
      "file": "community-tools/sticker.js",
      "name": "Sticker",
      "author": "someone",
      "description": "Drop emoji stickers on the canvas",
      "downloads": 0
    }
  ]
}
```

Notes:
- `files` lists every file inside the deck's folder (the app downloads
  them individually over raw.githubusercontent.com — no server needed).
- `downloads` is hand-maintained (or 0) until the GitHub Action exists.

## The contribution flow

1. User runs **Publish Deck…** → tidy folder appears in their local
   `decks/` library (and their own panel immediately).
2. They open a PR adding that folder under `decks/` + an `index.json`
   entry. Tool submissions add a file under `community-tools/` + an entry.
3. You review — the PR diff shows any tool code in full — and merge.
4. Every app's panel picks it up within a minute (or on window focus).

## Later (automation, all still free)

- A GitHub Action on merge: regenerate `index.json` automatically from the
  folders (no hand-editing), zip each deck into a Release asset, and read
  real `download_count`s back into the catalog.
- In-app "Submit to community" button that opens the pre-filled PR page.
