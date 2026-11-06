/*
 * WCS Subscribers, in the One Culture Foundation Airtable base: one record per address that asked
 * for World Culture Salon news through the gallery's Subscribe ("Follow the chapter"). Shared by
 * api/subscribe.js (each sign-up as it happens, like the OCF website forms) and api/results.js
 * (the organizers' "copy to Airtable" on results.html, which copies every address in Redis: the
 * people who subscribed before this table existed, or any write that failed). Vercel does not
 * route files whose names begin with "_", so this is a module, not an endpoint.
 *
 * Records are upserted on Email Key (the lowercased address), so a repeat sign-up updates the one
 * record instead of adding another. The site writes Email, Email Key, First Signed Up, Source and,
 * from the form, Last Signed Up; Status and Notes are kept by hand and never sent.
 *
 * Environment:
 *   AIRTABLE_OCF_TOKEN   personal access token, scope data.records:write on the OCF base only.
 *                        Unset, nothing is written here; Redis still keeps every address.
 */

const BASE = "appZvVV7zU2q7r303";
const TABLE = "tbl7vzAVUDaZ2puHw";
const FIELDS = {
  email: "fldNbAcFWDPz0SFMp",
  key: "fld84uLhtxmaDoWu6",
  first: "fldX60Be1FBSQAHbP",
  last: "fldcqlQuAJXRV09tq",
  source: "fldu5DlNQahMpJ7lj",
};
const SOURCE = "gallery.oneculturefdn.org";
const BATCH = 10; // Airtable's most records per request
const PAUSE_MS = 220; // stays under 5 requests a second
const TIMEOUT_MS = 10000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fields({ email, first, last }) {
  return {
    [FIELDS.email]: email,
    [FIELDS.key]: email,
    [FIELDS.source]: SOURCE,
    ...(first ? { [FIELDS.first]: first } : {}),
    ...(last ? { [FIELDS.last]: last } : {}),
  };
}

/**
 * Upserts subscribers ({ email, first?, last? }, email already lowercased) in batches of ten.
 * Never throws; returns { ok, written, reason? }. Never logs an address.
 */
async function upsertSubscribers(people) {
  const token = process.env.AIRTABLE_OCF_TOKEN;
  if (!token) return { ok: false, written: 0, reason: "no token" };
  let written = 0;
  for (let i = 0; i < people.length; i += BATCH) {
    if (i) await sleep(PAUSE_MS);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          performUpsert: { fieldsToMergeOn: [FIELDS.key] },
          records: people.slice(i, i + BATCH).map((p) => ({ fields: fields(p) })),
        }),
        signal: controller.signal,
      });
      if (!r.ok) return { ok: false, written, reason: `HTTP ${r.status}` };
      written += Math.min(BATCH, people.length - i);
    } catch (e) {
      return { ok: false, written, reason: e && e.name === "AbortError" ? "timeout" : "network" };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: true, written };
}

module.exports = { upsertSubscribers };
