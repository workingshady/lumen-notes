import type { Hono } from "hono";
import type { Env, Helpers } from "../index";

type RemoteEnv = { REMOTE?: DurableObjectNamespace };
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
const CODE = /^[A-HJKMNP-Z2-9]{8}$/;
const remoteKey = (h: Helpers, secret: string, code: string) => h.hmac(secret, "lumen:remote:v1:" + code);

/** API routes for the "study" area. Mounted under /api. */
export default function register(api: Hono<Env>, h: Helpers) {
  // Open a phone-remote room for the slides presenter (owner only). The code is shown as text + QR.
  api.post("/remote", h.auth, async (c) => {
    if (!(c.env as unknown as RemoteEnv).REMOTE) return c.json({ error: "Remote not configured" }, 501);
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const code = [...bytes].map((b) => ALPHA[b % ALPHA.length]).join("");
    return c.json({ code, key: await remoteKey(h, c.env.APP_PASSCODE, code) });
  });

  // WebSocket into the room. The presenter proves it opened the room with `key`; a phone only needs the code.
  api.get("/remote/:code/ws", async (c) => {
    const ns = (c.env as unknown as RemoteEnv).REMOTE;
    if (!ns) return c.json({ error: "Remote not configured" }, 501);
    const code = c.req.param("code").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!CODE.test(code)) return c.json({ error: "Bad code" }, 400);
    const url = new URL(c.req.url);
    const presenter = url.searchParams.get("role") === "presenter";
    if (presenter && !h.safeEqual(url.searchParams.get("key") ?? "", await remoteKey(h, c.env.APP_PASSCODE, code))) return c.json({ error: "Unauthorized" }, 401);
    const fwd = new URL(c.req.url);
    fwd.search = presenter ? "?role=presenter" : "?role=remote";
    // Without an Upgrade header the room answers { open } (used by the phone before it connects).
    return ns.get(ns.idFromName(code)).fetch(new Request(fwd.href, c.req.raw));
  });
}
