import { send } from "../lib/http.js";
import { env, isDryRun, maxQty, createReady, adminBase } from "../lib/env.js";
import { currentUser } from "../lib/auth.js";
import { orderTypes } from "../lib/payload.js";
import { countUsers } from "../lib/users.js";

export default async function handler(req, res) {
  const me = await currentUser(req);
  let needsSetup = false;
  try { needsSetup = (await countUsers()) === 0; } catch {}
  send(res, 200, {
    who: me ? me.name : null,
    me: me ? { id: me.id, name: me.name, email: me.email, role: me.role } : null,
    needsSetup,
    dryRunForced: isDryRun(),
    createReady: createReady(),
    template: !!env("ORDER_BODY_TEMPLATE"),
    logging: !!env("DATABASE_URL"),
    poLookup: !!(env("METABASE_HOST") && env("METABASE_API_KEY")),
    maxQty: maxQty(),
    adminHost: adminBase().replace(/^https?:\/\//, ""),
    orderTypes: orderTypes(),
  });
}
