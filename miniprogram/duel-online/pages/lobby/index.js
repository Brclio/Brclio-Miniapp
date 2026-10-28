'use strict';

const { createOnlineDuel } = require('../../../lib/online-duel');
const { createDuelAudio } = require('../../../lib/duel');
const accountSync = require('../../../lib/account-sync');
const SOUND_KEY = 'brclio.online-duel.sound.v1';
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;
const cleanCode = value => String(value || '').replace(/[\s-]/g, '').toUpperCase();

const ACTIVE_PHASES = ['arming', 'waiting', 'go', 'settling'];
const label = user => user && (user.displayName || user.username) || '挑战玩家';
const initial = user => label(user).slice(0, 1).toUpperCase();

Page({
  data: {
    connection: 'idle', user: null, users: [], invitation: null, room: null,
    myColor: '', myReady: false, tapped: false, syncReady: false,
    rtt: 0, uncertainty: 0, error: '', notice: '', remainingSeconds: 0,
    soundEnabled: true, working: false, players: [], invitationName: '',
    resultTitle: '', resultCopy: '', phaseTitle: '', phaseCopy: '',
    connectionLabel: '正在连接', userLabel: '', userInitial: '',
    canTap: false, activeRound: false, roomFinished: false, onlineCount: 0,
    shareInvite: null, shareRemainingSeconds: 0, shareIsOwner: false, sharePeerName: '', shareCountdown: '',
    inviteCodeInput: '', pendingEntryCode: '', activeList: 'online', friendUsername: '',
    friends: [], friendRequests: { incoming: [], outgoing: [] }, friendsLoading: false, friendError: '',
    friendCount: 0, incomingCount: 0, canCreateCode: false
  },

  onLoad(options) {
    this._alive = true;
    this._visible = false;
    const code = cleanCode(options && options.code);
    this._pendingCode = CODE_PATTERN.test(code) ? code : '';
    this._joiningCode = false;
    if (code && !this._pendingCode) this._entryError = '邀请链接中的邀请码无效，请向好友确认。';
    this.setData({ inviteCodeInput: this._pendingCode, pendingEntryCode: this._pendingCode });
    this._audio = createDuelAudio(wx, { enabled: true, assetBase: '/assets/duel-audio' });
    this._client = createOnlineDuel({
      onChange: state => this.applyState(state),
      onSound: type => {
        if (type === 'stop') { this._audio.stop(); return; }
        if (this._alive && this._visible) this._audio.play(type, 'TOUCH');
      }
    });
    if (wx.showShareMenu) wx.showShareMenu({ menus: ['shareAppMessage'] });
  },

  onShow() {
    if (!this._alive) return;
    this._visible = true;
    let enabled = true;
    try {
      const saved = wx.getStorageSync(SOUND_KEY);
      const value = typeof saved === 'boolean' ? saved : accountSync.storage.getStorageSync('RGD_SOUND_ENABLED');
      if (typeof value === 'boolean') enabled = value;
    } catch (_) {}
    this.setData({ soundEnabled: enabled, working: false });
    this._audio.setEnabled(enabled);
    if (wx.setKeepScreenOn) wx.setKeepScreenOn({ keepScreenOn: true });
    this.runAction('connect');
  },

  onHide() {
    this._visible = false;
    if (this._client) this._client.disconnect();
    if (this._audio) this._audio.stop();
    if (wx.setKeepScreenOn) wx.setKeepScreenOn({ keepScreenOn: false });
  },

  onUnload() {
    this._alive = false;
    this._visible = false;
    if (this._client) this._client.dispose();
    if (this._audio) this._audio.dispose();
    if (wx.setKeepScreenOn) wx.setKeepScreenOn({ keepScreenOn: false });
  },

  applyState(state) {
    if (!this._alive || !this._visible) return;
    const room = state.room;
    const result = room && room.result;
    const myId = state.user && state.user.id;
    const friends = Array.isArray(state.friends) ? state.friends : [];
    const requests = state.friendRequests || { incoming: [], outgoing: [] };
    const incoming = Array.isArray(requests.incoming) ? requests.incoming : [];
    const outgoing = Array.isArray(requests.outgoing) ? requests.outgoing : [];
    const friendStatus = id => friends.some(friend => friend.id === id) ? 'friend' : outgoing.some(request => request.to && request.to.id === id) ? 'outgoing' : incoming.some(request => request.from && request.from.id === id) ? 'incoming' : '';
    const decorate = person => Object.assign({}, person, { label: label(person), initial: initial(person), friendStatus: friendStatus(person.id) });
    const players = room && Array.isArray(room.players) ? room.players.map(player => {
      const ms = result && result.reactions && result.reactions[player.id];
      return Object.assign({}, player, {
        label: label(player), initial: initial(player), mine: player.id === myId,
        friendStatus: friendStatus(player.id),
        colorLabel: player.color === 'red' ? '红方' : '蓝方',
        reactionLabel: typeof ms === 'number' && Number.isFinite(ms) ? ms < 0 ? '抢跑' : Math.round(ms) + ' ms' : '—'
      });
    }) : [];
    const phase = room && room.phase;
    const copy = {
      ready: ['两个人，两部手机。', '红蓝已随机分好，各自准备后开始。'],
      arming: ['正在同步开局', '双方准备完成，请保持小程序在前台。'],
      waiting: ['先别动，等信号。', '看到 GO 或听到提示音，再点自己的按钮。'],
      go: ['GO!', '就是现在，点这里！'],
      settling: ['已收到，等一等。', '正在核对双方的反应时间。'],
      result: ['这一局，见分晓。', '准备好后，可以再来一局。'],
      aborted: ['这一局已中止', '有人离开或连接不稳定，本局不计胜负。']
    }[phase] || ['', ''];
    let resultTitle = '', resultCopy = '';
    if (result) {
      if (result.reason === 'tie') { resultTitle = '几乎同时，平局！'; resultCopy = '两人的反应太接近，再来一次。'; }
      else if (result.reason === 'timeout') { resultTitle = '这一局没有人出手'; resultCopy = '信号后未及时点击，本局不计胜负。'; }
      else if (result.reason === 'aborted' || phase === 'aborted') { resultTitle = '这一局已中止'; resultCopy = '本局不计胜负，返回大厅可重新邀请。'; }
      else {
        resultTitle = result.winnerId === myId ? '这一局，你赢了！' : '差一点点，再来一局。';
        resultCopy = result.reason === 'false_start' ? result.winnerId === myId ? '对方抢跑了。记住，要等 GO 信号。' : '你抢跑了，下次等到 GO 再点。' : '按双方在各自手机上的反应时间判定。';
      }
      if (typeof result.message === 'string' && result.message) resultCopy = result.message;
    }
    const invitation = state.invitation;
    const peer = invitation && (invitation.direction === 'incoming' ? invitation.from : invitation.to);
    const users = (state.users || []).filter(user => user.id !== myId).map(decorate);
    const shareInvite = state.shareInvite || null;
    const shareIsOwner = !!shareInvite && shareInvite.owner.id === myId;
    const sharePeer = shareInvite && (shareIsOwner ? shareInvite.guest : shareInvite.owner);
    const seconds = Math.max(0, Math.ceil(Number(state.shareRemainingSeconds) || 0));
    const shareCountdown = seconds ? Math.floor(seconds / 60) + ':' + ('0' + seconds % 60).slice(-2) : '';
    if (shareInvite && shareInvite.code === this._pendingCode && (shareIsOwner || shareInvite.guest && shareInvite.guest.id === myId)) this._pendingCode = '';
    const connectionLabel = { idle: '未连接', connecting: '正在连接', syncing: '正在校准时间', online: state.syncReady ? '已连接' : '正在校准时间', error: '连接中断', login: '需要登录' }[state.connection] || '正在连接';
    this.setData(Object.assign({}, state, {
      users, players, invitationName: label(peer), resultTitle, resultCopy,
      shareInvite, shareIsOwner, sharePeerName: label(sharePeer), shareCountdown,
      friends: friends.map(decorate), friendRequests: {
        incoming: incoming.map(request => Object.assign({}, request, { from: decorate(request.from || {}) })),
        outgoing: outgoing.map(request => Object.assign({}, request, { to: decorate(request.to || {}) }))
      }, friendCount: friends.length, incomingCount: incoming.length,
      canCreateCode: state.connection === 'online' && state.syncReady && !room && !invitation && !shareInvite,
      pendingEntryCode: this._pendingCode,
      error: this._entryError || state.error || '',
      phaseTitle: copy[0], phaseCopy: copy[1], connectionLabel,
      userLabel: label(state.user), userInitial: initial(state.user),
      canTap: !!room && !state.tapped && (phase === 'waiting' || phase === 'go'),
      activeRound: ACTIVE_PHASES.indexOf(phase) !== -1,
      roomFinished: phase === 'result' || phase === 'aborted',
      onlineCount: users.length
    }));
    this.maybeJoinPending();
  },

  async runAction(method, value) {
    if (!this._alive || !this._visible || !this._client || this.data.working) return;
    this.setData({ working: true });
    try { return await this._client[method](value); }
    catch (error) { if (this._alive && this._visible) this.setData({ error: error && error.message || '操作未完成，请重试。' }); }
    finally { if (this._alive && this._visible) { this.setData({ working: false }); this.maybeJoinPending(); } }
  },
  maybeJoinPending() {
    if (!this._alive || !this._visible || this._joiningCode || this.data.working || !this._pendingCode || this.data.connection !== 'online' || !this.data.syncReady || this.data.room || this.data.shareInvite || this.data.invitation) return;
    const code = this._pendingCode;
    this._pendingCode = ''; this._joiningCode = true;
    this.setData({ pendingEntryCode: '', inviteCodeInput: code });
    this.runAction('joinCode', code).finally(() => { this._joiningCode = false; });
  },
  codeInput(event) { this._entryError = ''; this.setData({ inviteCodeInput: cleanCode(event.detail.value).slice(0, 8) }); },
  createCode() { this._entryError = ''; return this.runAction('createCode'); },
  joinCode() {
    const code = cleanCode(this.data.inviteCodeInput);
    if (!CODE_PATTERN.test(code)) { this.setData({ error: '请输入 8 位邀请码，不含数字 0、1 或字母 I、O。' }); return; }
    this._entryError = ''; this._pendingCode = code; this.setData({ pendingEntryCode: code });
    if (this.data.connection === 'login') { this.login(); return; }
    this.maybeJoinPending();
  },
  cancelCode() { return this.runAction('cancelCode'); },
  copyCode() {
    const code = this.data.shareInvite && this.data.shareInvite.code;
    if (!CODE_PATTERN.test(code || '') || !wx.setClipboardData) return;
    wx.setClipboardData({ data: code });
  },
  onShareAppMessage() {
    const invitation = this.data.shareInvite;
    const code = invitation && this.data.shareIsOwner && invitation.status === 'waiting' && CODE_PATTERN.test(invitation.code) ? invitation.code : '';
    return {
      title: code ? this.data.userLabel + ' 邀请你来一局反应 PK' : '双人反应挑战 · 两部手机，一起 PK',
      path: '/duel-online/pages/lobby/index' + (code ? '?code=' + encodeURIComponent(code) : '')
    };
  },
  selectList(event) {
    const value = event.currentTarget.dataset.list;
    if (value !== 'online' && value !== 'friends') return;
    this.setData({ activeList: value });
    if (value === 'friends') return this.runAction('refreshFriends');
  },
  refreshFriends() { return this.runAction('refreshFriends'); },
  usernameInput(event) { this.setData({ friendUsername: String(event.detail.value || '').trim().toLowerCase() }); },
  addByUsername() {
    const username = this.data.friendUsername.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{3,23}$/.test(username)) { this.setData({ friendError: '请输入好友的完整账号：4～24 位字母、数字或下划线。' }); return; }
    return this.runAction('requestFriend', { username });
  },
  addFriend(event) {
    const userId = event.currentTarget.dataset.id;
    const incoming = this.data.friendRequests.incoming.find(request => request.from.id === userId);
    if (incoming) return this.runAction('respondFriend', { requestId: incoming.id, accept: true });
    return this.runAction('requestFriend', userId);
  },
  respondFriend(event) { return this.runAction('respondFriend', { requestId: event.currentTarget.dataset.id, accept: event.currentTarget.dataset.accept === true || event.currentTarget.dataset.accept === 'true' }); },
  removeFriend(event) {
    const userId = event.currentTarget.dataset.id;
    if (!wx.showModal) return this.runAction('removeFriend', userId);
    wx.showModal({ title: '移除好友', content: '移除后，你们可以重新发送好友申请。', confirmText: '移除', success: result => { if (result.confirm) this.runAction('removeFriend', userId); } });
  },
  retry() { return this.runAction('connect'); },
  calibrate() { return this.runAction('calibrate'); },
  invite(event) { this._audio.unlock(); return this.runAction('invite', event.currentTarget.dataset.id); },
  accept() { this._audio.unlock(); return this.runAction('accept', this.data.invitation && this.data.invitation.id); },
  decline() { return this.runAction('decline', this.data.invitation && this.data.invitation.id); },
  cancel() { return this.runAction('cancel', this.data.invitation && this.data.invitation.id); },
  ready() { this._audio.unlock(); return this.runAction('ready'); },
  tap() {
    if (!this._alive || !this._visible || !this.data.canTap) return;
    // Capture on touchstart; waiting-phase taps deliberately reach the referee as false starts.
    this._client.tap();
  },
  leave() { return this.runAction('leave'); },
  login() { if (wx.navigateTo) wx.navigateTo({ url: '/pages/account/index' }); },
  back() {
    const fallback = () => { if (wx.redirectTo) wx.redirectTo({ url: '/pages/duel/index' }); };
    if (wx.navigateBack) wx.navigateBack({ delta: 1, fail: fallback }); else fallback();
  },
  toggleSound() {
    const enabled = !this.data.soundEnabled;
    this._audio.unlock(); this._audio.setEnabled(enabled);
    if (!enabled) this._audio.stop();
    this.setData({ soundEnabled: enabled });
    try { wx.setStorageSync(SOUND_KEY, enabled); } catch (_) {}
  },
  testSound() { this._audio.unlock(); this._audio.play('test', 'TOUCH'); }
});
