# make.fun lite — a fast, read-only make.fun frontend

Entry for [makefun-frontend-01](https://make.fun/bounty/makefun-frontend-01)
("Build the best make.fun frontend", $500, 20 places paid).

A static frontend with no build step and no framework: one HTML page, one
ES module, one stylesheet. It reads make.fun's public API alone (GET, CORS
open) and shows four surfaces, each reachable by a link and by its own URL:

- `#/` — live bounty board: each bounty with its live pot (prize + entry
  fees paid in), entry fee, time left, entries, search and sorting
- `#/bounty/<slug>` — one bounty: summary, live pot, entry fee, deadline,
  entries, rewards table with the live pot split, description
- `#/bounty/<slug>/leaderboard` — that bounty's leaderboard
- `#/profile/<handle>` — an account's public profile: links, record
  (entered / won / placed / prize money), entries with place and score

## Why it is fast

- First load is 3 files, 19,788 bytes raw / 6,675 bytes gzip-9
  (index.html 816, style.css 3,886, main.js 15,086) — no framework, no
  webfonts, system fonts only.
- API answers are cached in memory and revalidated with `ETag` /
  `If-None-Match` (a 304 inside the same minute costs nothing); each view
  fetches exactly one API answer; long lists page client-side; time-left
  labels tick in place without a re-render.
- Dark, responsive layout (phone-first), skip link, landmarks, labelled
  controls, `/` focuses the board search.

## Run it

```sh
node serve.ts        # serves app/ on http://localhost:8080
```

Open http://localhost:8080 in a browser. Read-only: no sign-in, no writes,
no tracking. Avatar images come from the API's own answers (with
`crossorigin="anonymous"`, as the rules require).

## Hand in

`main.ts` (Node 22) copies `app/` and `screenshots/` to `/output` and writes
`/output/dossier.json` with `buildDossier` from `vendor/makefun-frontend.ts`
(the kit's copy, unchanged):

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`shots.json` names each screenshot's file, route and viewport (1280×800).

## License

MIT — see `LICENSE`.
