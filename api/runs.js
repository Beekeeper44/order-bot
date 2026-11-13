import { send } from "../lib/http.js";
import { currentUser } from "../lib/auth.js";
import { ensureTables } from "../lib/db.js";

export default async function handler(req, res) {
  if (!(await currentUser(req))) return send(res, 401, { error: "Sign in first." });
  const db = await ensureTables().catch(() => null);
  if (!db) return send(res, 200, { runs: [], logging: false });
  const runs = await db`
    SELECT run_id, MIN(created_at) AS at, MAX(who) AS who, MAX(qty) AS qty, BOOL_OR(dry) AS dry,
           COUNT(*) FILTER (WHERE ok) AS ok, COUNT(*) FILTER (WHERE NOT ok) AS failed,
           MAX(fields->>'order_type') AS order_type, MAX(fields->>'quantity') AS quantity, MAX(fields->>'po_number') AS po,
           MAX(fields->>'purchase_location') AS location,
           ARRAY_REMOVE(ARRAY_AGG(order_number ORDER BY seq), NULL) AS orders
    FROM order_bot_orders GROUP BY run_id ORDER BY MIN(created_at) DESC LIMIT 50`;
  send(res, 200, { runs, logging: true });
}
