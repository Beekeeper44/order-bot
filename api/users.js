// Admins: GET list · POST {action:"add", name, email, role} · POST {action:"update", id, role?, active?, name?}
//         POST {action:"link", id}  (new invite / password-reset link) · POST {action:"remove", id}
//         POST {action:"adminlink", id, admin_user_id?, admin_email?}  link to their Arena admin user
//              (blank id → look it up by admin_email, else by their ORDER-BOT email; "" + clear:true unlinks)
//         POST {action:"admintest", id}  sign in to admin as them and read one order
// Everyone: POST {action:"password", current, password}
import { send, readJson } from "../lib/http.js";
import { currentUser, makeCookie } from "../lib/auth.js";
import { findAdminUserId, testAdminUser } from "../lib/admin.js";
import { listUsers, createUser, newInvite, updateUser, removeUser, setAdminLink, userByEmail, userById, setPassword, checkPassword, activeAdmins, cleanEmail, okEmail, okPassword, publicUser } from "../lib/users.js";

const origin = (req) => `${req.headers["x-forwarded-proto"] || "https"}://${req.headers["x-forwarded-host"] || req.headers.host}`;

export default async function handler(req, res) {
  try {
    const me = await currentUser(req);
    if (!me) return send(res, 401, { error: "Sign in first." });
    const b = req.method === "POST" ? await readJson(req).catch(() => ({})) : {};

    if (b.action === "password") {
      if (!checkPassword(b.current, me.pw_hash)) return send(res, 400, { error: "Current password is wrong." });
      if (!okPassword(b.password)) return send(res, 400, { error: "New password must be at least 10 characters." });
      const u = await setPassword(me.id, b.password);
      res.setHeader("set-cookie", makeCookie(u)); return send(res, 200, { ok: true });
    }

    if (me.role !== "admin") return send(res, 403, { error: "Only admins can manage users." });
    if (req.method === "GET") return send(res, 200, { users: await listUsers(), me: me.id });

    if (b.action === "add") {
      const email = cleanEmail(b.email), name = String(b.name || "").trim();
      if (!name || !okEmail(email)) return send(res, 400, { error: "Enter a name and a valid work email." });
      if (await userByEmail(email)) return send(res, 409, { error: "That email already has an account." });
      const id = await createUser({ name, email, role: b.role }, me.name);
      // link to their Arena admin user: pasted id, else found from email
      let adminId = String(b.admin_user_id || "").trim();
      if (!adminId) { try { adminId = (await findAdminUserId(email)) || ""; } catch {} }
      if (adminId) await setAdminLink(id, adminId, email);
      const token = await newInvite(id);
      return send(res, 200, { ok: true, user: publicUser(await userById(id)), link: `${origin(req)}/?invite=${token}` });
    }
    if (b.action === "link") {
      const u = await userById(String(b.id || "")); if (!u) return send(res, 404, { error: "No such user." });
      const token = await newInvite(u.id);
      return send(res, 200, { ok: true, link: `${origin(req)}/?invite=${token}` });
    }
    if (b.action === "update") {
      const u = await userById(String(b.id || "")); if (!u) return send(res, 404, { error: "No such user." });
      const role = b.role === "admin" || b.role === "member" ? b.role : undefined;
      const active = typeof b.active === "boolean" ? b.active : undefined;
      const losingAdmin = u.role === "admin" && u.active && (role === "member" || active === false);
      if (losingAdmin && (await activeAdmins()) <= 1) return send(res, 400, { error: "Keep at least one active admin." });
      if (u.id === me.id && active === false) return send(res, 400, { error: "You can't turn yourself off." });
      return send(res, 200, { ok: true, user: publicUser(await updateUser(u.id, { role, active, name: b.name ? String(b.name).trim() : undefined })) });
    }
    if (b.action === "adminlink") {
      const u = await userById(String(b.id || "")); if (!u) return send(res, 404, { error: "No such user." });
      if (b.clear) return send(res, 200, { ok: true, user: publicUser(await setAdminLink(u.id, null, null)) });
      const adminEmail = cleanEmail(b.admin_email || u.admin_email || u.email);
      let adminId = String(b.admin_user_id || "").trim();
      if (!adminId) adminId = (await findAdminUserId(adminEmail)) || "";
      if (!adminId) return send(res, 404, { error: `No Arena admin login found for ${adminEmail}. Paste their admin user ID instead.` });
      if (!/^[\w-]{6,80}$/.test(adminId)) return send(res, 400, { error: "That doesn't look like an admin user ID." });
      const t = await testAdminUser(adminId);
      const nu = await setAdminLink(u.id, adminId, b.admin_user_id ? (b.admin_email ? adminEmail : u.admin_email || null) : adminEmail);
      return send(res, 200, { ok: true, user: publicUser(nu), test: t });
    }
    if (b.action === "admintest") {
      const u = await userById(String(b.id || "")); if (!u) return send(res, 404, { error: "No such user." });
      if (!u.admin_user_id) return send(res, 400, { error: "Not linked to an admin user yet." });
      return send(res, 200, { ok: true, test: await testAdminUser(u.admin_user_id) });
    }
    if (b.action === "remove") {
      const u = await userById(String(b.id || "")); if (!u) return send(res, 404, { error: "No such user." });
      if (u.id === me.id) return send(res, 400, { error: "You can't remove yourself." });
      if (u.role === "admin" && u.active && (await activeAdmins()) <= 1) return send(res, 400, { error: "Keep at least one active admin." });
      await removeUser(u.id);
      return send(res, 200, { ok: true });
    }
    send(res, 400, { error: "Unknown action." });
  } catch (e) { send(res, 500, { error: e.message }); }
}
