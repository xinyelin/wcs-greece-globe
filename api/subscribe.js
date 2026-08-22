// Collects newsletter emails into the same Redis store the votes use.
// SADD dedupes re-submissions for free; a first-seen timestamp is kept
// separately so the list can be exported in signup order.
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
  if (!REST_URL || !REST_TOKEN) return res.status(503).json({ error: "Subscriptions are not open yet" });

  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return res.status(400).json({ error: "Invalid email" });
  }

  try {
    // soft per-IP daily cap to deter scripted stuffing
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
    const capKey = `subcap:${ip}:${new Date().toISOString().slice(0, 10)}`;
    const used = await redis(["INCR", capKey]);
    if (used === 1) await redis(["EXPIRE", capKey, "86400"]);
    if (used > 20) return res.status(429).json({ error: "Too many attempts today" });

    await redis(["SADD", "subs", email]);
    await redis(["HSETNX", "subs:ts", email, new Date().toISOString()]);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "Storage error" });
  }
};
