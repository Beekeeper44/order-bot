// Signed HttpOnly session cookie → a row in order_bot_users (checked on every request).
import crypto from "node:crypto";
import { env } from "./env.js";
import { userById } from "./users.js";

const COOKIE = "orderbot_s";
const MAX_AGE = 60 * 60 * 24 * 14;
function secret() {
  const s = env("SESSION_SECRET");
  if (s.length < 16) throw new Error("SESSION_SECRET is missing or too short.");
  return s;
}
const mac = (v) => crypto.createHmac("sha256", secret()).update(v).digest("base64url");

export function makeCookie(user) {
  const body = Buffer.from(JSON.stringify({ id: user.id, v: user.pw_ver, exp: Math.floor(Date.now() / 1000) + MAX_AGE })).toString("base64url");
  return `${COOKIE}=${body}.${mac(body)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function readCookie(req) {
  const raw = (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  if (!raw) return null;
  const [body, sig] = raw.slice(COOKIE.length + 1).split(".");
  if (!body || !sig) return null;
  const want = mac(body);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try { const d = JSON.parse(Buffer.from(body, "base64url").toString()); return d.exp > Date.now() / 1000 ? d : null; } catch { return null; }
}

/** The signed-in, active user (or null). A password reset or "turn off" ends old sessions. */
export async function currentUser(req) {
  try {
    const c = readCookie(req); if (!c) return null;
    const u = await userById(c.id);
    return u && u.active && u.pw_ver === c.v ? u : null;
  } catch { return null; }
}
