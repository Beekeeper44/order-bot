// Admin calls use SuperTokens sessions, like ev-bot / MP BOT.
// Writes (creating orders) run as the signed-in person's own admin user, so admin's operation log
// records who created each order. Reads use the service user (ADMIN_SESSION_USER_ID).
import { env, adminBase } from "./env.js";

const sessions = new Map(); // adminUserId -> { token, exp }
const stUri = () => env("SUPERTOKENS_CONNECTION_URI").replace(/\/$/, "");
const stKey = () => env("SUPERTOKENS_API_KEY");
const cdi = () => env("SUPERTOKENS_CDI_VERSION", "2.21");

async function newSession(userId) {
  if (!stUri() || !stKey()) throw new Error("Missing SUPERTOKENS_CONNECTION_URI or SUPERTOKENS_API_KEY.");
  if (!userId) throw new Error("No admin user to sign in as.");
  const r = await fetch(`${stUri()}/recipe/session`, {
    method: "POST",
    headers: { "content-type": "application/json", "api-key": stKey(), rid: "session", "cdi-version": cdi() },
    body: JSON.stringify({ userId, userDataInJWT: {}, userDataInDatabase: {}, enableAntiCsrf: false, useDynamicSigningKey: true }),
  });
  const j = await r.json().catch(() => ({}));
  const token = j?.accessToken?.token;
  if (!r.ok || !token) throw new Error(`Admin sign-in failed for admin user ${userId} (${r.status}).`);
  const exp = Number(j.accessToken.expiry) || Date.now() + 30 * 60 * 1000;
  sessions.set(userId, { token, exp });
  return token;
}
async function token(userId) {
  const c = sessions.get(userId);
  if (c && c.exp - Date.now() > 60_000) return c.token;
  return newSession(userId);
}

/** asUser: the admin user id to act as (defaults to the service user). */
export async function adminFetch(path, { method = "GET", body, headers = {}, asUser } = {}) {
  const userId = asUser || env("ADMIN_SESSION_USER_ID");
  const call = async (t) => fetch(adminBase() + path, {
    method,
    headers: { "content-type": "application/json", cookie: `sAccessToken=${t}`, "st-auth-mode": "cookie", rid: "anti-csrf", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let r = await call(await token(userId));
  if (r.status === 401) { sessions.delete(userId); r = await call(await token(userId)); }
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  return { ok: r.ok, status: r.status, json, text };
}

/** Roles SuperTokens has for a user (admin checks these: "403 invalid claim" = missing the role). */
export async function userRoles(userId) {
  for (const withCdi of [true, false]) {
    try {
      const h = { "api-key": stKey(), rid: "userroles" }; if (withCdi) h["cdi-version"] = cdi();
      const r = await fetch(`${stUri()}/recipe/user/roles?userId=${encodeURIComponent(userId)}`, { headers: h });
      if (!r.ok) continue;
      const j = await r.json().catch(() => null);
      if (j && Array.isArray(j.roles)) return j.roles;
    } catch {}
  }
  return null; // unknown
}

/** All SuperTokens users for an email (a person can have one per login method, e.g. Google + password). */
async function usersByEmail(email) {
  const e = encodeURIComponent(String(email || "").trim().toLowerCase());
  const tries = [
    { path: `/users/by-accountinfo?email=${e}`, rid: null, pick: (j) => (j?.users || []).map((u) => u.id) },
    { path: `/public/users/by-accountinfo?email=${e}`, rid: null, pick: (j) => (j?.users || []).map((u) => u.id) },
    { path: `/recipe/user?email=${e}`, rid: "emailpassword", pick: (j) => [j?.user?.id] },
    { path: `/recipe/users/by-email?email=${e}`, rid: "thirdparty", pick: (j) => (j?.users || []).map((u) => u.id) },
    { path: `/recipe/user?email=${e}`, rid: "passwordless", pick: (j) => [j?.user?.id] },
  ];
  const ids = new Set();
  for (const t of tries) {
    for (const withCdi of [true, false]) {
      try {
        const h = { "api-key": stKey() };
        if (t.rid) h.rid = t.rid;
        if (withCdi) h["cdi-version"] = cdi();
        const r = await fetch(stUri() + t.path, { headers: h });
        if (!r.ok) continue;
        (t.pick(await r.json().catch(() => null)) || []).filter(Boolean).forEach((id) => ids.add(String(id)));
        break;
      } catch {}
    }
  }
  return [...ids];
}

/** Find the admin user id for an email — when there are several logins, pick the one that has roles (the admin one). */
export async function findAdminUserId(email) {
  const ids = await usersByEmail(email);
  if (!ids.length) return null;
  if (ids.length === 1) return ids[0];
  let best = ids[0], bestN = -1;
  for (const id of ids) { const r = await userRoles(id); const n = r ? r.length : -1; if (n > bestN) { best = id; bestN = n; } }
  return best;
}

/** Can we act as this admin user? Signs in, reads one order, and lists their roles. */
export async function testAdminUser(adminUserId) {
  const roles = await userRoles(adminUserId);
  const rtxt = roles ? (roles.length ? ` · roles: ${roles.join(", ")}` : " · no roles in SuperTokens") : "";
  try {
    const r = await adminFetch("/admin/v1/orders?sortBy=number&sortDirection=desc&limit=1", { asUser: adminUserId });
    if (r.status === 401 || r.status === 403) {
      const msg = (r.json && (r.json.message || r.json.error)) || "";
      return { ok: false, note: `Admin refused this user (${r.status}${msg ? ": " + msg : ""})${rtxt}. Their admin login is missing the role admin checks. Try "link by admin email" again (picks the login with roles) or paste the ID EV-BOT shows.` };
    }
    return { ok: true, note: (r.ok ? "Signed in to admin as this user" : `Signed in (admin answered ${r.status})`) + rtxt };
  } catch (e) { return { ok: false, note: e.message + rtxt }; }
}
