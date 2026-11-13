// Creates ONE order per call. The page calls this once per order so every order
// gets its own result and long runs never hit the function time limit.
import { send, readJson } from "../lib/http.js";
import { env, isDryRun, maxQty, createReady, createPath } from "../lib/env.js";
import { currentUser } from "../lib/auth.js";
import { adminFetch } from "../lib/admin.js";
import { orderValues, buildBody, orderNumberFrom, findOrderType } from "../lib/payload.js";
import { ensureTables } from "../lib/db.js";


export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  const me = await currentUser(req);
  if (!me) return send(res, 401, { error: "Sign in first." });
  const who = me.name;

  let b; try { b = await readJson(req); } catch { return send(res, 400, { error: "Bad JSON." }); }
  const { runId, seq, qty, fields = {} } = b;
  // The PO path can carry {{purchase_order_id}}, e.g. /packs/purchase-orders/{{purchase_order_id}}/orders
  const n = Number(qty), i = Number(seq);
  if (!runId || !/^[\w-]{6,64}$/.test(runId)) return send(res, 400, { error: "Missing run id." });
  if (!Number.isInteger(n) || n < 1 || n > maxQty()) return send(res, 400, { error: `Quantity must be 1–${maxQty()}.` });
  if (!Number.isInteger(i) || i < 1 || i > n) return send(res, 400, { error: "Bad order position." });
  if (!String(fields.order_type || "").trim()) return send(res, 400, { error: "Order type is required." });
  if (!/^\d+$/.test(String(fields.quantity || "")) || Number(fields.quantity) < 1) return send(res, 400, { error: "Quantity must be a whole number." });
  if (fields.purchase_cost === "" || !(Number(fields.purchase_cost) >= 0)) return send(res, 400, { error: "Purchase cost is required." });
  if (!String(fields.po_number || "").trim()) return send(res, 400, { error: "PO number is required." });

  const dry = isDryRun() || b.dryRun !== false;
  // Live orders are created as the signed-in person's own Arena admin user, so admin's operation log shows who made them.
  const asUser = me.admin_user_id || (env("ALLOW_SERVICE_USER") === "true" ? env("ADMIN_SESSION_USER_ID") : "");
  if (!dry && !asUser) return send(res, 409, { error: "Your ORDER-BOT account isn't linked to your Arena admin login yet. Ask an ORDER-BOT admin to link it in Users (admin login → link by admin email)." });
  if (!dry && !createReady()) return send(res, 409, { error: "Live create isn't set up yet (ORDER_CREATE_PATH is empty). Use Dry run." });
  if (!dry) {
    const t = findOrderType(fields.order_type);
    if (!env("ORDER_BODY_TEMPLATE") && !(t && t[2])) return send(res, 400, { error: `Admin's value for "${fields.order_type}" isn't known yet. Capture one order of this type, or add it to ORDER_TYPES.` });
    if (!/^[0-9a-f-]{36}$/i.test(String(fields.purchase_order_id || ""))) return send(res, 400, { error: "This PO has no PO ID. Look it up again or paste the PO page link." });
  }

  const db = await ensureTables().catch(() => null);
  if (db) {
    const dup = await db`SELECT ok, order_number FROM order_bot_orders WHERE run_id=${runId} AND seq=${i}`;
    if (dup.length && dup[0].ok) return send(res, 200, { ok: true, seq: i, orderNumber: dup[0].order_number, dry, repeat: true });
  }

  const v = orderValues(fields, i, n);
  let body; try { body = buildBody(v); } catch (e) { return send(res, 500, { error: "ORDER_BODY_TEMPLATE is not valid JSON: " + e.message }); }

  let out, fallback = false;
  if (dry) {
    out = { ok: true, seq: i, dry: true, orderNumber: null, body };
  } else {
    try {
      const path = createPath().replace(/\{\{purchase_order_id\}\}/g, encodeURIComponent(v.purchase_order_id));
      if (path.includes("purchase-orders//")) throw new Error("This create call needs the purchase order link.");
      let r = await adminFetch(path, { method: env("ORDER_CREATE_METHOD", "POST"), body, headers: { "idempotency-key": `${runId}-${i}` }, asUser });
      // Admin refused this person's own login (e.g. "403 invalid claim"): create it as the service user instead,
      // with "Created by <name> via ORDER-BOT" in the order note so admin still shows who made it.
      const svc = env("ADMIN_SESSION_USER_ID");
      if ((r.status === 401 || r.status === 403) && asUser !== svc && env("FALLBACK_TO_SERVICE_USER", "true") !== "false") {
        const tag = `Created by ${who} via ORDER-BOT`;
        const noteKey = env("NOTES_FIELD", "note");
        const b2 = { ...body, [noteKey]: body[noteKey] ? `${body[noteKey]} · ${tag}` : tag };
        r = await adminFetch(path, { method: env("ORDER_CREATE_METHOD", "POST"), body: b2, headers: { "idempotency-key": `${runId}-${i}-svc` } });
        if (r.ok) fallback = true;
      }
      if (!r.ok) {
        const msg = r.json?.message || r.json?.error || (r.text || "").slice(0, 200) || `Admin returned ${r.status}`;
        out = { ok: false, seq: i, dry: false, error: `${r.status}: ${msg}` };
      } else {
        const num = orderNumberFrom(r.json);
        const oid = r.json && (r.json.orderId || r.json.id);
        out = { ok: true, seq: i, dry: false, orderNumber: num != null ? String(num) : null, orderId: oid ? String(oid) : null, fallback };
      }
    } catch (e) {
      out = { ok: false, seq: i, dry: false, error: e.message };
    }
  }

  if (db) {
    await db`INSERT INTO order_bot_orders (run_id, seq, qty, who, dry, ok, order_number, order_id, error, fields)
             VALUES (${runId}, ${i}, ${n}, ${who}, ${out.dry}, ${out.ok}, ${out.orderNumber || null}, ${out.orderId || null}, ${out.error || null}, ${JSON.stringify(v)})
             ON CONFLICT (run_id, seq) DO UPDATE SET ok=EXCLUDED.ok, order_number=EXCLUDED.order_number, order_id=EXCLUDED.order_id, error=EXCLUDED.error, created_at=now()`
      .catch(() => {});
  }
  send(res, out.ok ? 200 : 502, out);
}
