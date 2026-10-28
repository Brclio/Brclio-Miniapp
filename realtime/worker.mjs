import { DurableObject } from 'cloudflare:workers';
import { verifyDuelTicket } from '../web/duel-ticket.mjs';
import { DuelHub, LIMITS } from './duel-hub.mjs';

const origins = new Set(['https://pocket.bornforthis.cn', 'https://pocket.brclio.com', 'https://servicewechat.com']);
const response = (error, status) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') return Response.json({ service: 'brclio-online-duel', protocol: 1 }, { headers: { 'Cache-Control': 'no-store' } });
    if (url.pathname !== '/connect') return response('not_found', 404);
    if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return response('websocket_required', 426);
    const origin = request.headers.get('Origin');
    if (origin && !origins.has(origin)) return response('origin_forbidden', 403);
    if (!env.DUEL_HUB || typeof env.DUEL_TICKET_SECRET !== 'string' || env.DUEL_TICKET_SECRET.length < 32) return response('duel_unavailable', 503);
    if ([...url.searchParams.keys()].some(key => key !== 'ticket') || url.searchParams.getAll('ticket').length !== 1) return response('unauthorized', 401);
    if (!(await verifyDuelTicket(url.searchParams.get('ticket'), env.DUEL_TICKET_SECRET))) return response('unauthorized', 401);
    // All users share one bounded lobby so invitations and busy state are atomic.
    return env.DUEL_HUB.get(env.DUEL_HUB.idFromName('lobby-v1')).fetch(request);
  }
};

export class DuelLobby extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx; this.env = env; this.sockets = new Map(); this.nextAlarmAt = null;
    const attachments = [];
    for (const socket of ctx.getWebSockets()) {
      try {
        const value = socket.deserializeAttachment();
        if (!value?.user?.id) { socket.close(1008, 'invalid_attachment'); continue; }
        this.sockets.set(value.user.id, socket); attachments.push(value);
      } catch { try { socket.close(1011, 'state_unavailable'); } catch {} }
    }
    this.hub = new DuelHub({ send: (userId, value) => {
      try { this.sockets.get(userId)?.send(JSON.stringify(value)); } catch { /* close event/alarm performs cleanup */ }
    } });
    this.hub.restore(attachments);
    ctx.blockConcurrencyWhile(async () => {
      const records = await ctx.storage.list({ prefix: 'invite-code:', limit: LIMITS.codeCapacity + 1 });
      this.nextAlarmAt = await ctx.storage.getAlarm();
      this.hub.restoreCodes(records.values());
      this.hub.tick();
      await this.persist();
    });
  }
  async fetch(request) {
    const ticket = await verifyDuelTicket(new URL(request.url).searchParams.get('ticket'), this.env.DUEL_TICKET_SECRET);
    if (!ticket) return response('unauthorized', 401);
    this.hub.tick();
    if (!this.hub.users.has(ticket.user.id) && this.hub.users.size >= LIMITS.capacity) return response('lobby_full', 503);
    const existing = this.sockets.get(ticket.user.id);
    if (existing) {
      // A second device cannot press buttons in the first device's room.
      this.hub.disconnect(ticket.user.id); this.sockets.delete(ticket.user.id);
      try { existing.close(4001, 'account_opened_elsewhere'); } catch {}
    }
    const pair = new WebSocketPair(), [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    this.sockets.set(ticket.user.id, server);
    this.hub.connect(ticket.user, ticket.nonce);
    await this.persist();
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(socket, payload) {
    const userId = this.userId(socket);
    if (!userId) { try { socket.close(1008, 'session_ended'); } catch {} return; }
    if (typeof payload !== 'string' || payload.length > 4096) { await this.drop(socket, userId, 1009, 'message_too_large'); return; }
    let value;
    try { value = JSON.parse(payload); } catch { this.hub.error(userId, 'invalid_json', '请求格式错误。'); return; }
    this.hub.receive(userId, value);
    await this.persist();
  }
  async webSocketClose(socket) { const id = this.userId(socket); if (id) await this.drop(socket, id); }
  async webSocketError(socket) { const id = this.userId(socket); if (id) await this.drop(socket, id, 1011, 'connection_error'); }
  userId(socket) {
    try { const id = socket.deserializeAttachment()?.user?.id; return this.sockets.get(id) === socket ? id : null; } catch { return null; }
  }
  async drop(socket, userId, code = 1000, reason = 'closed') {
    this.hub.disconnect(userId); this.sockets.delete(userId);
    try { socket.close(code, reason); } catch {}
    await this.persist();
  }
  async alarm() { this.nextAlarmAt = null; this.hub.tick(); await this.persist(); }
  async persist() {
    // Connection attachments survive hibernation and disappear with sockets.
    // Presence and game state stay in attachments. Only explicit short-lived
    // share reservations below are written into DO KV; no match history is.
    for (const [id, socket] of this.sockets) {
      const attachment = this.hub.attachment(id);
      if (attachment) socket.serializeAttachment(attachment);
      else { this.sockets.delete(id); try { socket.close(4000, 'heartbeat_timeout'); } catch {} }
    }
    // Only changed share reservations touch storage. Presence heartbeats and
    // taps never rewrite the code registry. Each bounded record is independent
    // of sockets, so opening WeChat's share sheet cannot erase the invitation.
    const changes = [...this.hub.codeChanges];
    const writes = changes.filter(([, value]) => value !== null);
    const removals = changes.filter(([, value]) => value === null);
    if (writes.length) await this.ctx.storage.put(Object.fromEntries(writes.map(([code, value]) => ['invite-code:' + code, value])));
    if (removals.length) await this.ctx.storage.delete(removals.map(([code]) => 'invite-code:' + code));
    for (const [code, value] of changes) if (this.hub.codeChanges.get(code) === value) this.hub.codeChanges.delete(code);
    const deadline = this.hub.nextDeadline();
    if (deadline === null) {
      if (this.nextAlarmAt !== null) { await this.ctx.storage.deleteAlarm(); this.nextAlarmAt = null; }
    } else if (this.nextAlarmAt === null || deadline < this.nextAlarmAt) {
      const at = Math.max(Date.now() + 1, deadline);
      await this.ctx.storage.setAlarm(at); this.nextAlarmAt = at;
    }
    // Keep an already earlier alarm instead of postponing it after every ping.
    // It will wake once, check current liveness, then schedule the next deadline.
  }
}
