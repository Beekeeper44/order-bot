# ORDER-BOT

Look up a purchase order, fill in admin's Create New Order fields in the right panel, set **Duplicate**
to how many of that exact order you need, and ORDER-BOT creates them one by one in admin.

## Admin call (captured from dev admin, 2026-11-13)
```
POST {ADMIN_API_BASE}/admin/v1/orders/submission
Cookie: sAccessToken=…   st-auth-mode: cookie   rid: anti-csrf
{ "orderType": "vault_only", "quantity": 100, "purchaseOrderId": "<PO uuid>",
  "purchaseCostCents": 100, "purchaseLocation": "PO 5115 500+ BB P1" }
→ 201 { "orderId": "<uuid>", "number": 21246195 }
```
This is built in. No ORDER_CREATE_PATH / ORDER_BODY_TEMPLATE needed.

Order type values: Vault It (Pre-Graded Slab) = `vault_only`, Grade & Vault (Raw) = `grade_and_vault`.
Notes go in `note` (sent only when filled in). More types: env ORDER_TYPES as `[["Label","Description","api_value"], …]`.

## Deploy — real admin (chosen)
1. New private GitHub repo from this folder → Vercel → Add New → Project → import.
2. Settings → Environment Variables → **Shared**: link METABASE_HOST, METABASE_API_KEY,
   SUPERTOKENS_API_KEY, SUPERTOKENS_CONNECTION_URI to this project.
3. Project env vars: ADMIN_SESSION_USER_ID (same as ev-bot), DATABASE_URL (ev-bot's Neon is fine;
   tables order_bot_orders + order_bot_users are created automatically), SESSION_SECRET (long random),
   SETUP_CODE (any word you choose; used once to create the first admin), DRY_RUN=true.
   ADMIN_API_BASE not needed (defaults to https://admin-api.arenaclub.com).
4. Deploy → first visit asks for name, email, password + SETUP_CODE → you're the first admin.
   Users tab → Add person → copy their one-time invite link (7 days) and send it to them.
   "Setup check" (read-only) → every row ✅.
5. Dry run on a real PO → DRY_RUN=false + redeploy → create 1 order → check in admin → batches.

## Deploy — dev (optional)
1. New Vercel project from this repo, e.g. `order-bot-dev`.
2. Env vars:
   - `ADMIN_API_BASE=https://dev.admin-api.arenaclub.com`
   - `SUPERTOKENS_CONNECTION_URI`, `SUPERTOKENS_API_KEY`, `ADMIN_SESSION_USER_ID` — the **dev** values
   - `DATABASE_URL` — a separate Neon branch for dev
   - `SESSION_SECRET` (long random string), `SETUP_CODE` (first admin only)
   - `METABASE_HOST`, `METABASE_API_KEY`, `PO_QUESTION_ID` — defaults to Metabase question 47554 (variable `po_number`); reads prod data
   - `DRY_RUN=true` to start
3. In dev, start with the dev PO page link + the PO number in the lookup box (lookup by number alone
   returns prod PO IDs). Dry run → then `DRY_RUN=false`, create 1 order, check it in dev admin, then batches.

## Switch to real admin
Same build. Change env: `ADMIN_API_BASE=https://admin-api.arenaclub.com`, the prod SuperTokens values
(same as ev-bot), the prod `DATABASE_URL`. Redeploy. PO lookup by number works directly.

## Orders on a PO
The PO card lists the PO's orders from admin itself: `GET {ADMIN_API_BASE}/admin/v1/orders?purchaseOrderId=<PO id>`
(the call admin's PO page makes). Override with ORDERS_LIST_PATH (use {{id}}) if needed. Refreshes after each live run.

## Behavior
- One API call per order: each order shows its own status and number; Stop mid-run; Retry failed only.
- Every duplicate is identical: order type, quantity, purchase cost, PO, location, notes.
- Each order is logged in Neon (`order_bot_orders`) with run id, who, and admin order number; a rerun of
  the same run never creates an order twice.

## Metabase: "ORDER-BOT PO Lookup" question
Native SQL, database APP_PROD (397), one variable `po_number` (type Number). Save it and set PO_QUESTION_ID.
See the query in the chat / adjust column names after running `SELECT * FROM APP_PROD.ADMIN.PURCHASE_ORDERS LIMIT 5`.
Without PO_QUESTION_ID, ORDER-BOT queries APP_PROD.ADMIN.PURCHASE_ORDERS directly (column NUMBER or PO_NUMBER, or PO_NUMBER_COLUMN).

## Who created the order (admin operation log)
Each ORDER-BOT user is linked to their Arena admin login (Users → admin login: link by admin email / paste ID / test).
Live orders are created with a SuperTokens session for **that person's** admin user id, so admin's own
operation log records who created each order. Unlinked users can't create live orders (dry runs still work).
Reads (PO lookup, order lists) use the service user ADMIN_SESSION_USER_ID.
Escape hatch: ALLOW_SERVICE_USER=true lets unlinked users create orders as the service user (not recommended).
