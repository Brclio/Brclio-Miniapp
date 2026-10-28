// Pure authoritative rules. Transport and Cloudflare lifetime handling live in
// worker.mjs; tests drive this engine with two independent clients and a clock.
export const LIMITS = Object.freeze({ capacity: 100, invitationMs: 30000, codeMs: 600000, codeCapacity: 500, staleMs: 35000, activeStaleMs: 3000, startBufferMs: 2000, armMarginMs: 300, reactionMs: 5000, settleMs: 500, tieMs: 20, probeAgeMs: 15000 });
const copy = value => value == null ? value : structuredClone(value);
const message = (code, text) => ({ type: 'error', code, message: text });
const CODE = /^[A-HJ-NP-Z2-9]{8}$/;
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const randomCode = () => [...crypto.getRandomValues(new Uint8Array(8))].map(value => alphabet[value & 31]).join('');

export class DuelHub {
  constructor({ now = Date.now, random = Math.random, id = () => crypto.randomUUID(), code = randomCode, send = () => {} } = {}) {
    this.now = now; this.random = random; this.id = id; this.code = code; this.send = send;
    this.users = new Map(); this.invitations = new Map(); this.rooms = new Map();
    this.codeInvites = new Map(); this.codeChanges = new Map();
  }
  restoreCodes(records) {
    for (const value of records) {
      if (!value || !CODE.test(value.code) || !value.owner?.id || !Number.isFinite(value.expiresAt)) continue;
      if (value.expiresAt <= this.now()) { this.codeChanges.set(value.code, null); continue; }
      this.codeInvites.set(value.code, copy(value));
    }
    for (const invitation of this.codeInvites.values()) this.pairCode(invitation);
  }
  restore(attachments) {
    for (const attachment of attachments) {
      if (!attachment?.user?.id || !Number.isFinite(attachment.lastSeen)) continue;
      const { invitation, room, shareReservation, ...entry } = copy(attachment);
      this.users.set(entry.user.id, entry);
      if (invitation) this.invitations.set(invitation.id, invitation);
      if (room) this.rooms.set(room.id, room);
      if (shareReservation) this.codeInvites.set(shareReservation.code, shareReservation);
    }
    // Missing peers on reactivation invalidate the round instead of awarding a win.
    for (const room of this.rooms.values()) {
      if (room.players.some(player => !this.users.has(player.id))) this.abort(room, '对方已离线，本轮不计胜负。');
    }
  }
  attachment(userId) {
    const entry = this.users.get(userId); if (!entry) return null;
    return copy({ ...entry, invitation: this.invitationFor(userId), shareReservation: this.codeFor(userId), room: this.rooms.get(entry.roomId) || null });
  }
  emit(userId, value) { this.send(userId, { ...copy(value), serverAt: this.now() }); }
  error(userId, code, text) { this.emit(userId, message(code, text)); }
  invitationFor(userId) { return [...this.invitations.values()].find(invitation => invitation.from.id === userId || invitation.to.id === userId) || null; }
  codeFor(userId) { return [...this.codeInvites.values()].find(invitation => invitation.owner.id === userId || invitation.guest?.id === userId) || null; }
  codeState(invitation) {
    const room = this.rooms.get(invitation?.roomId);
    return invitation ? { code: invitation.code, owner: invitation.owner, guest: invitation.guest, expiresAt: invitation.expiresAt,
      status: room?.phase === 'ready' && room.players.every(player => this.users.has(player.id)) ? 'paired' : 'waiting',
      ownerOnline: this.users.has(invitation.owner.id), guestOnline: !!invitation.guest && this.users.has(invitation.guest.id) } : null;
  }
  markCode(invitation) { this.codeChanges.set(invitation.code, copy(invitation)); }
  removeCode(invitation) { this.codeInvites.delete(invitation.code); this.codeChanges.set(invitation.code, null); }
  codeStates(invitation) { this.emitState(invitation.owner.id); if (invitation.guest) this.emitState(invitation.guest.id); }
  busy(userId) { const user = this.users.get(userId); return !!(user?.roomId || this.invitationFor(userId) || this.codeFor(userId)); }
  state(userId) {
    const entry = this.users.get(userId), room = this.rooms.get(entry?.roomId);
    // Never expose another client's unreconciled touch or timing proofs.
    const publicRoom = room ? { id: room.id, players: room.players, phase: room.phase, ready: room.ready, roundId: room.roundId || null,
      startAt: room.startAt || null, signalAt: room.signalAt || null, result: room.result || null } : null;
    return { type: 'state', room: copy(publicRoom), invitation: copy(this.invitationFor(userId)), shareInvite: copy(this.codeState(this.codeFor(userId))) };
  }
  emitState(userId) { if (this.users.has(userId)) this.emit(userId, this.state(userId)); }
  roomState(room) { room.players.forEach(player => this.emitState(player.id)); }
  lobby() {
    const users = [...this.users.values()].map(entry => ({ ...entry.user, status: this.busy(entry.user.id) ? 'busy' : 'available' }));
    for (const id of this.users.keys()) this.emit(id, { type: 'lobby', users });
  }
  connect(user, nonce = '') {
    this.tick();
    if (this.users.has(user.id)) this.disconnect(user.id);
    if (this.users.size >= LIMITS.capacity) return false;
    this.users.set(user.id, { user: copy(user), nonce, lastSeen: this.now(), roomId: null, lastInvite: null, probes: {}, measuredRtt: null, probeAt: null, rate: { start: this.now(), count: 0 } });
    this.emit(user.id, { type: 'hello', user });
    const invitation = this.codeFor(user.id);
    if (invitation) {
      if (invitation.owner.id === user.id) invitation.owner = copy(user); else invitation.guest = copy(user);
      this.markCode(invitation); this.pairCode(invitation); this.codeStates(invitation);
    } else this.emitState(user.id);
    this.lobby();
    return true;
  }
  disconnect(userId) {
    const entry = this.users.get(userId); if (!entry) return;
    const invitation = this.codeFor(userId);
    this.leave(userId, { preserveCode: true }); this.users.delete(userId);
    if (invitation) this.codeStates(invitation);
    this.lobby();
  }
  leave(userId, { preserveCode = false } = {}) {
    const shared = this.codeFor(userId);
    if (shared && !preserveCode) { this.removeCode(shared); this.codeStates(shared); }
    const invitation = this.invitationFor(userId);
    if (invitation) {
      this.invitations.delete(invitation.id);
      this.emitState(invitation.from.id); this.emitState(invitation.to.id);
    }
    const entry = this.users.get(userId), room = this.rooms.get(entry?.roomId);
    if (room) {
      if (preserveCode && shared && room.shareCode === shared.code && room.phase === 'ready') {
        // Opening WeChat's share sheet can hide the host page. Keep the
        // reservation, but remove the pre-game room until both return.
        for (const player of room.players) {
          const peer = this.users.get(player.id); if (peer?.roomId === room.id) peer.roomId = null;
        }
        this.rooms.delete(room.id); shared.roomId = null; this.markCode(shared); this.codeStates(shared);
      } else {
        if (!['finished', 'aborted'].includes(room.phase)) this.abort(room, '一方离开了对局，本轮不计胜负。');
        entry.roomId = null; this.emitState(userId);
        if (room.players.every(player => this.users.get(player.id)?.roomId !== room.id)) this.rooms.delete(room.id);
      }
    }
    this.lobby();
  }
  receive(userId, value) {
    const entry = this.users.get(userId); if (!entry) return;
    const at = this.now();
    this.tick();
    if (!this.users.has(userId)) return;
    if (!value || Array.isArray(value) || typeof value !== 'object' || typeof value.type !== 'string') return this.error(userId, 'invalid_message', '请求格式错误。');
    if (at - entry.rate.start > 5000) entry.rate = { start: at, count: 0 };
    if (++entry.rate.count > 60) return this.error(userId, 'rate_limited', '操作太快了，请稍等。');
    entry.lastSeen = at;
    if (value.type === 'ping') {
      if ((typeof value.id !== 'number' && typeof value.id !== 'string') || String(value.id).length > 64 || !Number.isFinite(value.clientAt)) return;
      const probeId = this.id();
      entry.probes[probeId] = at;
      for (const id of Object.keys(entry.probes)) if (at - entry.probes[id] > LIMITS.probeAgeMs) delete entry.probes[id];
      while (Object.keys(entry.probes).length > 8) delete entry.probes[Object.keys(entry.probes)[0]];
      this.emit(userId, { type: 'pong', id: value.id, clientAt: value.clientAt, probeId });
      return;
    }
    if (value.type === 'probe_ack') {
      if (typeof value.probeId !== 'string' || !Object.hasOwn(entry.probes, value.probeId)) return;
      const sentAt = entry.probes[value.probeId];
      if (sentAt === undefined) return;
      delete entry.probes[value.probeId];
      const rtt = Math.max(0, at - sentAt);
      if (entry.measuredRtt === null || at - entry.probeAt > LIMITS.probeAgeMs || rtt < entry.measuredRtt) entry.measuredRtt = rtt;
      entry.probeAt = at;
      return;
    }
    if (value.type === 'leave') { this.leave(userId); return; }
    if (value.type === 'create_code') { this.createCode(userId, entry, at); return; }
    if (value.type === 'join_code') { this.joinCode(userId, entry, value.code, at); return; }
    if (value.type === 'cancel_code') {
      if (!this.codeFor(userId)) return this.error(userId, 'code_missing', '当前没有等待中的邀请码。');
      this.leave(userId); return;
    }
    if (value.type === 'invite') {
      const target = this.users.get(value.userId);
      if (!target || value.userId === userId) return this.error(userId, 'user_unavailable', '这位用户暂不可邀请，请刷新在线列表。');
      if (this.busy(userId) || this.busy(value.userId)) return this.error(userId, 'user_busy', '有一方正在对局或处理邀请。');
      if (entry.lastInvite !== null && at - entry.lastInvite < 5000) return this.error(userId, 'invite_cooldown', '请稍等几秒再邀请。');
      entry.lastInvite = at;
      const invitation = { id: this.id(), from: entry.user, to: target.user, expiresAt: at + LIMITS.invitationMs };
      this.invitations.set(invitation.id, invitation);
      this.emitState(userId); this.emitState(target.user.id); this.lobby(); return;
    }
    if (['accept', 'decline', 'cancel'].includes(value.type)) {
      const invitation = this.invitations.get(value.invitationId);
      if (!invitation || ![invitation.from.id, invitation.to.id].includes(userId)) return this.error(userId, 'invitation_expired', '邀请已结束，请重新发起。');
      if ((value.type === 'cancel' && invitation.from.id !== userId) || (value.type !== 'cancel' && invitation.to.id !== userId)) return this.error(userId, 'invitation_forbidden', '只能处理发给自己的邀请。');
      this.invitations.delete(invitation.id);
      if (value.type === 'accept') {
        if (!this.users.has(invitation.from.id) || !this.users.has(invitation.to.id)) return this.error(userId, 'user_unavailable', '对方已离线。');
        this.createRoom(invitation.from, invitation.to);
      }
      this.emitState(invitation.from.id); this.emitState(invitation.to.id); this.lobby(); return;
    }
    const room = this.rooms.get(entry.roomId);
    if (!room) return this.error(userId, 'room_missing', '请先邀请一位在线用户。');
    if (value.type === 'ready') { this.ready(userId, entry, room, value, at); return; }
    if (value.type === 'armed') {
      if (room.phase !== 'arming' || value.roundId !== room.roundId) return;
      if (at >= room.startAt - LIMITS.armMarginMs) { this.abort(room, '开局同步超时，请重新准备。'); return; }
      if (!room.armed.includes(userId)) room.armed.push(userId);
      if (room.armed.length === 2) { room.phase = 'scheduled'; this.roomState(room); }
      return;
    }
    if (value.type === 'tap') { this.tap(userId, entry, room, value, at); return; }
    this.error(userId, 'unsupported_message', '暂不支持这个操作。');
  }
  createRoom(owner, guest, shareCode = null) {
    const redFirst = this.random() < .5;
    const players = [owner, guest].map((player, i) => ({ ...player, color: (i === 0) === redFirst ? 'red' : 'blue' }));
    const room = { id: this.id(), players, shareCode, phase: 'ready', ready: [], roundId: null, result: null, taps: {}, armed: [] };
    this.rooms.set(room.id, room);
    players.forEach(player => { this.users.get(player.id).roomId = room.id; });
    return room;
  }
  createCode(userId, entry, at) {
    const existing = this.codeFor(userId);
    if (existing) { this.emitState(userId); return; }
    if (this.busy(userId)) return this.error(userId, 'user_busy', '请先结束当前对局或邀请。');
    if (this.codeInvites.size >= LIMITS.codeCapacity) return this.error(userId, 'code_capacity', '当前等待邀请较多，请稍后重试。');
    let code;
    for (let attempt = 0; attempt < 20; attempt++) { const next = this.code(); if (CODE.test(next) && !this.codeInvites.has(next)) { code = next; break; } }
    if (!code) return this.error(userId, 'code_unavailable', '暂时无法生成邀请码，请重试。');
    const invitation = { code, owner: copy(entry.user), guest: null, expiresAt: at + LIMITS.codeMs, roomId: null };
    this.codeInvites.set(code, invitation); this.markCode(invitation); this.emitState(userId); this.lobby();
  }
  joinCode(userId, entry, value, at) {
    if (entry.lastCodeAttempt !== undefined && at - entry.lastCodeAttempt < 2000) return this.error(userId, 'code_cooldown', '请稍等两秒再尝试加入。');
    entry.lastCodeAttempt = at;
    if (typeof value !== 'string' || !CODE.test(value)) return this.error(userId, 'code_invalid', '请输入 8 位邀请码。');
    const invitation = this.codeInvites.get(value);
    if (!invitation || invitation.expiresAt <= at) return this.error(userId, 'code_expired', '邀请码不存在或已过期，请对方重新分享。');
    if (invitation.owner.id === userId) return this.error(userId, 'code_self', '这是你发出的邀请码，请等待另一位玩家加入。');
    if (invitation.guest && invitation.guest.id !== userId) return this.error(userId, 'code_full', '这个邀请已由另一位玩家加入。');
    const ownCode = this.codeFor(userId);
    if (ownCode && ownCode.code !== value || entry.roomId && entry.roomId !== invitation.roomId || this.invitationFor(userId)) return this.error(userId, 'user_busy', '请先结束当前对局或邀请。');
    invitation.guest = copy(entry.user); this.markCode(invitation); this.pairCode(invitation); this.codeStates(invitation); this.lobby();
  }
  pairCode(invitation) {
    if (!invitation.guest || invitation.expiresAt <= this.now()) return;
    const owner = this.users.get(invitation.owner.id), guest = this.users.get(invitation.guest.id);
    const previous = this.rooms.get(invitation.roomId);
    if (previous) {
      if (!['ready', 'aborted'].includes(previous.phase)) { this.removeCode(invitation); return; }
      if (previous.phase === 'ready' && previous.players.every(player => this.users.get(player.id)?.roomId === previous.id)) return;
      for (const player of previous.players) {
        const peer = this.users.get(player.id); if (peer?.roomId === previous.id) peer.roomId = null;
      }
      this.rooms.delete(previous.id); invitation.roomId = null; this.markCode(invitation);
    }
    if (!owner || !guest) return;
    if (owner.roomId || guest.roomId || this.invitationFor(owner.user.id) || this.invitationFor(guest.user.id)) return;
    invitation.roomId = this.createRoom(owner.user, guest.user, invitation.code).id;
    this.markCode(invitation);
  }
  ready(userId, entry, room, value, at) {
    if (!['ready', 'finished', 'aborted'].includes(room.phase)) return;
    if (room.players.some(player => this.users.get(player.id)?.roomId !== room.id)) return this.error(userId, 'user_unavailable', '对方已离开，请返回大厅。');
    if (entry.probeAt === null || at - entry.probeAt > LIMITS.probeAgeMs || !Number.isFinite(entry.measuredRtt) || entry.measuredRtt > 400 ||
        !Number.isFinite(value.rtt) || value.rtt < 0 || value.rtt > 300 || !Number.isFinite(value.uncertainty) || value.uncertainty < 0 || value.uncertainty > 150) {
      return this.error(userId, 'clock_unsynced', '网络还没同步好，请稍等后重新准备。');
    }
    entry.timing = { rtt: value.rtt, uncertainty: value.uncertainty };
    entry.readyAt = at;
    // A player can sit on the ready screen for a long time. Ask them to ready
    // again instead of reusing an obsolete timing estimate on the next click.
    room.ready = room.ready.filter(id => {
      const peer = this.users.get(id);
      return peer && at - peer.readyAt <= 10000 && at - peer.probeAt <= LIMITS.probeAgeMs;
    });
    if (!room.ready.includes(userId)) room.ready.push(userId);
    if (room.ready.length === 2) {
      if (room.shareCode) {
        const invitation = this.codeInvites.get(room.shareCode); if (invitation) this.removeCode(invitation);
        room.shareCode = null;
      }
      room.phase = 'arming'; room.roundId = this.id(); room.result = null; room.taps = {}; room.armed = [];
      room.startAt = at + LIMITS.startBufferMs;
      room.signalAt = room.startAt + 2000 + Math.floor(this.random() * 4001);
    }
    this.roomState(room);
  }
  tap(userId, entry, room, value, at) {
    if (room.phase !== 'scheduled' || value.roundId !== room.roundId || Object.hasOwn(room.taps, userId)) return;
    const reaction = value.reactionMs;
    if (!Number.isFinite(reaction) || reaction < -10000 || reaction > LIMITS.reactionMs || at > room.signalAt + LIMITS.reactionMs + LIMITS.settleMs) return this.error(userId, 'invalid_tap', '本轮点击已失效。');
    const lag = at - room.signalAt - reaction;
    const uncertainty = entry.timing?.uncertainty || 0;
    if (lag < -(uncertainty + 40) || lag > Math.min(500, entry.measuredRtt + uncertainty + 100)) {
      this.abort(room, '网络延迟发生变化，本轮不计胜负，请重新准备。'); return;
    }
    room.taps[userId] = Math.round(reaction);
    if (reaction < 0) {
      const other = room.players.find(player => player.id !== userId);
      this.finish(room, 'false_start', other.id, '有人抢跑，等 GO 再点击。'); return;
    }
    if (Object.keys(room.taps).length === 2) this.settle(room);
  }
  finish(room, reason, winnerId, text) {
    room.phase = 'finished'; room.ready = [];
    room.result = { reason, winnerId, reactions: copy(room.taps), message: text };
    this.roomState(room);
  }
  settle(room) {
    const taps = Object.entries(room.taps).filter(([, ms]) => ms >= 0).sort((a, b) => a[1] - b[1]);
    if (taps.length === 0) this.finish(room, 'timeout', null, '双方都没点击，休息一下再来。');
    else if (taps.length === 2 && Math.abs(taps[0][1] - taps[1][1]) <= LIMITS.tieMs) this.finish(room, 'tie', null, '几乎同时点击，本轮平局。');
    else this.finish(room, 'reaction', taps[0][0], '本轮结束，准备好可以再来一局。');
  }
  abort(room, text) {
    room.phase = 'aborted'; room.ready = [];
    room.result = { reason: 'aborted', winnerId: null, reactions: {}, message: text };
    this.roomState(room);
  }
  presenceDeadline(entry) {
    const room = this.rooms.get(entry.roomId);
    const active = room && ['arming', 'scheduled'].includes(room.phase);
    return entry.lastSeen + (active ? LIMITS.activeStaleMs : LIMITS.staleMs);
  }
  tick() {
    const at = this.now();
    const stale = [...this.users.values()].filter(entry => at >= this.presenceDeadline(entry)).map(entry => entry.user.id);
    stale.forEach(userId => this.disconnect(userId));
    let changed = false;
    for (const invitation of this.invitations.values()) if (invitation.expiresAt <= at) {
      this.invitations.delete(invitation.id); this.emitState(invitation.from.id); this.emitState(invitation.to.id); changed = true;
    }
    for (const invitation of this.codeInvites.values()) if (invitation.expiresAt <= at) {
      this.removeCode(invitation); this.codeStates(invitation); changed = true;
    }
    for (const room of this.rooms.values()) {
      if (room.phase === 'arming' && at >= room.startAt - LIMITS.armMarginMs) this.abort(room, '开局同步超时，请重新准备。');
      if (room.phase === 'scheduled' && at >= room.signalAt + LIMITS.reactionMs + LIMITS.settleMs) this.settle(room);
    }
    if (changed) this.lobby();
    return stale;
  }
  nextDeadline() {
    const deadlines = [...this.users.values()].map(entry => this.presenceDeadline(entry));
    for (const invitation of this.invitations.values()) deadlines.push(invitation.expiresAt);
    // Offline share codes expire lazily on the next visitor. No user online
    // means no alarm or wakeup just to erase an unused ten-minute invitation.
    if (this.users.size) for (const invitation of this.codeInvites.values()) deadlines.push(invitation.expiresAt);
    for (const room of this.rooms.values()) {
      if (room.phase === 'arming') deadlines.push(room.startAt - LIMITS.armMarginMs);
      if (room.phase === 'scheduled') deadlines.push(room.signalAt + LIMITS.reactionMs + LIMITS.settleMs);
    }
    return deadlines.length ? Math.min(...deadlines) : null;
  }
}
