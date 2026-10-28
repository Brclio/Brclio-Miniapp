'use strict';

const account = require('./account');
const copy = value => JSON.parse(JSON.stringify(value));

function socketFailure(error) {
  // Native errors can contain the signed websocket URL. Classify only known
  // failure shapes and return fixed copy/codes; never display or retain it.
  const raw = error && (typeof error.errMsg === 'string' ? error.errMsg : typeof error.message === 'string' ? error.message : '');
  const message = String(raw || '').slice(0, 8000).replace(/(?:wss?|https?):\/\/\S+/gi, '').replace(/ticket\s*=\s*\S+/gi, '');
  if (/not\s+in\s+(?:the\s+)?(?:domain|url)\s+list|(?:domain|url).*(?:not\s+allowed|not\s+configured)|域名.*(?:不合法|未配置|校验失败|不在.*(?:列表|白名单))|非法.*域名/i.test(message)) {
    return { error: '实时连接被微信拦截，请核对 socket 合法域名配置。（PK-DOMAIN）', errorCode: 'socket_domain_not_allowed' };
  }
  if (/\b(?:tls|ssl|certificate|err_cert_[a-z_]+)\b|证书|安全连接/i.test(message)) {
    return { error: '实时安全连接验证失败，请重试并反馈错误码 PK-TLS。', errorCode: 'socket_tls_failed' };
  }
  const status = error && [401, 403, 503].includes(error.statusCode) ? error.statusCode : Number((message.match(/(?:HTTP(?:\/[\d.]+)?(?:\s+status)?|status(?:\s*code)?|server\s+response|response\s+code|握手(?:失败)?(?:状态码)?)[^\d]{0,20}(401|403|503)\b/i) || [])[1]);
  if (status === 401) return { error: '在线连接凭证已失效，请重新连接。（PK-401）', errorCode: 'socket_http_401' };
  if (status === 403) return { error: '在线服务拒绝了连接，请重试并反馈错误码 PK-403。', errorCode: 'socket_http_403' };
  if (status === 503) return { error: '在线服务暂时不可用，请稍后重试。（PK-503）', errorCode: 'socket_http_503' };
  return { error: raw ? '实时连接失败，请重新连接并反馈错误码 PK-SOCKET。' : '实时连接失败，请检查网络后重试。', errorCode: 'socket_connection_failed' };
}

