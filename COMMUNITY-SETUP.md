# Community ops (maintainer notes — Forma Rosa Creative)

The Decks and Tools panels in every copy of the app are a LIVE VIEW of one
shared GitHub repo. Download/Install pulls straight from GitHub into the
user's project. Approval = you merging their pull request.

    App points at: https://github.com/blank-slate-app/community  (branch: main)
    (Change COMMUNITY_REPO at the top of the community section in js/main.js
    if the repo ever moves.)

## The two-folder split

- **This folder** (`_TECH blank-slate app`) — the app source AND your own
  practice as the first user. Your `_projects/` and `_decks/` are gitignored;
  `bat\push.bat` publishes only the app code.
- **`../_TECH Blank Slate Community`** — the local working copy of the
  community repo: curated docs (README, CONTRIBUTING, AGENTS.md), `decks/`,
  `community-tools/`, `index.json`. This is the "1st release community
  package" — what every user's panels read.

## Publishing your content (the maintainer loop)

1. In the app: right-click canvas → **Publish Deck…** → a tidy deck folder
   lands in your `_decks/` library (and your own panel immediately).
2. Run `bat\push-community.bat`. It stages the Community folder
   (`js/publish-community.js` copies published decks in and regenerates
   `index.json` from disk, preserving download counts — it never touches
   the curated docs), then commits and pushes it to GitHub.
3. Every app's panels pick it up within a minute (or on window focus).

## Handling other people's submissions

They follow `CONTRIBUTING.md` in the community repo: PR with a deck folder
under `decks/` (or a `.js` under `community-tools/`) + an `index.json`
entry. You read the diff — tool code is one readable file by design —
and merge. After merging remote PRs, `git pull` in the Community folder
before your next push-community run so the folder stays in sync.

## Later (automation, all still free)

- GitHub Action on merge: regenerate `index.json` from the folders,
  zip each deck into a Release asset, read real `download_count`s back.
- In-app "Submit to community" button that opens the pre-filled PR page.
