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

  try {
    const flat = (await redis(["HGETALL", "votes"])) || [];
    const votes = {};
    let total = 0;
    for (let i = 0; i < flat.length; i += 2) {
      const n = Number(flat[i + 1]);
      votes[flat[i]] = n;
      total += n;
    }
    return res.status(200).json({ votes, total });
  } catch (e) {
    return res.status(500).json({ error: "Storage error" });
  }
};
