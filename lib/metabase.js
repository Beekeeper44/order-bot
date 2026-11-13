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
  if (!r.ok || j.error || j.status === "failed") throw new Error(`Metabase ${r.status}: ${j.message || j.error || "query failed"}`);
  const cols = (j.data?.cols || []).map((c) => String(c.name).toLowerCase());
  return (j.data?.rows || []).map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}

// Run a saved question with one variable, e.g. {{po_number}}.
// Metabase is picky about the parameter shape (it 400s on a mismatch), so read the card's own
// parameter definition first and send exactly that id / type / target, then fall back to other shapes.
async function mbFetch(path, body) {
  const host = env("METABASE_HOST").replace(/\/$/, "");
  const key = env("METABASE_API_KEY");
  if (!host || !key) throw new Error("Missing METABASE_HOST or METABASE_API_KEY.");
  const r = await fetch(host + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  return { ok: r.ok, status: r.status, j, text };
}
const rowsOf = (j) => {
  const cols = (j.data?.cols || []).map((c) => String(c.name).toLowerCase());
  return (j.data?.rows || []).map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
};
const errOf = (r) => (r.j && (r.j.message || r.j.error || (r.j.errors && JSON.stringify(r.j.errors)))) || (r.text || "").slice(0, 200) || `HTTP ${r.status}`;

export async function savedQuestion(id, tag, value) {
  const shapes = [];
  // 1. the card's own parameter, exactly as Metabase defined it
  const card = await mbFetch(`/api/card/${id}`);
  if (card.ok && card.j) {
    const params = card.j.parameters || [];
    const tt = card.j.dataset_query?.native?.["template-tags"] || {};
    const tdef = tt[tag] || Object.values(tt).find((t) => t && (t.name === tag || t["display-name"]?.toLowerCase().replace(/\s+/g, "_") === tag));
    const p = params.find((x) => x.slug === tag || (tdef && x.id === tdef.id) || (Array.isArray(x.target) && JSON.stringify(x.target).includes(`"${tag}"`)));
    const isNum = /number/.test(p?.type || tdef?.type || "");   // Text variable → send "4629" as text
    const v = isNum ? Number(value) : String(value);
    if (p) shapes.push([{ id: p.id, type: p.type, target: p.target, value: [v] }], [{ id: p.id, type: p.type, target: p.target, value: v }]);
    if (tdef) shapes.push([{ id: tdef.id, type: isNum ? "number/=" : "category", target: ["variable", ["template-tag", tdef.name]], value: [v] }]);
  } else if (card.status === 401 || card.status === 403) {
    throw new Error(`Metabase ${card.status}: the API key can't open question ${id}. Move it to a collection the key can see.`);
  } else if (card.status === 404) {
    throw new Error(`Metabase question ${id} not found.`);
  }
  // 2. generic shapes
  const tgt = ["variable", ["template-tag", tag]];
  // Question 47554's po_number is a Text variable, so text shapes go first.
  shapes.push(
    [{ type: "category", target: tgt, value: String(value) }],
    [{ type: "category", target: tgt, value: [String(value)] }],
    [{ type: "string/=", target: tgt, value: [String(value)] }],
    [{ type: "number/=", target: tgt, value: [Number(value)] }],
  );
  let last = null;
  for (const parameters of shapes) {
    const r = await mbFetch(`/api/card/${id}/query`, { parameters });
    if (r.ok && r.j && !r.j.error && r.j.status !== "failed") return rowsOf(r.j);
    last = r;
    if (r.status === 401 || r.status === 403) break;
    if (r.ok && r.j && r.j.error) break;   // query itself failed (SQL error), shape was fine
  }
  throw new Error(`Metabase ${last?.status ?? "?"}: ${errOf(last || {})}`);
}