// Independent transport and clock for online play. Never writes the local game,
// its settings, rewards, history or account sync storage.
function createOnlineDuel(options) {
  const opt = options || {}, api = opt.wx || wx, auth = opt.account || account;
  const wallNow = opt.now || Date.now;
  const monotonic = opt.monotonicNow || (typeof performance !== 'undefined' && typeof performance.now === 'function' ? () => performance.now() : wallNow);
  const epoch = wallNow(), origin = monotonic(), now = () => epoch + monotonic() - origin;
  const later = opt.setTimeout || setTimeout, cancelTimer = opt.clearTimeout || clearTimeout;
  const timers = new Set(), probes = new Map();
  let socket = null, generation = 0, roundTimers = [], heartbeat = null, heartbeatDue = 0, deadline = null;
  let wanted = false, disposed = false, reconnectAttempt = 0, reconnectTimer = null, networkOnline = true, lastPing = 0;
  let samples = [], offset = 0, sequence = 0, lastPong = 0, syncing = false, pendingReady = false;
  let friendSequence = 0;
  let wireRoom = null, activeSince = 0, armedRound = '', scheduledRound = '', signalLocalAt = 0, actualSignalAt = null, shownStart = false;
  let state = { connection: 'idle', user: null, users: [], invitation: null, shareInvite: null, shareRemainingSeconds: 0, friends: [], friendRequests: { incoming: [], outgoing: [] }, friendsLoading: false, friendError: '', room: null, myColor: '', myReady: false, tapped: false, syncReady: false, rtt: 0, uncertainty: 0, error: '', errorCode: '', notice: '', remainingSeconds: 0 };
  const snapshot = () => copy(state);
  function emit() { if (opt.onChange) opt.onChange(snapshot()); }
  function sound(type) { if (opt.onSound) return opt.onSound(type); }
  function schedule(fn, delay) {
    const id = later(() => { timers.delete(id); fn(); }, Math.max(0, delay)); timers.add(id); return id;
  }
  function clear(id) { if (id !== null && id !== undefined) { cancelTimer(id); timers.delete(id); } }
  function clearRound() { roundTimers.forEach(clear); roundTimers = []; sound('stop'); }
  function send(value) {
    if (!socket || !['online', 'syncing'].includes(state.connection)) return false;
    const expected = generation, current = socket;
    const failed = () => { if (expected === generation && socket === current) recover('连接短暂中断，正在自动重连。', 'socket_send_failed'); };
    try { current.send({ data: JSON.stringify(value), fail: failed }); return true; }
    catch (_) { failed(); return false; }
  }
  function stop() {
    generation += 1; pendingReady = false; syncing = false;
    timers.forEach(cancelTimer); timers.clear(); roundTimers = []; probes.clear();
    heartbeat = null; heartbeatDue = 0; lastPing = 0; reconnectTimer = null; deadline = null; samples = []; wireRoom = null; activeSince = 0; armedRound = ''; scheduledRound = ''; shownStart = false; actualSignalAt = null;
    sound('stop');
    const previous = socket; socket = null;
    if (previous) { try { previous.close({ code: 1000, reason: 'Leave online lobby' }); } catch (_) {} }
  }
  function fail(message, errorCode = '') {
    wanted = false;
    stop(); state = { ...state, connection: 'error', users: [], invitation: null, shareInvite: null, shareRemainingSeconds: 0, friendsLoading: false, room: null, syncReady: false, tapped: false, myColor: '', myReady: false, remainingSeconds: 0, error: message, errorCode }; annotateFriends(); emit();
  }
  function recover(message, errorCode = '') {
    if (!wanted || disposed) return;
    stop();
    reconnectAttempt += 1;
    state = { ...state, connection: 'reconnecting', users: [], invitation: null, shareInvite: null, shareRemainingSeconds: 0, friendsLoading: false, room: null, syncReady: false, tapped: false, myColor: '', myReady: false, remainingSeconds: 0, error: '', errorCode, notice: message, reconnectAttempt };
    annotateFriends(); emit();
    const expected = generation;
    reconnectTimer = schedule(() => {
      reconnectTimer = null;
      if (expected === generation && wanted && !disposed) open(true);
    }, Math.min(10000, 1000 * Math.pow(2, Math.min(4, reconnectAttempt - 1))));
  }
  function ping() {
    const id = String(++sequence), clientAt = now();
    probes.set(id, clientAt);
    if (probes.size > 12) probes.delete(probes.keys().next().value);
    lastPing = clientAt;
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
    state.connection = 'online'; reconnectAttempt = 0; state.reconnectAttempt = 0;
    if (state.notice === '连接短暂中断，正在自动重连。' || state.notice === '网络已断开，恢复后会自动连接。') state.notice = '';
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
    if (!socket || !['online', 'syncing'].includes(state.connection)) return;
    const active = wireRoom && ['arming', 'scheduled'].includes(wireRoom.phase);
    const due = Math.max(now(), lastPing + (active ? 1000 : 5000));
    // State broadcasts must never postpone the next heartbeat. Calibration
    // also cannot suppress it when a probe or its reply is lost.
    if (heartbeat !== null && heartbeatDue <= due) return;
    clear(heartbeat); heartbeatDue = due;
    heartbeat = schedule(() => {
      heartbeat = null; heartbeatDue = 0;
      if (now() - lastPong >= 60000) { recover('连接短暂中断，正在自动重连。', 'socket_heartbeat_timeout'); return; }
      if (wireRoom && ['arming', 'scheduled'].includes(wireRoom.phase) && now() - Math.max(lastPong, activeSince) >= 4500) {
        abortTiming('网络暂时不稳定，本局已中止，连接恢复后可重新准备。');
        const before = sequence; syncClock();
        if (sequence === before) ping();
        maintain(); return;
      }
      ping(); maintain();
    }, due - now());
  }
  function countdown() {
    clear(deadline); deadline = null;
    state.remainingSeconds = state.invitation ? Math.max(0, Math.ceil((state.invitation.expiresAt - now() - offset) / 1000)) : 0;
    state.shareRemainingSeconds = state.shareInvite ? Math.max(0, Math.ceil((state.shareInvite.expiresAt - now() - offset) / 1000)) : 0;
    if (!state.remainingSeconds) state.invitation = null;
    if (!state.shareRemainingSeconds) state.shareInvite = null;
    if (state.invitation || state.shareInvite) {
      const expiresAt = Math.min(...[state.invitation, state.shareInvite].filter(Boolean).map(value => value.expiresAt));
      deadline = schedule(() => { countdown(); emit(); }, Math.max(1, Math.min(500, expiresAt - now() - offset)));
    }
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
    send({ type: 'leave' }); clearRound(); wireRoom = null; activeSince = 0; armedRound = ''; scheduledRound = '';
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
      shownStart = true; state.room.phase = 'waiting';
      if (sound('start') === false) { abortTiming('提示音未能播放，本轮已中止，请试听后重新准备。'); return; }
      emit();
    }, room.startAt - offset - now()));
    roundTimers.push(schedule(() => {
      if (!wireRoom || wireRoom.roundId !== roundId) return;
      if (now() - signalLocalAt > 120) { abortTiming('手机提示响应延迟，本轮已中止。'); return; }
      actualSignalAt = now();
      state.room.phase = state.tapped ? 'settling' : 'go';
      if (sound('go') === false) { abortTiming('提示音未能播放，本轮已中止，请试听后重新准备。'); return; }
      emit();
    }, signalLocalAt - now()));
  }
  function applyState(message) {
    const previous = state.room;
    const wasActive = wireRoom && ['arming', 'scheduled'].includes(wireRoom.phase);
    state.invitation = message.invitation ? { ...message.invitation, direction: message.invitation.from.id === state.user.id ? 'outgoing' : 'incoming' } : null;
    state.shareInvite = message.shareInvite || null;
    countdown(); wireRoom = message.room || null;
    if (!wasActive && wireRoom && ['arming', 'scheduled'].includes(wireRoom.phase)) { activeSince = now(); ping(); }
    else if (!wireRoom || !['arming', 'scheduled'].includes(wireRoom.phase)) activeSince = 0;
    maintain();
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
  async function open(reconnecting) {
    if (!wanted || disposed) return;
    stop(); const expected = generation, user = auth.getCachedUser();
    state = { ...state, user, connection: user ? reconnecting ? 'reconnecting' : 'connecting' : 'login', users: [], invitation: null, shareInvite: null, shareRemainingSeconds: 0, friends: [], friendRequests: { incoming: [], outgoing: [] }, friendsLoading: false, friendError: '', room: null, myColor: '', myReady: false, tapped: false, syncReady: false, rtt: 0, uncertainty: 0, error: '', errorCode: '', notice: reconnecting ? '连接短暂中断，正在自动重连。' : '', remainingSeconds: 0 }; emit();
    if (!user) { wanted = false; return; }
    if (!networkOnline) { recover('网络已断开，恢复后会自动连接。', 'socket_offline'); return; }
    deadline = schedule(() => { if (expected === generation) recover('连接短暂中断，正在自动重连。', 'socket_connect_timeout'); }, 55000);
    try {
      const result = await auth.createDuelTicket();
      if (expected !== generation) return;
      // The phone clock is not calibrated yet; only the server can decide
      // whether this server-issued expiry is current.
      if (!result || typeof result.ticket !== 'string' || !result.ticket || result.ticket.length > 4096 || !/^wss:\/\/(?:[a-z0-9-]+\.)+[a-z0-9-]+(?::443)?\/[A-Za-z0-9/_-]*$/i.test(result.socketUrl) || !Number.isSafeInteger(result.expiresAt)) throw new Error('在线服务配置暂不可用，请稍后重试。');
      const failed = error => {
        if (expected !== generation) return;
        const diagnostic = socketFailure(error);
        if (['socket_domain_not_allowed', 'socket_tls_failed', 'socket_http_403'].includes(diagnostic.errorCode)) fail(diagnostic.error, diagnostic.errorCode);
        else recover('连接短暂中断，正在自动重连。', diagnostic.errorCode);
      };
      let task;
      try { task = api.connectSocket({ url: result.socketUrl + '?ticket=' + encodeURIComponent(result.ticket), tcpNoDelay: true, fail: failed }); }
      catch (error) { failed(error); return; }
      if (expected !== generation) { if (task) { try { task.close({ code: 1000, reason: 'Connection cancelled' }); } catch (_) {} } return; }
      if (!task || typeof task.onMessage !== 'function') throw new Error('请更新微信后重试。');
      socket = task;
      task.onMessage(event => { if (expected === generation) receive(event); });
      task.onError(failed);
      task.onClose(event => {
        if (expected !== generation) return;
        if (event && event.code === 4001) fail('此账号已在另一台设备进入在线 PK，请使用不同账号对战。', 'socket_account_opened_elsewhere');
        else if (event && [1008, 1009].includes(event.code)) fail('在线会话已结束，请重新进入。', 'socket_session_ended');
        else recover('连接短暂中断，正在自动重连。', 'socket_closed');
      });
    } catch (error) {
      if (expected !== generation) return;
      if (!auth.getCachedUser()) { wanted = false; stop(); state = { ...state, user: null, connection: 'login', error: '', notice: '请登录后重新进入在线 PK。' }; emit(); }
      else if (error && ['在线服务配置暂不可用，请稍后重试。', '请更新微信后重试。'].includes(error.message)) fail(error.message);
      else recover('连接短暂中断，正在自动重连。', 'socket_ticket_unavailable');
    }
  }
  function connect() { if (disposed) return; wanted = true; reconnectAttempt = 0; return open(false); }
  const networkChanged = info => {
    if (disposed) return;
    networkOnline = !info || info.isConnected !== false;
    if (!wanted) return;
    if (!networkOnline) recover('网络已断开，恢复后会自动连接。', 'socket_offline');
    else if (state.connection === 'reconnecting') { clear(reconnectTimer); reconnectTimer = null; open(true); }
  };
  if (typeof api.onNetworkStatusChange === 'function') api.onNetworkStatusChange(networkChanged);
  function ready() {
    if (!state.room || !['ready', 'result', 'aborted'].includes(state.room.phase) || state.myReady) return false;
    state.error = '';
    if (now() - lastPong > 10000 || samples.length < 3) { pendingReady = true; syncClock(); return false; }
    if (!state.syncReady) { state.notice = '网络延迟较高，请重新校准后准备。'; emit(); return false; }
    return send({ type: 'ready', rtt: state.rtt, uncertainty: state.uncertainty });
  }
  const unsubscribe = auth.subscribe(event => {
    if (!state.user || event.user && event.user.id === state.user.id) return;
    wanted = false; stop(); state = { ...state, user: event.user || null, connection: event.user ? 'idle' : 'login', users: [], invitation: null, shareInvite: null, shareRemainingSeconds: 0, friends: [], friendRequests: { incoming: [], outgoing: [] }, friendsLoading: false, friendError: '', room: null, syncReady: false, myColor: '', myReady: false, tapped: false, notice: '账号已变化，请重新进入在线大厅。' }; emit();
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
    disconnect() { wanted = false; stop(); state = { ...state, connection: 'idle', users: [], invitation: null, shareInvite: null, shareRemainingSeconds: 0, friendsLoading: false, room: null, syncReady: false, myColor: '', myReady: false, tapped: false, remainingSeconds: 0 }; annotateFriends(); emit(); },
    dispose() { wanted = false; disposed = true; stop(); unsubscribe(); if (typeof api.offNetworkStatusChange === 'function') api.offNetworkStatusChange(networkChanged); }
  };
}

module.exports = { createOnlineDuel };
