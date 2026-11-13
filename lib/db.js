import { neon } from "@neondatabase/serverless";
import { env } from "./env.js";

let _sql = null, _ready = false;
export function sql() {
  if (!env("DATABASE_URL")) return null;
  if (!_sql) _sql = neon(env("DATABASE_URL"));
  return _sql;
}
export async function ensureTables() {
  const q = sql(); if (!q || _ready) return q;
  await q`CREATE TABLE IF NOT EXISTS order_bot_orders (
    id BIGSERIAL PRIMARY KEY,
    run_id TEXT NOT NULL,
    seq INT NOT NULL,
    qty INT NOT NULL,
    who TEXT,
    dry BOOLEAN NOT NULL,
    ok BOOLEAN NOT NULL,
    order_number TEXT,
    error TEXT,
    fields JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (run_id, seq)
  )`;
  await q`ALTER TABLE order_bot_orders ADD COLUMN IF NOT EXISTS order_id TEXT`;   // admin order uuid (for Click Me links)
  await q`CREATE INDEX IF NOT EXISTS order_bot_orders_created ON order_bot_orders (created_at)`;
  _ready = true;
  return q;
}
