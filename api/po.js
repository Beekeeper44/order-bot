// Look up a purchase order by its number (e.g. 5115) from APP_PROD.ADMIN.PURCHASE_ORDERS.
import { send } from "../lib/http.js";
import { env } from "../lib/env.js";
import { currentUser } from "../lib/auth.js";
import { nativeQuery, savedQuestion } from "../lib/metabase.js";

const NUM_COLS = () => [env("PO_NUMBER_COLUMN"), "NUMBER", "PO_NUMBER", "PURCHASE_ORDER_NUMBER"].filter(Boolean);
const SKIP = /^_snowflake|^_fivetran|deleted|^id$/;

export default async function handler(req, res) {
  if (!(await currentUser(req))) return send(res, 401, { error: "Sign in first." });
  const n = String(req.query?.number ?? new URL(req.url, "http://x").searchParams.get("number") ?? "").replace(/^#/, "").trim();
  if (!/^\d{1,9}$/.test(n)) return send(res, 400, { error: "Enter a PO number, like 5115." });

  // Preferred: a saved Metabase question (PO_QUESTION_ID) with a {{po_number}} variable.
  // Columns it should return: PO_ID, PO_NUMBER, STATUS, CREATED_AT, ITEM_CATEGORY (optional), ORDER_COUNT (optional).
  // Metabase question 47554 "ORDER-BOT PO Lookup" (one row per order on the PO).
  const qid = env("PO_QUESTION_ID", "47554");
  if (qid && qid !== "off") {
    try {
      const r = await savedQuestion(qid, "po_number", Number(n));
      if (!r.length) return send(res, 404, { error: `No purchase order #${n}.` });
      const po = r[0];
      const orders = r.filter((x) => x.order_number != null || x.order_id != null).map((x) => ({
        id: x.order_id ?? null,
        number: x.order_number ?? null,
        status: x.order_status ?? null,
        type: x.order_type ?? x.order_kind ?? null,
        qty: x.quantity ?? x.order_quantity ?? null,
        cost: x.order_purchase_cost ?? null,
        loc: x.purchase_location ?? x.order_purchase_location ?? null,
      }));
      const skip = /^(po_id|id|po_number|number|item_category|category|status|po_status|created_at|order_count|po_line_details|order_.*|quantity|purchase_location)$/;
      return send(res, 200, {
        id: String(po.po_id ?? po.id ?? ""),
        number: n,
        category: po.item_category ?? po.category ?? null,
        status: po.po_status ?? po.status ?? null,
        createdAt: po.created_at ?? po.po_order_date ?? null,
        orderCount: po.order_count != null ? Number(po.order_count) : orders.length,
        orders,
        details: Object.entries(po).filter(([k, v]) => !skip.test(k) && v != null && v !== "" && typeof v !== "object").slice(0, 14),
      });
    } catch (e) {
      return send(res, 502, { error: "Couldn't run Metabase question " + qid + ": " + e.message });
    }
  }

  // Fallback: native query straight against the table.
  let rows = null, lastErr = null;
  for (const col of [...new Set(NUM_COLS())]) {
    try {
      rows = await nativeQuery(
        `SELECT * FROM APP_PROD.ADMIN.PURCHASE_ORDERS
         WHERE "${col.replace(/"/g, "")}" = {{po}} AND NOT COALESCE(_SNOWFLAKE_DELETED, FALSE)
         LIMIT 2`,
        { po: { type: "number", value: Number(n) } });
      break;
    } catch (e) { lastErr = e; }
  }
  if (!rows) return send(res, 502, { error: "Couldn't search purchase orders: " + (lastErr?.message || "unknown error") });
  if (!rows.length) return send(res, 404, { error: `No purchase order #${n}.` });

  const po = rows[0];
  const id = po.id ? String(po.id) : "";
  const pick = (...ks) => { for (const k of ks) if (po[k] != null && po[k] !== "") return po[k]; return null; };
  const details = Object.entries(po)
    .filter(([k, v]) => !SKIP.test(k) && v != null && v !== "" && typeof v !== "object")
    .slice(0, 14);

  let orderCount = null;
  if (id) {
    try {
      const c = await nativeQuery(
        `SELECT COUNT(*) AS n FROM APP_PROD.ADMIN.ORDERS
         WHERE PURCHASE_ORDER_ID = {{id}} AND NOT COALESCE(_SNOWFLAKE_DELETED, FALSE)`,
        { id: { type: "text", value: id } });
      orderCount = Number(c[0]?.n ?? 0);
    } catch {}
  }

  send(res, 200, {
    id,
    number: n,
    category: pick("item_category", "category"),
    status: pick("status"),
    createdAt: pick("created_at"),
    orderCount,
    details,
  });
}
