// Dashboard data: live orders created through ORDER-BOT between start and end (ISO times from the browser).
// Returns one row per order; the page groups them by person and by day in the viewer's own time zone.
import { send } from "../lib/http.js";
import { currentUser } from "../lib/auth.js";
import { ensureTables } from "../lib/db.js";

export default async function handler(req, res) {
  if (!(await currentUser(req))) return send(res, 401, { error: "Sign in first." });
  const db = await ensureTables().catch(() => null);
  if (!db) return send(res, 200, { orders: [], logging: false });
  const u = new URL(req.url, "http://x");
  const start = new Date(u.searchParams.get("start") || 0);
  const end = new Date(u.searchParams.get("end") || Date.now());
  if (isNaN(start) || isNaN(end)) return send(res, 400, { error: "Bad date range." });
  const rows = await db`
    SELECT who, order_number, order_id, created_at,
           fields->>'po_number' AS po, fields->>'order_type' AS type,
           (fields->>'quantity')::numeric AS qty, (fields->>'purchase_cost')::numeric AS cost,
           fields->>'purchase_location' AS loc
    FROM order_bot_orders
    WHERE ok AND NOT dry AND order_number IS NOT NULL
      AND created_at >= ${start.toISOString()} AND created_at <= ${end.toISOString()}
    ORDER BY created_at DESC
    LIMIT 20000`;
  send(res, 200, { logging: true, orders: rows.map((r) => ({ ...r, qty: Number(r.qty) || 0, cost: Number(r.cost) || 0 })) });
}
