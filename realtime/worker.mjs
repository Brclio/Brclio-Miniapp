import { DurableObject } from 'cloudflare:workers';
import { verifyDuelTicket } from '../web/duel-ticket.mjs';
import { DuelHub, LIMITS } from './duel-hub.mjs';
import { createInviteStore } from './invite-store.mjs';

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
    this.invites = createInviteStore(env); this.codeTail = Promise.resolve(); this.buffers = new Map(); this.pendingLobby = false; this.checkedCodeSources = new Set();
    const attachments = [];
    for (const socket of ctx.getWebSockets()) {
      try {
        const value = socket.deserializeAttachment();
        if (!value?.user?.id) { socket.close(1008, 'invalid_attachment'); continue; }
        this.sockets.set(value.user.id, socket); attachments.push(value);
      } catch { try { socket.close(1011, 'state_unavailable'); } catch {} }
    }
    this.hub = new DuelHub({ send: (userId, value) => {
      if (value.type === 'lobby' && this.buffers.size) { this.pendingLobby = true; return; }
      if (this.buffers.has(userId) && value.type !== 'pong') { this.buffers.get(userId).push(value); return; }
      try { this.sockets.get(userId)?.send(JSON.stringify(value)); } catch { /* close event/alarm performs cleanup */ }
    } });
    this.hub.restore(attachments);
    ctx.blockConcurrencyWhile(async () => {
      await this.migrateLegacy();
      this.nextAlarmAt = await ctx.storage.getAlarm();
      this.hub.restoreCodes([...this.hub.codeInvites.values()]);
      this.hub.tick();
      await this.persist();
    });
  }
  async fetch(request) {
    const ticket = await verifyDuelTicket(new URL(request.url).searchParams.get('ticket'), this.env.DUEL_TICKET_SECRET);
    if (!ticket) return response('unauthorized', 401);
    return this.enqueue(async () => {
      try {
        const reservation = await this.invites.readUser(ticket.user.id);
        const cached = this.hub.codeFor(ticket.user.id);
        if (cached && !reservation) this.hub.codeInvites.delete(cached.code);
        this.hub.tick();
        if (!this.hub.users.has(ticket.user.id) && this.hub.users.size >= LIMITS.capacity) return response('lobby_full', 503);
        if (reservation && reservation.expiresAt > Date.now()) { this.hub.codeInvites.set(reservation.code, reservation); this.checkedCodeSources.add(reservation.code); }
        const existing = this.sockets.get(ticket.user.id);
        if (existing) {
          this.hub.disconnect(ticket.user.id); this.sockets.delete(ticket.user.id);
          try { existing.close(4001, 'account_opened_elsewhere'); } catch {}
        }
        const pair = new WebSocketPair(), [client, server] = Object.values(pair);
        this.ctx.acceptWebSocket(server); this.sockets.set(ticket.user.id, server);
        this.hub.connect(ticket.user, ticket.nonce);
        await this.persist();
        return new Response(null, { status: 101, webSocket: client });
      } catch { return response('invite_store_unavailable', 503); }
    });
  }
  async webSocketMessage(socket, payload) {
    const userId = this.userId(socket);
    if (!userId) { try { socket.close(1008, 'session_ended'); } catch {} return; }
    if (typeof payload !== 'string' || payload.length > 4096) { await this.drop(socket, userId, 1009, 'message_too_large'); return; }
    let value;
    try { value = JSON.parse(payload); } catch { this.hub.error(userId, 'invalid_json', '请求格式错误。'); return; }
    const room = this.hub.rooms.get(this.hub.users.get(userId)?.roomId);
    const shared = this.hub.codeFor(userId);
    const durable = ['create_code', 'join_code', 'cancel_code'].includes(value?.type) || value?.type === 'leave' && shared || value?.type === 'ready' && room?.shareCode;
    if (durable || this.buffers.has(userId) && !['ping', 'probe_ack'].includes(value?.type)) {
      await this.enqueue(() => this.shareAction(userId, value));
    } else { this.hub.receive(userId, value); await this.persist(); }
  }
  async webSocketClose(socket) { const id = this.userId(socket); if (id) await this.enqueue(() => this.drop(socket, id)); }
  async webSocketError(socket) { const id = this.userId(socket); if (id) await this.enqueue(() => this.drop(socket, id, 1011, 'connection_error')); }
  userId(socket) {
    try { const id = socket.deserializeAttachment()?.user?.id; return this.sockets.get(id) === socket ? id : null; } catch { return null; }
  }
  async drop(socket, userId, code = 1000, reason = 'closed') {
    this.hub.disconnect(userId); this.sockets.delete(userId);
    try { socket.close(code, reason); } catch {}
    await this.persist();
  }
  async alarm() { this.nextAlarmAt = null; this.hub.tick(); await this.persist(); }
  enqueue(callback) {
    const task = this.codeTail.then(callback, callback); this.codeTail = task.then(() => {}, () => {}); return task;
  }
  async migrateLegacy() {
    // One-time drain of the briefly deployed previous storage layout. Never
    // delete the last valid copy before its private GitHub commit succeeds.
    const legacy = await this.ctx.storage.list({ prefix: 'invite-code:', limit: LIMITS.codeCapacity + 1 });
    if (!legacy.size) return;
    const valid = [...legacy.values()].filter(value => value && /^[A-HJ-NP-Z2-9]{8}$/.test(value.code) && value.expiresAt > Date.now());
    for (let start = 0; start < valid.length; start += 20) await this.invites.apply(valid.slice(start, start + 20).map(value => [value.code, value]));
    await this.ctx.storage.delete([...legacy.keys()]);
  }
  async shareAction(userId, value) {
    if (!this.hub.users.has(userId)) return;
    const activeRoom = this.hub.rooms.get(this.hub.users.get(userId)?.roomId);
    if (['create_code', 'join_code', 'cancel_code'].includes(value.type) && activeRoom && ['arming', 'scheduled'].includes(activeRoom.phase)) {
      this.hub.error(userId, 'user_busy', '请先完成当前对局。'); return;
    }
    let loaded;
    let checkedCode = null;
    try {
      this.checkedCodeSources ||= new Set();
      if (value.type === 'join_code' && /^[A-HJ-NP-Z2-9]{8}$/.test(value.code)) { checkedCode = value.code; loaded = await this.invites.readCode(value.code); }
      else if (value.type === 'create_code') loaded = await this.invites.readUser(userId);
      else {
        const cached = this.hub.codeFor(userId);
        if (cached && !this.checkedCodeSources.has(cached.code)) { checkedCode = cached.code; loaded = await this.invites.readCode(cached.code); }
      }
      if (loaded) this.checkedCodeSources.add(loaded.code);
    } catch { this.hub.error(userId, 'invite_store_unavailable', '邀请暂时无法保存或读取，请稍后重试。'); return; }
    if (!loaded && checkedCode) {
      const cached = this.hub.codeInvites.get(checkedCode);
      this.hub.codeInvites.delete(checkedCode); this.hub.codeChanges.delete(checkedCode); this.checkedCodeSources.delete(checkedCode);
      for (const entry of this.hub.rooms.values()) if (entry.shareCode === checkedCode && entry.phase === 'ready') entry.shareCode = null;
      if (cached) this.hub.codeStates(cached);
      if (value.type === 'join_code') { this.hub.error(userId, 'code_expired', '邀请码不存在或已过期，请对方重新分享。'); return; }
    }
    const own = this.hub.codeFor(userId);
    const ids = new Set([userId, ...(loaded ? [loaded.owner.id, loaded.guest?.id] : []), ...(own ? [own.owner.id, own.guest?.id] : [])].filter(Boolean));
    const room = this.hub.rooms.get(this.hub.users.get(userId)?.roomId);
    if (room) for (const player of room.players) ids.add(player.id);
    const codes = new Set([own?.code, loaded?.code, room?.shareCode].filter(Boolean));
    const beforeCodes = new Map([...codes].map(code => [code, structuredClone(this.hub.codeInvites.get(code) || null)]));
    const beforeRooms = new Map([...this.hub.rooms].filter(([, entry]) => entry.players.some(player => ids.has(player.id))).map(([id, entry]) => [id, structuredClone(entry)]));
    const beforeUsers = new Map([...ids].map(id => [id, this.hub.users.get(id)?.roomId || null]));
    const beforeChanges = new Map([...codes].map(code => [code, this.hub.codeChanges.get(code)]));
    for (const id of ids) this.buffers.set(id, []);
    try {
      if (loaded && loaded.expiresAt > Date.now() && !this.hub.codeInvites.has(loaded.code)) {
        this.hub.codeInvites.set(loaded.code, loaded); this.hub.pairCode(loaded);
      }
      // Delete the persistent reservation before scheduling a live round. GitHub
      // latency therefore never consumes the two-second arming window.
      const currentRoom = this.hub.rooms.get(this.hub.users.get(userId)?.roomId);
      let preConsumed = null;
      if (value.type === 'ready' && currentRoom?.shareCode && currentRoom.ready.some(id => id !== userId)) {
        preConsumed = this.hub.codeInvites.get(currentRoom.shareCode);
        if (preConsumed) await this.invites.apply([[preConsumed.code, null]]);
      }
      this.hub.receive(userId, value);
      const current = this.hub.codeFor(userId); if (current) codes.add(current.code);
      const changes = [...codes].filter(code => this.hub.codeChanges.has(code) && this.hub.codeChanges.get(code) !== beforeChanges.get(code)).map(code => [code, this.hub.codeChanges.get(code)]);
      const toSave = changes.filter(([code, entry]) => !(preConsumed?.code === code && entry === null));
      // If measurements expired while waiting for GitHub, keep the invitation
      // durable and ask the users to prepare again rather than losing it.
      if (preConsumed && this.hub.codeInvites.has(preConsumed.code)) toSave.push([preConsumed.code, this.hub.codeInvites.get(preConsumed.code)]);
      if (toSave.length) await this.invites.apply(toSave);
      for (const code of codes) this.hub.codeChanges.delete(code);
      const messages = [...this.buffers]; for (const id of ids) this.buffers.delete(id);
      for (const [id, pending] of messages) {
        for (const message of pending) if (!['state', 'lobby'].includes(message.type)) {
          try { this.sockets.get(id)?.send(JSON.stringify({ ...message, serverAt: Date.now() })); } catch {}
        }
        this.hub.emitState(id);
      }
      if (this.pendingLobby) { this.pendingLobby = false; this.hub.lobby(); }
      await this.persist();
    } catch {
      // Only these pre-game participants are rolled back. Other rooms' pings,
      // clicks and outcomes continue while GitHub processes this transaction.
      for (const [id, entry] of [...this.hub.rooms]) if (entry.players.some(player => ids.has(player.id))) this.hub.rooms.delete(id);
      for (const [id, entry] of beforeRooms) this.hub.rooms.set(id, entry);
      for (const [id, roomId] of beforeUsers) { const entry = this.hub.users.get(id); if (entry) entry.roomId = roomId; }
      for (const code of codes) {
        const prior = beforeCodes.get(code); if (prior) this.hub.codeInvites.set(code, prior); else this.hub.codeInvites.delete(code);
        const change = beforeChanges.get(code); if (change === undefined) this.hub.codeChanges.delete(code); else this.hub.codeChanges.set(code, change);
      }
      // A GitHub reference update may have succeeded even if its response was
      // lost. Re-read the authoritative user index before presenting recovery.
      let authoritative = null;
      try { authoritative = await this.invites.readUser(userId); } catch {}
      for (const code of codes) {
        if (authoritative?.code === code) continue;
        this.hub.codeInvites.delete(code); this.hub.codeChanges.delete(code); this.checkedCodeSources?.delete(code);
        for (const entry of this.hub.rooms.values()) if (entry.shareCode === code && entry.phase === 'ready') entry.shareCode = null;
      }
      if (authoritative) {
        const existingRoom = [...this.hub.rooms.values()].find(entry => entry.shareCode === authoritative.code && entry.phase === 'ready');
        authoritative.roomId = existingRoom?.id || null; this.hub.codeInvites.set(authoritative.code, authoritative); this.hub.pairCode(authoritative);
      }
      for (const id of ids) this.buffers.delete(id);
      this.pendingLobby = false; this.hub.lobby();
      this.hub.error(userId, 'invite_store_unavailable', '邀请暂时无法保存，请稍后重试。');
      for (const id of ids) this.hub.emitState(id);
      await this.persist();
    }
  }
  async persist() {
    // Connection attachments survive hibernation and disappear with sockets.
    // Presence, game state and pending-code snapshots stay in attachments only.
    // Persistent share reservations live in the existing private GitHub repo.
    for (const [id, socket] of this.sockets) {
      if (this.buffers.has(id)) continue;
      const attachment = this.hub.attachment(id);
      if (attachment) socket.serializeAttachment(attachment);
      else { this.sockets.delete(id); try { socket.close(4000, 'heartbeat_timeout'); } catch {} }
    }
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
