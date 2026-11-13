// Native Snowflake queries through Metabase, same METABASE_HOST / METABASE_API_KEY as the other tools.
import { env } from "./env.js";

export async function nativeQuery(sql, params = {}) {
  const host = env("METABASE_HOST").replace(/\/$/, "");
  const key = env("METABASE_API_KEY");
  if (!host || !key) throw new Error("Missing METABASE_HOST or METABASE_API_KEY.");
  const tags = {}, parameters = [];
  for (const [name, { type, value }] of Object.entries(params)) {
    tags[name] = { id: name, name, "display-name": name, type };
    parameters.push({ type: type === "number" ? "number/=" : "category", target: ["variable", ["template-tag", name]], value });
  }
  const r = await fetch(`${host}/api/dataset`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({
      database: Number(env("METABASE_DB_ID", "397")),
      type: "native",
      native: { query: sql, "template-tags": tags },
      parameters,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error || j.status === "failed") throw new Error(j.error || `Metabase ${r.status}`);
  const cols = (j.data?.cols || []).map((c) => String(c.name).toLowerCase());
  return (j.data?.rows || []).map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}

// Run a saved question with one variable, e.g. {{po_number}}.
export async function savedQuestion(id, tag, value, type = "number/=") {
  const host = env("METABASE_HOST").replace(/\/$/, "");
  const key = env("METABASE_API_KEY");
  if (!host || !key) throw new Error("Missing METABASE_HOST or METABASE_API_KEY.");
  const r = await fetch(`${host}/api/card/${id}/query`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({ parameters: [{ type, target: ["variable", ["template-tag", tag]], value }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error || j.status === "failed") throw new Error(j.error || `Metabase ${r.status}`);
  const cols = (j.data?.cols || []).map((c) => String(c.name).toLowerCase());
  return (j.data?.rows || []).map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}
