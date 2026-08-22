// Weekly cron job: pulls new rows from the artist-submission Google Sheet,
// geocodes them against data/geo.json, re-renders index.html / classic.html /
// artists-min.json exactly like build_globe.py does locally, and commits any
// change straight to GitHub — which Vercel's git integration then deploys.
//
// Visitors never talk to Google directly: only this scheduled job does, so a
// slow or failing Sheet just means next week's sync is late, not a broken site.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SA_EMAIL = process.env.GOOGLE_SA_EMAIL;
const SA_KEY = (process.env.GOOGLE_SA_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || "xinyelin/wcs-greece-globe";
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_LOG_PAGE_ID = process.env.NOTION_LOG_PAGE_ID;

function b64url(input) {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function getAccessToken() {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: SA_EMAIL,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const signature = crypto.createSign("RSA-SHA256").update(signingInput).sign(SA_KEY);
  const jwt = `${signingInput}.${signature.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}`;

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`,
  });
  if (!r.ok) throw new Error(`google auth ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token;
}

async function fetchRows(token) {
  const range = encodeURIComponent("Form Responses 1!A2:K");
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?majorDimension=ROWS`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`sheets ${r.status}: ${await r.text()}`);
  return (await r.json()).values || [];
}

function clean(v, limit) {
  let s = v == null ? "" : String(v).trim().replace(/\s+/g, " ");
  if (limit && s.length > limit) s = s.slice(0, limit).replace(/\s+\S*$/, "") + "…";
  return s;
}

function buildArtists(rows, geo) {
  const artists = [];
  const pending = [];
  rows.forEach((r, i) => {
    const rawLoc = clean(r[3]).toLowerCase();
    const hit = geo[rawLoc];
    if (!hit) {
      if (rawLoc) pending.push({ name: clean(r[1]), rawLocation: rawLoc });
      return;
    }
    const [lat, lng, display, continent, country] = hit;
    const jlat = (((i * 37) % 11) - 5) * 0.35;
    const jlng = (((i * 53) % 11) - 5) * 0.35;
    artists.push({
      index: artists.length + 1,
      name: clean(r[1]),
      location: display,
      continent,
      country,
      lat: Math.round((lat + jlat) * 1000) / 1000,
      lng: Math.round((lng + jlng) * 1000) / 1000,
      website: clean(r[4]),
      social: clean(r[5]),
      bio: clean(r[6], 700),
      title: clean(r[7]),
      medium: clean(r[8]),
      artworkLink: clean(r[9]),
      statement: clean(r[10], 700),
    });
  });
  return { artists, pending };
}

function render(template, dataJs, landmask) {
  let html = template;
  const start = html.indexOf("/*__DATA__*/");
  const end = html.indexOf("/*__END__*/") + "/*__END__*/".length;
  html = html.slice(0, start) + dataJs + html.slice(end);
  if (landmask) html = html.replace("/*__LANDMASK__*/", landmask);
  return html;
}

async function ghGet(filePath) {
  const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`github get ${filePath} ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return { sha: j.sha, content: Buffer.from(j.content, "base64").toString("utf-8") };
}

async function ghPut(filePath, content, sha, message) {
  const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf-8").toString("base64"),
      sha: sha || undefined,
      branch: "main",
    }),
  });
  if (!r.ok) throw new Error(`github put ${filePath} ${r.status}: ${await r.text()}`);
}

async function commitIfChanged(filePath, content, message) {
  const current = await ghGet(filePath);
  if (current && current.content === content) return false;
  await ghPut(filePath, content, current ? current.sha : undefined, message);
  return true;
}

async function redis(cmd) {
  if (!KV_URL || !KV_TOKEN) return null;
  const r = await fetch(`${KV_URL}/${cmd.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  if (!r.ok) return null;
  return (await r.json()).result;
}

function rt(text) {
  return [{ type: "text", text: { content: text } }];
}

// best-effort: a Notion outage should never fail the sync itself
async function logToNotion({ artistCount, pending, committed }) {
  if (!NOTION_TOKEN || !NOTION_LOG_PAGE_ID) return false;
  const today = new Date().toISOString().slice(0, 10);
  const children = [
    { object: "block", type: "heading_3", heading_3: { rich_text: rt(`${today} · auto-sync`) } },
    { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: rt(`艺术家总数：${artistCount}`) } },
    {
      object: "block",
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: rt(
          pending.length
            ? `待处理城市（未匹配，需要人工补经纬度）：${pending.map((p) => `${p.name} — ${p.rawLocation}`).join("；")}`
            : "待处理城市：无"
        ),
      },
    },
    { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: rt(`是否有新提交：${committed ? "是" : "否"}`) } },
    { object: "block", type: "divider", divider: {} },
  ];
  const r = await fetch(`https://api.notion.com/v1/blocks/${NOTION_LOG_PAGE_ID}/children`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ children }),
  });
  return r.ok;
}

module.exports = async (req, res) => {
  const auth = req.headers.authorization || "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!SHEET_ID || !SA_EMAIL || !SA_KEY || !GITHUB_TOKEN) {
    return res.status(503).json({ error: "Sync is not configured" });
  }

  try {
    const geo = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "geo.json"), "utf-8"));
    const landmask = fs.readFileSync(path.join(__dirname, "..", "data", "landmask.txt"), "utf-8").trim();
    const globeTemplate = fs.readFileSync(path.join(__dirname, "..", "templates", "globe.html"), "utf-8");
    const classicTemplate = fs.readFileSync(path.join(__dirname, "..", "templates", "classic.html"), "utf-8");

    const token = await getAccessToken();
    const rows = await fetchRows(token);
    const { artists, pending } = buildArtists(rows, geo);
    const dataJs = JSON.stringify(artists);

    const indexHtml = render(globeTemplate, dataJs, landmask);
    const classicHtml = render(classicTemplate, dataJs, null);
    const mini = JSON.stringify(
      artists.map((a) => ({ index: a.index, name: a.name, location: a.location, title: a.title }))
    );

    // sequential, not Promise.all: each Contents API write creates its own
    // commit on the branch, so writing all three concurrently races them
    // against each other and 409s
    const message = `Auto-sync: ${artists.length} artists from the submission sheet`;
    const changed = [
      await commitIfChanged("index.html", indexHtml, message),
      await commitIfChanged("classic.html", classicHtml, message),
      await commitIfChanged("artists-min.json", mini, message),
    ];

    await redis(["SET", "sync:lastRun", new Date().toISOString()]);
    await redis(["SET", "sync:artistCount", String(artists.length)]);
    await redis(["SET", "sync:pending", JSON.stringify(pending)]);

    const committed = changed.some(Boolean);
    const notionLogged = await logToNotion({ artistCount: artists.length, pending, committed }).catch(() => false);

    return res.status(200).json({
      ok: true,
      artists: artists.length,
      pendingLocations: pending,
      committed,
      notionLogged,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
};
