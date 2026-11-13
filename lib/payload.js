// Builds the body for admin's create-order call:
//   POST {ADMIN_API_BASE}/admin/v1/orders/submission
//   { orderType: "vault_only" | "grade_and_vault", quantity: 100, purchaseOrderId: "<PO uuid>",
//     purchaseCostCents: 100, purchaseLocation: "PO 5115 500+ BB P1", note: "…" (only when filled) }
//   → 201 { orderId: "<uuid>", number: 21246195 }
// (captured from dev admin 2026-11-13). Item category comes from the PO, so it isn't sent.
//
// ORDER_BODY_TEMPLATE (optional env) overrides the body. Placeholders:
//   {{purchase_order_id}} {{order_type_value}} {{quantity}} {{purchase_cost_cents}}
//   {{purchase_location}} {{notes}} {{po_number}} {{item_category}}
// Quoted placeholders go in as text; bare ones go in as a number, or null when empty.
import { env } from "./env.js";

export function orderValues(f, seq, qty) {
  const num = (x) => (x === "" || x == null || Number.isNaN(Number(x)) ? null : Number(x));
  return {
    item_category: String(f.item_category || "cards"),
    order_type: String(f.order_type || "").trim(),
    order_type_value: orderTypeValue(f.order_type),
    quantity: num(f.quantity),
    purchase_cost: num(f.purchase_cost),
    purchase_cost_cents: num(f.purchase_cost) == null ? null : Math.round(num(f.purchase_cost) * 100),
    po_number: String(f.po_number || "").trim(),
    purchase_order_id: String(f.purchase_order_id || "").trim(),
    purchase_location: String(f.purchase_location || "").trim(),
    notes: String(f.notes || "").trim(),
    seq, qty,
  };
}

// ORDER_TYPES (optional env): JSON list of [label, description, apiValue], e.g.
//   [["Grade & Vault (Raw)","Raw cards — graded, then vaulted","grade_and_vault"]]
// apiValue fills {{order_type_value}}; when missing, the label is used.
export function orderTypes() {
  try { const t = JSON.parse(env("ORDER_TYPES") || "null"); if (Array.isArray(t)) return t; } catch {}
  return [
    ["Vault It (Pre-Graded Slab)", "Pre-graded slabs only — raw cards aren't accepted", "vault_only"],
    ["Grade & Vault (Raw)", "Raw cards — graded, then vaulted", "grade_and_vault"],
  ];
}
export function findOrderType(label) {
  const l = String(label || "").trim().toLowerCase();
  return orderTypes().find((t) => String(t[0]).toLowerCase() === l || String(t[2] || "").toLowerCase() === l) || null;
}
function orderTypeValue(label) {
  const hit = findOrderType(label);
  return hit && hit[2] ? hit[2] : String(label || "").trim();
}

function defaultBody(v) {
  const body = {
    orderType: v.order_type_value,
    quantity: v.quantity,
    purchaseOrderId: v.purchase_order_id,
    purchaseCostCents: v.purchase_cost_cents,
    purchaseLocation: v.purchase_location,
  };
  // Captured 2026-11-13: admin sends notes as "note", and only when filled in.
  if (v.notes) body[env("NOTES_FIELD", "note")] = v.notes;
  return body;
}

export function buildBody(v) {
  const tpl = env("ORDER_BODY_TEMPLATE");
  if (!tpl) return defaultBody(v);
  const esc = (s) => JSON.stringify(String(s ?? "")).slice(1, -1);
  const out = tpl
    .replace(/"\{\{(\w+)\}\}"/g, (_, k) => `"${esc(v[k])}"`)
    .replace(/\{\{(\w+)\}\}/g, (_, k) => {
      const n = v[k];
      return n === null || n === undefined || n === "" || Number.isNaN(Number(n)) ? "null" : String(Number(n));
    });
  return JSON.parse(out);
}

export function orderNumberFrom(j) {
  if (!j || typeof j !== "object") return null;
  const d = j.data && typeof j.data === "object" ? j.data : j;
  const o = d.order && typeof d.order === "object" ? d.order : d;
  return o.orderNumber ?? o.order_number ?? o.number ?? o.displayId ?? o.id ?? null;
}
