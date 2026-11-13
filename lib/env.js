export const env = (k, d = "") => (process.env[k] ?? d).toString().trim();
export const isDryRun = () => env("DRY_RUN", "true").toLowerCase() !== "false";
export const maxQty = () => Math.max(1, Math.min(200, parseInt(env("MAX_ORDERS_PER_RUN", "50"), 10) || 50));
export const createPath = () => env("ORDER_CREATE_PATH", "/admin/v1/orders/submission");
export const createReady = () => !!createPath();
export const adminBase = () => env("ADMIN_API_BASE", "https://admin-api.arenaclub.com").replace(/\/$/, "");
