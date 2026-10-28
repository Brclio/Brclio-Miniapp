'use strict';

const account = require('./account');
const copy = value => JSON.parse(JSON.stringify(value));

// Independent transport and clock for online play. Never writes the local game,
// its settings, rewards, history or account sync storage.
function createOnlineDuel(options) {
  const opt = options || {}, api = opt.wx || wx, auth = opt.account || account;
  const wallNow = opt.now || Date.now;
  const monotonic = opt.monotonicNow || (typeof performance !== 'undefined' && typeof performance.now === 'function' ? () => performance.now() : wallNow);
  const epoch = wallNow(), origin = monotonic(), now = () => epoch + monotonic() - origin;
  const later = opt.setTimeout || setTimeout, cancelTimer = opt.clearTimeout || clearTimeout;
  const timers = new Set(), probes = new Map();
  let socket = null, generation = 0, roundTimers = [], heartbeat = null, deadline = null;
  let samples = [], offset = 0, sequence = 0, lastPong = 0, syncing = false, pendingReady = false;
  let friendSequence = 0;
  let wireRoom = null, armedRound = '', scheduledRound = '', signalLocalAt = 0, actualSignalAt = null, shownStart = false;
  let state = { connection: 'idle', user: null, users: [], invitation: null, shareInvite: null, shareRemainingSeconds: 0, friends: [], friendRequests: { incoming: [], outgoing: [] }, friendsLoading: false, friendError: '', room: null, myColor: '', myReady: false, tapped: false, syncReady: false, rtt: 0, uncertainty: 0, error: '', notice: '', remainingSeconds: 0 };
  const snapshot = () => copy(state);
  function emit() { if (opt.onChange) opt.onChange(snapshot()); }
  function sound(type) { if (opt.onSound) opt.onSound(type); }
  function schedule(fn, delay) {
    const id = later(() => { timers.delete(id); fn(); }, Math.max(0, delay)); timers.add(id); return id;
  }
  function clear(id) { if (id !== null && id !== undefined) { cancelTimer(id); timers.delete(id); } }
  function clearRound() { roundTimers.forEach(clear); roundTimers = []; sound('stop'); }
  function send(value) {
    if (!socket || !['online', 'syncing'].includes(state.connection)) return false;
    const expected = generation, current = socket;
    const failed = () => { if (expected === generation && socket === current) fail('连接中断，请重新进入在线大厅。'); };
    try { current.send({ data: JSON.stringify(value), fail: failed }); return true; }
    catch (_) { failed(); return false; }
  }
  function stop() {
    generation += 1; pendingReady = false; syncing = false;
    timers.forEach(cancelTimer); timers.clear(); roundTimers = []; probes.clear();
    heartbeat = null; deadline = null; samples = []; wireRoom = null; armedRound = ''; scheduledRound = ''; shownStart = false; actualSignalAt = null;
    sound('stop');
    const previous = socket; socket = null;
    if (previous) { try { previous.close({ code: 1000, reason: 'Leave online lobby' }); } catch (_) {} }
  }
  function fail(message) {
    stop(); state = { ...state, connection: 'error', users: [], invitation: null, shareInvite: null, shareRemainingSeconds: 0, friendsLoading: false, room: null, syncReady: false, tapped: false, myColor: '', myReady: false, remainingSeconds: 0, error: message }; annotateFriends(); emit();
  }
  function ping() {
    const id = String(++sequence), clientAt = now();
    probes.set(id, clientAt);
    if (probes.size > 12) probes.delete(probes.keys().next().value);
    send({ type: 'ping', id, clientAt });
  }
  function syncClock() {
    if (syncing || !socket || wireRoom && ['arming', 'scheduled'].includes(wireRoom.phase)) return;
    syncing = true; samples = []; state.syncReady = false; emit(); ping();
  }
  function onPong(message) {
    const sentAt = probes.get(message.id); probes.delete(message.id);
    if (sentAt === undefined || message.clientAt !== sentAt || !Number.isFinite(message.serverAt)) return;
    const expected = generation;
    if (typeof message.probeId === 'string') send({ type: 'probe_ack', probeId: message.probeId });
    if (generation !== expected) return;
    const receivedAt = now(), rtt = receivedAt - sentAt;
    if (rtt < 0 || rtt > 5000) return;
    lastPong = receivedAt;
    if (wireRoom && ['arming', 'scheduled'].includes(wireRoom.phase)) return;
    samples.push({ rtt, offset: message.serverAt - (sentAt + receivedAt) / 2 });
    if (samples.length > 5) samples.shift();
    const best = samples.reduce((a, b) => a.rtt <= b.rtt ? a : b);
    offset = best.offset;
    state.rtt = Math.round(best.rtt); state.uncertainty = Math.ceil(best.rtt / 2);
    state.syncReady = samples.length >= 3 && best.rtt <= 300;
    state.connection = 'online';
    countdown();
    if (syncing && samples.length < 5) schedule(ping, 100);
    else {
      syncing = false;
      if (!state.syncReady) state.notice = '网络延迟较高，请改善网络后重新校准。';
      if (pendingReady) { pendingReady = false; ready(); }
    }
    emit();
  }
  function maintain() {
    if (!socket) return;
    const active = wireRoom && ['arming', 'scheduled'].includes(wireRoom.phase);
    heartbeat = schedule(() => {
      if (now() - lastPong >= (active ? 3000 : 25000)) { fail('连接超时，请重新进入在线大厅。'); return; }
      if (!syncing) ping(); maintain();
    }, active ? 1000 : 10000);
  }
  function countdown() {
    clear(deadline); deadline = null;
    state.remainingSeconds = state.invitation ? Math.max(0, Math.ceil((state.invitation.expiresAt - now() - offset) / 1000)) : 0;
    state.shareRemainingSeconds = state.shareInvite ? Math.max(0, Math.ceil((state.shareInvite.expiresAt - now() - offset) / 1000)) : 0;
    if (!state.remainingSeconds) state.invitation = null;
    if (!state.shareRemainingSeconds) state.shareInvite = null;
    if (state.invitation || state.shareInvite) deadline = schedule(() => { countdown(); emit(); }, 500);
  }
  function annotateFriends() {
    const online = new Map(state.users.map(user => [user.id, user]));
    state.friends = state.friends.map(friend => {
      const current = online.get(friend.id);
      return { ...friend, ...(current ? { displayName: current.displayName, avatarUrl: current.avatarUrl } : {}), online: !!current, busy: !!(current && current.busy) };
    });
  }
  async function friendsAction(method, ...args) {
    if (!state.user || typeof auth[method] !== 'function') return;
    const expected = generation, userId = state.user.id, request = ++friendSequence;
    state.friendsLoading = true; state.friendError = ''; emit();
    try {
      const value = await auth[method](...args);
      if (expected !== generation || request !== friendSequence || !state.user || state.user.id !== userId) return;
      state.friends = (value.friends || []).map(entry => ({ ...entry.user, since: entry.since }));
      state.friendRequests = { incoming: value.incoming || [], outgoing: value.outgoing || [] }; annotateFriends();
    } catch (error) {
      if (expected !== generation || request !== friendSequence) return;
      state.friendError = error.message || '好友列表暂时无法读取，请重试。';
    } finally { if (expected === generation && request === friendSequence) { state.friendsLoading = false; emit(); } }
  }
  function abortTiming(message) {
    send({ type: 'leave' }); clearRound(); wireRoom = null; armedRound = ''; scheduledRound = '';
    state.room = null; state.shareInvite = null; state.shareRemainingSeconds = 0; state.myColor = ''; state.myReady = false; state.tapped = false; state.notice = message; emit();
  }
  function arm(room) {
    if (room.roundId === armedRound) return;
    clearRound();
    if (!state.syncReady || !Number.isFinite(room.startAt) || !Number.isFinite(room.signalAt) || room.signalAt < room.startAt + 1000 || room.startAt - now() - offset < 300) {
      abortTiming('本轮未能及时同步，请双方重新准备。'); return;
    }
    armedRound = room.roundId; scheduledRound = ''; shownStart = false; actualSignalAt = null; state.tapped = false;
    signalLocalAt = room.signalAt - offset;
    send({ type: 'armed', roundId: room.roundId });
  }
  function commit(room) {
    if (scheduledRound === room.roundId) return;
    if (armedRound !== room.roundId || room.startAt - now() - offset < 100) { abortTiming('开局消息迟到，本轮已中止，请重新准备。'); return; }
    scheduledRound = room.roundId;
    const roundId = room.roundId;
    roundTimers.push(schedule(() => {
      if (!wireRoom || wireRoom.roundId !== roundId) return;
      if (now() - (room.startAt - offset) > 120) { abortTiming('手机开局响应延迟，本轮已中止。'); return; }
      shownStart = true; state.room.phase = 'waiting'; sound('start'); emit();
    }, room.startAt - offset - now()));
    roundTimers.push(schedule(() => {
      if (!wireRoom || wireRoom.roundId !== roundId) return;
      if (now() - signalLocalAt > 120) { abortTiming('手机提示响应延迟，本轮已中止。'); return; }
      actualSignalAt = now();
      state.room.phase = state.tapped ? 'settling' : 'go'; sound('go'); emit();
    }, signalLocalAt - now()));
  }
  function applyState(message) {
    const previous = state.room;
    const wasActive = wireRoom && ['arming', 'scheduled'].includes(wireRoom.phase);
    state.invitation = message.invitation ? { ...message.invitation, direction: message.invitation.from.id === state.user.id ? 'outgoing' : 'incoming' } : null;
    state.shareInvite = message.shareInvite || null;
    countdown(); wireRoom = message.room || null;
    if (!wasActive && wireRoom && ['arming', 'scheduled'].includes(wireRoom.phase)) ping();
    clear(heartbeat); maintain();
    if (!wireRoom) {
      clearRound(); armedRound = ''; scheduledRound = ''; state.room = null; state.myReady = false; state.myColor = ''; state.tapped = false;
      emit(); return;
    }
    const room = wireRoom, me = room.players.find(player => player.id === state.user.id);
    if (!me) { fail('对战房间身份不匹配，请重新进入。'); return; }
    const phase = room.phase === 'scheduled' ? (now() < room.startAt - offset ? 'arming' : state.tapped ? 'settling' : now() >= room.signalAt - offset ? 'go' : 'waiting') : room.phase === 'finished' ? 'result' : room.phase;
    state.myColor = me.color; state.myReady = (room.ready || []).includes(me.id);
    state.room = { ...room, phase, players: room.players.map(player => ({ ...player, ready: (room.ready || []).includes(player.id), reactionMs: room.result && room.result.reactions ? room.result.reactions[player.id] : null })) };
    if (room.phase === 'arming') arm(room);
    else if (room.phase === 'scheduled') commit(room);
    else if (room.phase === 'finished' || room.phase === 'aborted') {
      clearRound(); armedRound = ''; scheduledRound = '';
      if (previous && previous.phase !== 'result' && previous.phase !== 'aborted' && room.result && room.result.winnerId) sound(room.result.reason === 'false_start' ? 'false' : 'win');
    } else { clearRound(); state.tapped = false; }
    emit();
  }
  function receive(event) {
    let message;
    try { if (typeof event.data !== 'string' || event.data.length > 100000) return; message = JSON.parse(event.data); } catch (_) { return; }
    if (!message || typeof message !== 'object') return;
    if (message.type === 'hello') {
      if (!message.user || !state.user || message.user.id !== state.user.id) { fail('账号状态已变化，请重新进入。'); return; }
      clear(deadline); deadline = null; state.user = { ...state.user, ...message.user }; state.connection = 'syncing'; lastPong = now(); if (Number.isFinite(message.serverAt)) offset = message.serverAt - now(); emit(); syncClock(); maintain(); friendsAction('readFriends');
    } else if (message.type === 'pong') onPong(message);
    else if (message.type === 'lobby') { state.users = (message.users || []).filter(user => user.id !== state.user.id).map(user => ({ ...user, busy: user.status !== 'available' })); annotateFriends(); emit(); }
    else if (message.type === 'state') applyState(message);
    else if (message.type === 'error') { state.error = typeof message.message === 'string' ? message.message : '操作未完成，请重试。'; pendingReady = false; emit(); }
  }
  async function connect() {
    stop(); const expected = generation, user = auth.getCachedUser();
    state = { ...state, user, connection: user ? 'connecting' : 'login', users: [], invitation: null, shareInvite: null, shareRemainingSeconds: 0, friends: [], friendRequests: { incoming: [], outgoing: [] }, friendsLoading: false, friendError: '', room: null, myColor: '', myReady: false, tapped: false, syncReady: false, rtt: 0, uncertainty: 0, error: '', notice: '', remainingSeconds: 0 }; emit();
    if (!user) return;
    deadline = schedule(() => { if (expected === generation) fail('连接超时，请重试。'); }, 55000);
    try {
      const result = await auth.createDuelTicket();
      if (expected !== generation) return;
      // The phone clock is not calibrated yet; only the server can decide
      // whether this server-issued expiry is current.
      if (!result || typeof result.ticket !== 'string' || !result.ticket || result.ticket.length > 4096 || !/^wss:\/\/(?:[a-z0-9-]+\.)+[a-z0-9-]+(?::443)?\/[A-Za-z0-9/_-]*$/i.test(result.socketUrl) || !Number.isSafeInteger(result.expiresAt)) throw new Error('在线服务配置暂不可用，请稍后重试。');
      const task = api.connectSocket({ url: result.socketUrl + '?ticket=' + encodeURIComponent(result.ticket), tcpNoDelay: true, fail: () => { if (expected === generation) fail('实时连接失败，请检查网络后重试。'); } });
      if (!task || typeof task.onMessage !== 'function') throw new Error('请更新微信后重试。');
      socket = task;
      task.onMessage(event => { if (expected === generation) receive(event); });
      task.onError(() => { if (expected === generation) fail('实时连接失败，请检查网络后重试。'); });
      task.onClose(() => { if (expected === generation) fail('在线连接已结束，请重新进入。'); });
    } catch (error) { if (expected === generation) fail(error.message || '无法进入在线大厅，请稍后重试。'); }
  }
  function ready() {
    if (!state.room || !['ready', 'result', 'aborted'].includes(state.room.phase) || state.myReady) return false;
    state.error = '';
    if (now() - lastPong > 10000 || samples.length < 3) { pendingReady = true; syncClock(); return false; }
    if (!state.syncReady) { state.notice = '网络延迟较高，请重新校准后准备。'; emit(); return false; }
    return send({ type: 'ready', rtt: state.rtt, uncertainty: state.uncertainty });
  }
  const unsubscribe = auth.subscribe(event => {
    if (!state.user || event.user && event.user.id === state.user.id) return;
    stop(); state = { ...state, user: event.user || null, connection: event.user ? 'idle' : 'login', users: [], invitation: null, shareInvite: null, shareRemainingSeconds: 0, friends: [], friendRequests: { incoming: [], outgoing: [] }, friendsLoading: false, friendError: '', room: null, syncReady: false, myColor: '', myReady: false, tapped: false, notice: '账号已变化，请重新进入在线大厅。' }; emit();
  });
  return {
    connect, snapshot, ready,
    calibrate: syncClock,
    createCode() { state.error = ''; return send({ type: 'create_code' }); },
    joinCode(value) {
      const code = String(value || '').trim().toUpperCase();
      if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) { state.error = '请输入 8 位邀请码。'; emit(); return false; }
      state.error = ''; return send({ type: 'join_code', code });
    },
    cancelCode() { return send({ type: 'cancel_code' }); },
    refreshFriends() { return friendsAction('readFriends'); },
    requestFriend(value) { return friendsAction('requestFriend', typeof value === 'string' ? { userId: value } : value); },
    respondFriend(value, accept) { return typeof value === 'object' ? friendsAction('respondFriend', value.requestId, value.accept) : friendsAction('respondFriend', value, accept); },
    removeFriend(userId) { return friendsAction('removeFriend', userId); },
    invite(userId) { state.error = ''; return send({ type: 'invite', userId }); },
    accept(invitationId) { state.error = ''; return send({ type: 'accept', invitationId }); },
    decline(invitationId) { return send({ type: 'decline', invitationId }); },
    cancel(invitationId) { return send({ type: 'cancel', invitationId }); },
    tap() {
      if (!wireRoom || wireRoom.phase !== 'scheduled' || !state.room || state.tapped || !scheduledRound || !shownStart) return false;
      // Count from the actual local cue callback, so a small scheduling delay
      // is not added to this player's reaction. A touch before that cue is early.
      const reactionMs = actualSignalAt === null ? Math.min(-1, Math.round(now() - signalLocalAt)) : Math.round(now() - actualSignalAt);
      state.tapped = true; state.room.phase = 'settling'; emit();
      return send({ type: 'tap', roundId: wireRoom.roundId, reactionMs });
    },
    leave() { abortTiming('已离开对战，可以重新邀请对手。'); },
    disconnect() { stop(); state = { ...state, connection: 'idle', users: [], invitation: null, shareInvite: null, shareRemainingSeconds: 0, friendsLoading: false, room: null, syncReady: false, myColor: '', myReady: false, tapped: false, remainingSeconds: 0 }; annotateFriends(); emit(); },
    dispose() { stop(); unsubscribe(); }
  };
}

module.exports = { createOnlineDuel };
