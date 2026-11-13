// Orders already on a purchase order, straight from admin (same call admin's PO page makes):
//   GET {ADMIN_API_BASE}/admin/v1/orders?purchaseOrderId=<PO uuid>&sortBy=number&sortDirection=asc&limit=50
//   (ORDER-BOT asks newest first: sortDirection=desc)
//   → { items: [{ id, number, kind, userId, status, authenticationStatus, declaredCardCount,
//                 purchaseCostCents, purchaseLocation, note, inboundAt }], totalCount }   (captured 2026-11-13)
// Works in dev and prod because it follows ADMIN_API_BASE. Override the path with ORDERS_LIST_PATH.
import { send } from "../lib/http.js";
import { env } from "../lib/env.js";
import { currentUser } from "../lib/auth.js";
import { adminFetch } from "../lib/admin.js";
import { ensureTables } from "../lib/db.js";

const pick = (o, ...ks) => { for (const k of ks) if (o && o[k] != null && o[k] !== "") return o[k]; return null; };

export default async function handler(req, res) {
  if (!(await currentUser(req))) return send(res, 401, { error: "Sign in first." });
  const id = String(new URL(req.url, "http://x").searchParams.get("id") || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return send(res, 400, { error: "Missing PO ID." });

  const tpl = env("ORDERS_LIST_PATH", "/admin/v1/orders?purchaseOrderId={{id}}&sortBy=number&sortDirection=desc&limit={{limit}}");
  const path = (limit) => tpl.replace("{{id}}", encodeURIComponent(id)).replace("{{limit}}", limit);
  let r;
  try {
    r = await adminFetch(path(200));
    if (r.status === 400) r = await adminFetch(path(50));   // admin's own page uses 50
  } catch (e) { return send(res, 502, { error: "Couldn't reach admin: " + e.message }); }
  if (!r.ok) return send(res, 502, { error: `Admin returned ${r.status} for the PO's orders.` });

  const j = r.json;
  const list = Array.isArray(j) ? j : (j && (j.data || j.items || j.orders || j.results || j.rows)) || [];
  const orders = (Array.isArray(list) ? list : []).map((o) => {
    const cents = pick(o, "purchaseCostCents", "purchase_cost_cents");
    return {
      id: pick(o, "id", "orderId"),
      number: pick(o, "number", "orderNumber", "order_number"),
      status: pick(o, "status", "orderStatus"),
      type: pick(o, "orderType", "order_type"),
      qty: pick(o, "declaredCardCount", "quantity", "cardCount", "itemCount"),
      cost: cents != null ? Number(cents) / 100 : pick(o, "purchaseCost", "purchase_cost"),
      loc: pick(o, "purchaseLocation", "purchase_location"),
      note: pick(o, "note", "notes"),
      createdAt: pick(o, "inboundAt", "createdAt", "created_at"),
    };
  });
  // Who created each order through ORDER-BOT (orders made by hand in admin show no name)
  try {
    const db = await ensureTables();
    const nums = orders.map((o) => o.number).filter((n) => n != null).map(String);
    if (db && nums.length) {
      const rows = await db`SELECT DISTINCT ON (order_number) order_number, who, fields->>'order_type' AS order_type FROM order_bot_orders
                            WHERE ok AND NOT dry AND order_number = ANY(${nums}) ORDER BY order_number, created_at DESC`;
      const log = Object.fromEntries(rows.map((r) => [String(r.order_number), r]));
      orders.forEach((o) => { const l = log[String(o.number)]; o.by = l ? l.who : null; if (!o.type && l && l.order_type) o.type = l.order_type; });
    }
  } catch {}
  const total = j && j.totalCount != null ? Number(j.totalCount) : orders.length;
  send(res, 200, { orders, totalCount: total });
}
