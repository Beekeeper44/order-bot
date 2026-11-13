// POST {action:"login", email, password}      sign in
// POST {action:"setup", name, email, password, code}   first admin (only when no users; code = SETUP_CODE)
// GET  ?invite=<token>                          who the invite is for
// POST {action:"invite", token, password}       accept invite / reset → signed in
// DELETE                                        sign out
import { send, readJson } from "../lib/http.js";
import { env } from "../lib/env.js";
import { makeCookie, clearCookie } from "../lib/auth.js";
import { userByEmail, checkPassword, touchSignIn, countUsers, createUser, userById, userByInvite, setPassword, cleanEmail, okEmail, okPassword } from "../lib/users.js";

const me = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

export default async function handler(req, res) {
  try {
    if (req.method === "DELETE") { res.setHeader("set-cookie", clearCookie()); return send(res, 200, { ok: true }); }
    if (req.method === "GET") {
      const token = new URL(req.url, "http://x").searchParams.get("invite") || "";
      const u = token && await userByInvite(token);
      return u ? send(res, 200, { name: u.name, email: u.email, reset: !!u.pw_hash }) : send(res, 404, { error: "This link has expired or was already used. Ask an admin for a new one." });
    }
    if (req.method !== "POST") return send(res, 405, { error: "POST only" });
    const b = await readJson(req).catch(() => ({}));

    if (b.action === "setup") {
      if ((await countUsers()) > 0) return send(res, 409, { error: "Setup is already done. Sign in instead." });
      if (!env("SETUP_CODE") || b.code !== env("SETUP_CODE")) return send(res, 401, { error: "Wrong setup code (SETUP_CODE in Vercel)." });
      const email = cleanEmail(b.email);
      if (!String(b.name || "").trim() || !okEmail(email)) return send(res, 400, { error: "Enter your name and work email." });
      if (!okPassword(b.password)) return send(res, 400, { error: "Password must be at least 10 characters." });
      const id = await createUser({ name: b.name, email, role: "admin", password: b.password });
      const u = await userById(id); await touchSignIn(id);
      res.setHeader("set-cookie", makeCookie(u)); return send(res, 200, { ok: true, me: me(u) });
    }
    if (b.action === "invite") {
      const u = await userByInvite(String(b.token || ""));
      if (!u) return send(res, 404, { error: "This link has expired or was already used. Ask an admin for a new one." });
      if (!okPassword(b.password)) return send(res, 400, { error: "Password must be at least 10 characters." });
      const nu = await setPassword(u.id, b.password); await touchSignIn(u.id);
      res.setHeader("set-cookie", makeCookie(nu)); return send(res, 200, { ok: true, me: me(nu) });
    }
    // login
    const u = await userByEmail(b.email);
    if (!u || !u.active || !checkPassword(b.password, u.pw_hash)) return send(res, 401, { error: "Wrong email or password." });
    await touchSignIn(u.id);
    res.setHeader("set-cookie", makeCookie(u)); send(res, 200, { ok: true, me: me(u) });
  } catch (e) { send(res, 500, { error: e.message }); }
}
