// Newsletter sign-ups ("Follow the chapter"). Each address goes to WCS Subscribers in the OCF
// Airtable base (see _wcs-subscribers.js), the only place subscribers are kept since 2026-11-05.
// Redis, the store the votes use, is used here only for a soft per-IP daily cap.
const { upsertSubscriber } = require("./_wcs-subscribers");
const REST_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(cmd) {
  const r = await fetch(`${REST_URL}/${cmd.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${REST_TOKEN}` },
  });
  if (!r.ok) throw new Error(`redis ${r.status}`);
  return (await r.json()).result;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.AIRTABLE_OCF_TOKEN) return res.status(503).json({ error: "Subscriptions are not open yet" });

  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return res.status(400).json({ error: "Invalid email" });
  }

  // soft per-IP daily cap to deter scripted stuffing; if Redis is down, sign-ups still go through
  if (REST_URL && REST_TOKEN) {
    try {
      const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
      const capKey = `subcap:${ip}:${new Date().toISOString().slice(0, 10)}`;
      const used = await redis(["INCR", capKey]);
      if (used === 1) await redis(["EXPIRE", capKey, "86400"]);
      if (used > 20) return res.status(429).json({ error: "Too many attempts today" });
    } catch (e) {
      // no cap this time
    }
  }

  const saved = await upsertSubscriber(email);
  if (!saved.ok) {
    console.error(`subscribe: Airtable write failed (${saved.reason})`);
    return res.status(502).json({ error: "Storage error" });
  }
  return res.status(200).json({ ok: true });
};
