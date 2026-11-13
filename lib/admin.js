// Admin writes use the same SuperTokens service session as ev-bot / MP BOT:
// a session is created for ADMIN_SESSION_USER_ID, then admin is called with it as a cookie.
import { env, adminBase } from "./env.js";

let cached = null; // { token, exp }

async function newSession() {
  const uri = env("SUPERTOKENS_CONNECTION_URI").replace(/\/$/, "");
  const key = env("SUPERTOKENS_API_KEY");
  const userId = env("ADMIN_SESSION_USER_ID");
  if (!uri || !key || !userId) throw new Error("Missing SUPERTOKENS_CONNECTION_URI, SUPERTOKENS_API_KEY or ADMIN_SESSION_USER_ID.");
  const r = await fetch(`${uri}/recipe/session`, {
    method: "POST",
    headers: { "content-type": "application/json", "api-key": key, rid: "session", "cdi-version": env("SUPERTOKENS_CDI_VERSION", "2.21") },
    body: JSON.stringify({ userId, userDataInJWT: {}, userDataInDatabase: {}, enableAntiCsrf: false, useDynamicSigningKey: true }),
  });
  const j = await r.json().catch(() => ({}));
  const token = j?.accessToken?.token;
  if (!r.ok || !token) throw new Error(`Admin sign-in failed (${r.status}).`);
  const exp = Number(j.accessToken.expiry) || Date.now() + 30 * 60 * 1000;
  cached = { token, exp };
  return token;
}

async function token() {
  if (cached && cached.exp - Date.now() > 60_000) return cached.token;
  return newSession();
}

export async function adminFetch(path, { method = "GET", body, headers = {} } = {}) {
  const base = adminBase();
  const call = async (t) => fetch(base + path, {
    method,
    headers: { "content-type": "application/json", cookie: `sAccessToken=${t}`, "st-auth-mode": "cookie", rid: "anti-csrf", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let r = await call(await token());
  if (r.status === 401) { cached = null; r = await call(await token()); }
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  return { ok: r.ok, status: r.status, json, text };
}
