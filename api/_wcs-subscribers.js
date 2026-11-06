/*
 * WCS Subscribers, in the One Culture Foundation Airtable base: one record per address that asked
 * for World Culture Salon news through the gallery's Subscribe ("Follow the chapter"). Since
 * 2026-11-05 this table is the only place the gallery keeps subscribers (Founder decision); the
 * gallery's own list was imported and then cleared. Used by api/subscribe.js. Vercel does not
 * route files whose names begin with "_", so this is a module, not an endpoint.
 *
 * Records are upserted on Email Key (the lowercased address), so a repeat sign-up updates the one
 * record instead of adding another. The site writes Email, Email Key, Source and Last Signed Up;
 * the table's Subscribed Since is when the record was created. Status and Notes are kept by hand
 * and never sent.
 *
 * Environment:
 *   AIRTABLE_OCF_TOKEN   personal access token, scope data.records:write on the OCF base only.
 */

const BASE = "appZvVV7zU2q7r303";
const TABLE = "tbl7vzAVUDaZ2puHw";
const FIELDS = {
  email: "fldNbAcFWDPz0SFMp",
  key: "fld84uLhtxmaDoWu6",
  last: "fldcqlQuAJXRV09tq",
  source: "fldu5DlNQahMpJ7lj",
};
const SOURCE = "gallery.oneculturefdn.org";
const TIMEOUT_MS = 10000;

/** Upserts one subscriber (email already lowercased). Never throws; never logs the address. */
async function upsertSubscriber(email) {
  const token = process.env.AIRTABLE_OCF_TOKEN;
  if (!token) return { ok: false, reason: "no token" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        performUpsert: { fieldsToMergeOn: [FIELDS.key] },
        records: [{
          fields: {
            [FIELDS.email]: email,
            [FIELDS.key]: email,
            [FIELDS.source]: SOURCE,
            [FIELDS.last]: new Date().toISOString(),
          },
        }],
      }),
      signal: controller.signal,
    });
    return r.ok ? { ok: true } : { ok: false, reason: `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, reason: e && e.name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { upsertSubscriber };
