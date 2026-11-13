// Read-only setup check: env vars, Metabase PO question, admin sign-in + PO orders read, Neon.
// Never creates anything. Open /api/check?po=4629 or use "Setup check" in the app.
import { send } from "../lib/http.js";
import { env, isDryRun, adminBase, createPath } from "../lib/env.js";
import { currentUser } from "../lib/auth.js";
import { savedQuestion } from "../lib/metabase.js";
import { adminFetch } from "../lib/admin.js";
import { ensureTables } from "../lib/db.js";

export default async function handler(req, res) {
  if (!(await currentUser(req))) return send(res, 401, { error: "Sign in first." });
  const po = String(new URL(req.url, "http://x").searchParams.get("po") || "4629").replace(/\D/g, "") || "4629";
  const rows = [];
  const add = (name, ok, note) => rows.push({ name, ok, note });

  const need = ["METABASE_HOST", "METABASE_API_KEY", "SUPERTOKENS_CONNECTION_URI", "SUPERTOKENS_API_KEY", "ADMIN_SESSION_USER_ID", "DATABASE_URL", "SESSION_SECRET", "SETUP_CODE"];
  const missing = need.filter((k) => !env(k));
  add("Env vars", !missing.length, missing.length ? "Missing: " + missing.join(", ") : "All set");
  add("Writes to", true, adminBase() + createPath() + (isDryRun() ? "  (DRY_RUN=true: nothing is written)" : "  (LIVE)"));

  let poId = "";
  try {
    const r = await savedQuestion(env("PO_QUESTION_ID", "47554"), "po_number", Number(po));
    poId = r[0] ? String(r[0].po_id ?? r[0].id ?? "") : "";
    add(`Metabase question ${env("PO_QUESTION_ID", "47554")}`, !!r.length, r.length ? `PO #${po} found · ${r[0].item_category ?? "no category"} · ${r.filter((x) => x.order_number != null).length} order rows` : `No PO #${po}`);
  } catch (e) { add(`Metabase question ${env("PO_QUESTION_ID", "47554")}`, false, e.message); }

  try {
    if (!poId) throw new Error("Skipped: no PO ID from Metabase");
    const r = await adminFetch(env("ORDERS_LIST_PATH", "/admin/v1/orders?purchaseOrderId={{id}}&sortBy=number&sortDirection=desc&limit={{limit}}").replace("{{id}}", encodeURIComponent(poId)).replace("{{limit}}", "50"));
    const list = Array.isArray(r.json) ? r.json : (r.json && (r.json.data || r.json.items || r.json.orders || r.json.results)) || [];
    add("Admin sign-in + read PO orders", r.ok, r.ok ? `OK · ${r.json && r.json.totalCount != null ? r.json.totalCount : (Array.isArray(list) ? list.length : "?")} orders on PO #${po}` : `Admin returned ${r.status}`);
  } catch (e) { add("Admin sign-in + read PO orders", false, e.message); }

  try { const db = await ensureTables(); if (!db) throw new Error("DATABASE_URL missing"); await db`SELECT 1`; add("Neon run log", true, "Connected · table order_bot_orders ready"); }
  catch (e) { add("Neon run log", false, e.message); }

  send(res, 200, { ok: rows.every((r) => r.ok), rows });
}
