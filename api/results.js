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
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const key = req.method === "POST" ? (req.body && req.body.key) : req.query.key;
  if (!process.env.ADMIN_KEY || (key || "") !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!REST_URL || !REST_TOKEN) return res.status(503).json({ error: "Storage not configured" });

  // POST + action=reset wipes all vote counts — only reachable with the admin key,
  // and never triggerable by a plain link/GET
  if (req.method === "POST" && req.body && req.body.action === "reset") {
    try {
      await redis(["DEL", "votes"]);
      return res.status(200).json({ ok: true, cleared: true });
    } catch (e) {
      return res.status(500).json({ error: "Storage error" });
    }
  }

  // POST + action=remove_sub drops one address (a bounced address, a test
  // signup, a removal request) without touching anyone else's row
  if (req.method === "POST" && req.body && req.body.action === "remove_sub") {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "Missing email" });
    try {
      await redis(["SREM", "subs", email]);
      await redis(["HDEL", "subs:ts", email]);
      return res.status(200).json({ ok: true, removed: email });
    } catch (e) {
      return res.status(500).json({ error: "Storage error" });
    }
  }

  try {
    const flat = (await redis(["HGETALL", "votes"])) || [];
    const votes = {};
    let total = 0;
    for (let i = 0; i < flat.length; i += 2) {
      const n = Number(flat[i + 1]);
      votes[flat[i]] = n;
      total += n;
    }
    const subEmails = (await redis(["SMEMBERS", "subs"])) || [];
    const tsFlat = (await redis(["HGETALL", "subs:ts"])) || [];
    const ts = {};
    for (let i = 0; i < tsFlat.length; i += 2) ts[tsFlat[i]] = tsFlat[i + 1];
    const subscribers = subEmails
      .map((email) => ({ email, ts: ts[email] || "" }))
      .sort((a, b) => (a.ts < b.ts ? -1 : 1));
    return res.status(200).json({ votes, total, subscribers });
  } catch (e) {
    return res.status(500).json({ error: "Storage error" });
  }
};
