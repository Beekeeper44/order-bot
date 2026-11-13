// ORDER-BOT team accounts (Neon): invite-only, scrypt passwords, admin/member roles.
import crypto from "node:crypto";
import { sql } from "./db.js";

let ready = false;
export async function usersDb() {
  const q = sql(); if (!q) throw new Error("DATABASE_URL is missing.");
  if (!ready) {
    await q`CREATE TABLE IF NOT EXISTS order_bot_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      pw_hash TEXT,
      pw_ver INT NOT NULL DEFAULT 0,
      invite_hash TEXT,
      invite_exp TIMESTAMPTZ,
      last_sign_in TIMESTAMPTZ,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    ready = true;
  }
  return q;
}

/* passwords: scrypt, no extra packages */
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 });
  return "scrypt$" + salt.toString("base64url") + "$" + key.toString("base64url");
}
export function checkPassword(pw, stored) {
  if (!stored || !stored.startsWith("scrypt$")) return false;
  const [, s, k] = stored.split("$");
  const want = Buffer.from(k, "base64url");
  const got = crypto.scryptSync(String(pw), Buffer.from(s, "base64url"), want.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(want, got);
}
const tokenHash = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
export const cleanEmail = (e) => String(e || "").trim().toLowerCase();
export const okEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export const okPassword = (p) => String(p || "").length >= 10;

const PUBLIC = (u) => u && ({
  id: u.id, email: u.email, name: u.name, role: u.role, active: u.active,
  has_password: !!u.pw_hash, invite_pending: !!u.invite_hash && (!u.invite_exp || new Date(u.invite_exp) > new Date()),
  last_sign_in: u.last_sign_in, created_at: u.created_at,
});
export { PUBLIC as publicUser };

export async function countUsers() { const q = await usersDb(); return Number((await q`SELECT COUNT(*)::int AS n FROM order_bot_users`)[0].n); }
export async function userById(id) { const q = await usersDb(); return (await q`SELECT * FROM order_bot_users WHERE id=${id}`)[0] || null; }
export async function userByEmail(email) { const q = await usersDb(); return (await q`SELECT * FROM order_bot_users WHERE email=${cleanEmail(email)}`)[0] || null; }
export async function listUsers() { const q = await usersDb(); return (await q`SELECT * FROM order_bot_users ORDER BY role, name`).map(PUBLIC); }

export async function createUser({ name, email, role = "member", password = null }, by = null) {
  const q = await usersDb();
  const id = crypto.randomUUID();
  await q`INSERT INTO order_bot_users (id, email, name, role, pw_hash, created_by)
          VALUES (${id}, ${cleanEmail(email)}, ${String(name).trim()}, ${role === "admin" ? "admin" : "member"},
                  ${password ? hashPassword(password) : null}, ${by})`;
  return id;
}
export async function newInvite(id) {
  const q = await usersDb();
  const token = crypto.randomBytes(24).toString("base64url");
  await q`UPDATE order_bot_users SET invite_hash=${tokenHash(token)}, invite_exp=now() + interval '7 days' WHERE id=${id}`;
  return token;
}
export async function userByInvite(token) {
  const q = await usersDb();
  return (await q`SELECT * FROM order_bot_users WHERE invite_hash=${tokenHash(token)} AND active AND (invite_exp IS NULL OR invite_exp > now())`)[0] || null;
}
export async function setPassword(id, pw) {
  const q = await usersDb();
  await q`UPDATE order_bot_users SET pw_hash=${hashPassword(pw)}, pw_ver=pw_ver+1, invite_hash=NULL, invite_exp=NULL WHERE id=${id}`;
  return userById(id);
}
export async function touchSignIn(id) { const q = await usersDb(); await q`UPDATE order_bot_users SET last_sign_in=now() WHERE id=${id}`; }
export async function updateUser(id, { role, active, name }) {
  const q = await usersDb();
  await q`UPDATE order_bot_users SET
            role = COALESCE(${role ?? null}, role),
            active = COALESCE(${active ?? null}, active),
            name = COALESCE(${name ?? null}, name),
            pw_ver = CASE WHEN ${active === false} THEN pw_ver + 1 ELSE pw_ver END
          WHERE id=${id}`;
  return userById(id);
}
export async function removeUser(id) { const q = await usersDb(); await q`DELETE FROM order_bot_users WHERE id=${id}`; }
export async function activeAdmins() { const q = await usersDb(); return Number((await q`SELECT COUNT(*)::int AS n FROM order_bot_users WHERE role='admin' AND active`)[0].n); }
