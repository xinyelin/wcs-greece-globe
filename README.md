# World Culture Salon · Chapter I — Greece

An interactive globe gallery by [One Culture Foundation](https://www.oneculturefdn.org/), presenting artists from around the world in conversation with the Greek spirit.

**Live site:** https://wcs-greece-globe.vercel.app

## About

Each point of light on the globe is an artist. Threads of light connect every artist's city back to Athens — a map of cultural diplomacy in motion. Click any light to see the artist's work, bio, and reflection on Greek culture.

Built with Three.js. Static `index.html` — no client-side build step, no runtime call to Google.

## Local preview

Open `index.html` in any modern browser.

## Data pipeline

Artist data starts as a Google Form / Sheet. Two ways it reaches the site:

- **Manual rebuild** — run `python build_globe.py` from the repo root (reads the downloaded submission `.xlsx`, geocodes against `data/geo.json`, writes `index.html`, `classic.html`, `artists-min.json`, and mirrors the raw templates + landmask into this folder). Copy the result into `globe-site/index.html` and push.
- **Weekly auto-sync** — `api/sync-sheet.js`, on a Vercel Cron (`vercel.json`, Mondays 06:00 UTC), reads the live Sheet directly via a read-only Google service account, geocodes the same way, and commits any change straight to GitHub — which redeploys automatically. Visitors never talk to Google; only this scheduled job does, so a slow/failing Sheet just delays next week's sync instead of breaking the live site.

New locations the sheet introduces that aren't yet in `data/geo.json` are skipped from the map (not from a crash) and logged to Redis under `sync:pending` — check there periodically and add the missing city to `data/geo.json` (the single shared file both the manual build and the auto-sync read from) so the next sync picks it up.

**Env vars required for auto-sync** (Vercel → Project Settings → Environment Variables):
`GOOGLE_SHEET_ID`, `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`, `GITHUB_TOKEN`, `GITHUB_REPO` (defaults to `xinyelin/wcs-greece-globe`), `CRON_SECRET` — plus the existing `KV_REST_API_URL`/`KV_REST_API_TOKEN` used by voting. Without these, `/api/sync-sheet` returns 503 and the site keeps running on whatever was last committed.
