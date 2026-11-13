import { DurableObject } from "cloudflare:workers";

/**
 * Phone-as-remote for slides. One Durable Object per pairing code (SQLite-backed, free plan).
 * Uses the WebSocket Hibernation API, so an idle room costs nothing while sockets stay open.
 *
 * Sockets are tagged "p" (presenter, the desktop deck) or "r" (remote, the phone).
 * presenter → { type: "state", ... }   stored + broadcast to remotes
 * remote    → { type: "cmd", cmd, i? } forwarded to presenters
 * server    → { type: "peers", presenters, remotes } on every join/leave
 */
const TTL = 12 * 3600_000; // rooms are wiped 12 h after the last activity

export class SlidesRemote extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    // Keep-alive pings are answered without waking the object from hibernation.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));
  }

  async fetch(req: Request): Promise<Response> {
    const state = await this.ctx.storage.get<string>("state");
    // Plain GET = "is this room open?" (lets the phone show a clear error before connecting).
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return Response.json({ open: !!state || this.ctx.getWebSockets("p").length > 0 });
    const role = new URL(req.url).searchParams.get("role") === "presenter" ? "p" : "r";
    // A phone can only join a room a presenter has opened.
    if (role === "r" && !state && !this.ctx.getWebSockets("p").length) return new Response(JSON.stringify({ error: "No presentation with this code" }), { status: 404, headers: { "content-type": "application/json" } });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [role]);
    if (role === "r" && state) pair[1].send(state);
    await this.touch();
    this.peers();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string" || raw.length > 64_000) return;
    let msg: { type?: string };
    try { msg = JSON.parse(raw); } catch { return; }
    const role = this.ctx.getTags(ws)[0];
    if (role === "p" && msg.type === "state") {
      await this.ctx.storage.put("state", raw);
      for (const r of this.ctx.getWebSockets("r")) try { r.send(raw); } catch { /* closed */ }
    } else if (role === "r" && msg.type === "cmd") {
      for (const p of this.ctx.getWebSockets("p")) try { p.send(raw); } catch { /* closed */ }
    }
    await this.touch();
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, "bye"); } catch { /* already closed */ }
    this.peers(ws);
  }
  async webSocketError(ws: WebSocket) { this.peers(ws); }

  async alarm() {
    const last = (await this.ctx.storage.get<number>("last")) ?? 0;
    if (Date.now() - last < TTL) { await this.ctx.storage.setAlarm(last + TTL); return; }
    for (const ws of this.ctx.getWebSockets()) try { ws.close(1000, "expired"); } catch { /* ignore */ }
    await this.ctx.storage.deleteAll();
  }

  private async touch() {
    const now = Date.now();
    await this.ctx.storage.put("last", now);
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(now + TTL);
  }

  private peers(gone?: WebSocket) {
    const live = (tag: string) => this.ctx.getWebSockets(tag).filter((w) => w !== gone && w.readyState === 1);
    const p = live("p"), r = live("r");
    const msg = JSON.stringify({ type: "peers", presenters: p.length, remotes: r.length });
    for (const ws of [...p, ...r]) try { ws.send(msg); } catch { /* closed */ }
  }
}
