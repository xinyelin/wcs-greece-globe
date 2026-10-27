# World Culture Salon · Greece, San Francisco Edition 2026

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

Every run also appends a short entry (artist count, any pending cities, whether anything was committed) to the [Gallery｜Weekly Data Sync Log](https://app.notion.com/p/3c4777b2012981df8d36c12aef515c99) Notion page, if `NOTION_TOKEN` / `NOTION_LOG_PAGE_ID` are set. This is best-effort — a Notion outage never fails the sync itself.

**Env vars required for auto-sync** (Vercel → Project Settings → Environment Variables):
`GOOGLE_SHEET_ID`, `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`, `GITHUB_TOKEN`, `GITHUB_REPO` (defaults to `xinyelin/wcs-greece-globe`), `CRON_SECRET` — plus the existing `KV_REST_API_URL`/`KV_REST_API_TOKEN` used by voting. Without these, `/api/sync-sheet` returns 503 and the site keeps running on whatever was last committed. `NOTION_TOKEN` / `NOTION_LOG_PAGE_ID` are optional — the sync still runs and commits without them, it just skips the log entry.

This Vercel project is connected to this GitHub repo (Settings → Git), so any push to `main` — from the weekly sync or a manual commit — redeploys automatically.

## The chapter page (2026-10)

The globe is now the cover of a scrolling page, so anyone opening a shared link can tell what this is and read the chapter's story. Everything lives in `templates/globe.html`; `index.html` is rendered from it (by the sync, or locally with the same `render()` and the data already in `index.html`), so never edit `index.html` by hand.

- **Naming (draft, 2026-10-26).** A chapter is a country and stays open, so it carries no number (OCF's About page already calls Greece the "first country chapter"). Inside a chapter, an edition is one city and one year; this page is the San Francisco Edition, 2026. Each edition closes with an issue of the Salon's journal, *The World Culture Review* (name confirmed by the Founder, 2026-10-26), numbered across the Salon (this one, No. 01). New editions are shaped by a guest editor; nobody is named for 2026. `classic.html` keeps the earlier design and its "Chapter I" wording as an archive.
- **Cover.** The title block says plainly what this is: the online gallery and its edition, how many artists and countries (counted from the data), one open call, each light an artist. On a phone the cover's bottom is a tray of artist cards: Greece first, then eastward all the way round. The card the tray settles on turns the globe to that artist and lights their thread. A finger turns the globe only when it moves sideways, so the page still scrolls; the expand button (and "Explore the globe" further down) opens the globe full screen with every gesture, and "Back to the chapter" leaves. On desktop the wheel scrolls the page; zoom is only in explore mode.
- **The right-hand rail** (desktop): search and explore full screen, a hairline, then one icon per section of the page below (the chapter, the record, the atlas, the Greek spirit, The World Culture Review, what comes next), each naming itself on hover and gliding to its section (Founder, 2026-10-26). On screens up to 760px tall the signature mark steps aside so the rail clears Donate / Follow; below 560px the section icons give way. Phones and tablets keep search and explore only.
- **Picking a light** is measured on screen, not by ray: the near-side lights within 26px of a fingertip (14px of a mouse) count, and lights almost as close as the nearest form a cluster to choose from.
- **The artist panel** is a sheet from the bottom on phones (pull its bar down, or tap outside, to close) with previous / next in the tray's order and a share button. The address bar always names the open artist (`?artist=their-name`, slugged from the name, because `index` is reassigned by each sync), so a copied link opens that artist.
- **Below the cover:** what a Country Chapter is; the record (the three blog posts as dated entries on a gold thread that draws as it is read, then what is ahead); the atlas (artists by continent, and every way to browse); the eight Greek ideas, their icons to choose from (a column on the right on desktop, a 4×2 grid on phones) beside the chosen idea; the year-end journal (No. 01), in preparation; what comes next (this edition, the chapter's next edition, the next country; Partner With Us with World Culture Salon ticked, follow, donate); the foundation's footer. A bar with the chapter and edition, a way back to the globe and Share appears once the cover has scrolled away.
- **Sharing.** Open Graph and Twitter tags with `og-chapter-greece.jpg` (1200×630, rendered from the cover itself). It carries the counts at the time it was made; re-render it when they have moved a lot. `favicon.png` is the foundation's ring.
- **No WebGL** (some in-app browsers): the full list of artists, then the same chapter sections.
- The globe stops drawing once the cover has scrolled away.
