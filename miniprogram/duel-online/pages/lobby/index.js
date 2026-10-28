'use strict';

const { createOnlineDuel } = require('../../../lib/online-duel');
const { createOnlineDuelAudio } = require('../../../lib/online-duel-audio');
const { CATEGORY_LABELS } = require('../../../lib/ready-go-data');
const SOUND_KEY = 'brclio.online-duel.sound.v1';
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;
const cleanCode = value => String(value || '').replace(/[\s-]/g, '').toUpperCase();

const ACTIVE_PHASES = ['arming', 'waiting', 'go', 'settling'];
const label = user => user && (user.displayName || user.username) || '挑战玩家';
const initial = user => label(user).slice(0, 1).toUpperCase();
const REWARD_CATEGORIES = Object.keys(CATEGORY_LABELS).filter(key => key !== 'CUSTOM').map(key => ({ key, label: CATEGORY_LABELS[key] }));
const rewardText = value => typeof value === 'string' ? value : value && typeof value.text === 'string' ? value.text : '';
const rewardRevision = room => room && Number.isSafeInteger(room.rewardRevision) ? room.rewardRevision : 0;

Page({
  data: {
    connection: 'idle', user: null, users: [], invitation: null, room: null,
    myColor: '', myReady: false, tapped: false, syncReady: false,
    rtt: 0, uncertainty: 0, error: '', notice: '', remainingSeconds: 0,
    soundEnabled: true, audioPreparing: false, working: false, players: [], invitationName: '',
    resultTitle: '', resultCopy: '', phaseTitle: '', phaseCopy: '',
    connectionLabel: '正在连接', userLabel: '', userInitial: '',
    canTap: false, activeRound: false, roomFinished: false, onlineCount: 0,
    shareInvite: null, shareRemainingSeconds: 0, shareIsOwner: false, sharePeerName: '', shareCountdown: '',
    inviteCodeInput: '', pendingEntryCode: '', activeList: 'online', friendUsername: '',
    friends: [], friendRequests: { incoming: [], outgoing: [] }, friendsLoading: false, friendError: '',
    friendCount: 0, incomingCount: 0, canCreateCode: false,
    rewardCategories: REWARD_CATEGORIES, rewardCategoryIndex: 0, rewardCategoryLabel: REWARD_CATEGORIES[0].label,
    rewardDraft: '', rewardDraftDirty: false, rewardPending: false, ownReward: '', canEditRewards: false,
    rewardPlayers: [], winnerReward: '', winnerRewardLabel: ''
  },

  onLoad(options) {
    this._alive = true;
    this._visible = false;
    this._audioGeneration = 0;
    this._rewardRoomId = ''; this._rewardOwnValue = ''; this._rewardDraftVersion = 0; this._rewardSubmission = null;
    this._rewardError = '';
    const code = cleanCode(options && options.code);
    this._pendingCode = CODE_PATTERN.test(code) ? code : '';
    this._joiningCode = false;
    if (code && !this._pendingCode) this._entryError = '邀请链接中的邀请码无效，请向好友确认。';
    this.setData({ inviteCodeInput: this._pendingCode, pendingEntryCode: this._pendingCode });
    this._audioError = '';
    this._audio = createOnlineDuelAudio(wx, {
      enabled: true, assetBase: '/assets/duel-audio',
      onFailure: message => {
        if (!this._alive || !this._visible) return;
        this._audioError = message;
        if (this.data.activeRound && this._client) this._client.leave();
        this.setData({ error: message });
      }
    });
    this._client = createOnlineDuel({
      onChange: state => this.applyState(state),
      onSound: type => {
        if (type === 'stop') { this._audio.stop(false); return true; }
        if (!this._alive || !this._visible) return false;
        return this._audio.play(type);
      }
    });
    if (wx.showShareMenu) wx.showShareMenu({ menus: ['shareAppMessage'] });
  },

  onShow() {
    if (!this._alive) return;
    this._audioGeneration += 1;
    this._visible = true;
    let enabled = true;
    try {
      const saved = wx.getStorageSync(SOUND_KEY);
      if (typeof saved === 'boolean') enabled = saved;
    } catch (_) {}
    this.setData({ soundEnabled: enabled, working: false, audioPreparing: false });
    this._audio.setEnabled(enabled);
    this._audio.activate();
    if (wx.setKeepScreenOn) wx.setKeepScreenOn({ keepScreenOn: true });
    this.runAction('connect');
  },

  onHide() {
    this._audioGeneration += 1;
    this._rewardSubmission = null;
    this._visible = false;
    if (this._client) this._client.disconnect();
    if (this._audio) this._audio.deactivate();
    if (wx.setKeepScreenOn) wx.setKeepScreenOn({ keepScreenOn: false });
  },

  onUnload() {
    this._audioGeneration += 1;
    this._rewardSubmission = null;
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
    const editableRewardPhase = ['ready', 'result', 'aborted'].indexOf(phase) !== -1;
    const ownReward = rewardText(room && room.rewards && room.rewards[myId]);
    const ownValue = JSON.stringify(room && room.rewards && room.rewards[myId] || { text: '', mode: 'none', category: '' });
    const roomId = room && room.id || '';
    let rewardDraft = this.data.rewardDraft;
    let rewardDraftDirty = this.data.rewardDraftDirty;
    if (roomId !== this._rewardRoomId) {
      this._rewardRoomId = roomId; this._rewardDraftVersion = 0; this._rewardSubmission = null; this._rewardError = '';
      rewardDraft = ownReward; rewardDraftDirty = false;
    } else if (ownValue !== this._rewardOwnValue) {
      const submission = this._rewardSubmission;
      if (!rewardDraftDirty || submission && submission.draftVersion === this._rewardDraftVersion) {
        rewardDraft = ownReward; rewardDraftDirty = false;
      }
    }
    this._rewardOwnValue = ownValue;
    if (state.error || !editableRewardPhase || state.connection !== 'online') this._rewardSubmission = null;
    const rewardPlayers = players.map(player => {
      const descriptor = (ACTIVE_PHASES.indexOf(phase) !== -1 ? room.roundRewards || room.rewards : room.rewards) || {};
      const reward = descriptor[player.id];
      return { id: player.id, label: player.mine ? '我赢了想要' : player.label + '赢了想要', color: player.color,
        text: rewardText(reward) || '这局不设彩头', empty: !rewardText(reward),
        modeLabel: reward && reward.mode === 'random' ? '随机' : rewardText(reward) ? '指定' : '' };
    });
    const winnerReward = result && result.winnerId && ['reaction', 'false_start'].indexOf(result.reason) !== -1 ? rewardText(result.reward) : '';
    const winningPlayer = result && players.find(player => player.id === result.winnerId);
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
    const connectionLabel = { idle: '未连接', connecting: '正在连接', reconnecting: '正在自动重连', syncing: '正在校准时间', online: state.syncReady ? '已连接' : '正在校准时间', error: '连接中断', login: '需要登录' }[state.connection] || '正在连接';
    this.setData(Object.assign({}, state, {
      users, players, invitationName: label(peer), resultTitle, resultCopy,
      rewardDraft, rewardDraftDirty, ownReward, rewardPlayers, rewardPending: !!this._rewardSubmission,
      canEditRewards: state.connection === 'online' && editableRewardPhase,
      winnerReward, winnerRewardLabel: winnerReward ? winningPlayer && winningPlayer.mine ? '你赢得的彩头' : label(winningPlayer) + '赢得的彩头' : '',
      shareInvite, shareIsOwner, sharePeerName: label(sharePeer), shareCountdown,
      friends: friends.map(decorate), friendRequests: {
        incoming: incoming.map(request => Object.assign({}, request, { from: decorate(request.from || {}) })),
        outgoing: outgoing.map(request => Object.assign({}, request, { to: decorate(request.to || {}) }))
      }, friendCount: friends.length, incomingCount: incoming.length,
      canCreateCode: state.connection === 'online' && state.syncReady && !room && !invitation && !shareInvite,
      pendingEntryCode: this._pendingCode,
      error: this._entryError || this._rewardError || this._audioError || state.error || '',
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
  rewardInput(event) {
    if (!this._alive || !this._visible || !this.data.canEditRewards || this.data.working || this.data.rewardPending) return;
    const value = Array.from(String(event.detail.value || '')).slice(0, 80).join('');
    this._rewardDraftVersion += 1; this._rewardError = '';
    this.setData({ rewardDraft: value, rewardDraftDirty: value.trim() !== this.data.ownReward, error: '' });
  },
  selectRewardCategory(event) {
    if (this.data.working || this.data.rewardPending || !this.data.canEditRewards) return;
    const index = Number(event.detail.value);
    if (!Number.isInteger(index) || !REWARD_CATEGORIES[index]) return;
    this.setData({ rewardCategoryIndex: index, rewardCategoryLabel: REWARD_CATEGORIES[index].label });
  },
  async submitReward(method, value) {
    if (!this._alive || !this._visible || !this.data.canEditRewards || this.data.working || this.data.rewardPending) return;
    this._rewardError = '';
    const submission = { draftVersion: this._rewardDraftVersion, roomId: this.data.room.id };
    this._rewardSubmission = submission;
    this.setData({ rewardPending: true, error: '' });
    try {
      const result = await this.runAction(method, value);
      if (result === true && this._alive && this._visible && this._rewardSubmission === submission && this.data.room && this.data.room.id === submission.roomId) {
        this.setData({ rewardDraft: this.data.ownReward, rewardDraftDirty: false });
      }
      return result;
    } finally {
      if (this._rewardSubmission === submission) {
        this._rewardSubmission = null;
        if (this._alive && this._visible) this.setData({ rewardPending: false });
      }
    }
  },
  saveReward() {
    if (!this.data.rewardDraftDirty) return;
    return this.submitReward('setReward', this.data.rewardDraft.trim());
  },
  randomReward() { return this.submitReward('randomReward', REWARD_CATEGORIES[this.data.rewardCategoryIndex].key); },
  clearReward() {
    if (!this._alive || !this._visible || !this.data.canEditRewards || this.data.working || this.data.rewardPending) return;
    if (!this.data.ownReward) {
      this._rewardDraftVersion += 1; this._rewardError = '';
      this.setData({ rewardDraft: '', rewardDraftDirty: false, error: '' }); return;
    }
    return this.submitReward('setReward', '');
  },
  async ready() {
    if (!this._alive || !this._visible || this.data.working || !this.data.room || !['ready', 'result', 'aborted'].includes(this.data.room.phase) || this.data.myReady) return;
    if (this.data.rewardDraftDirty || this.data.rewardPending) {
      this._rewardError = this.data.rewardPending ? '彩头正在同步，稍等双方确认后再准备。' : '彩头还没保存，请先保存或清空后再准备。';
      this.setData({ error: this._rewardError }); return;
    }
    const roomId = this.data.room.id;
    const expectedRewardRevision = rewardRevision(this.data.room);
    const audioGeneration = this._audioGeneration;
    this._audioError = '';
    this.setData({ working: true, audioPreparing: this.data.soundEnabled, error: '' });
    try {
      const prepared = await this._audio.prepare();
      if (!this._alive || !this._visible || audioGeneration !== this._audioGeneration || !this.data.room || this.data.room.id !== roomId || !['ready', 'result', 'aborted'].includes(this.data.room.phase) || this.data.connection !== 'online') return;
      if (rewardRevision(this.data.room) !== expectedRewardRevision) {
        this._rewardError = '彩头已更新，请看过双方的新约定后重新准备。';
        this.setData({ error: this._rewardError }); return;
      }
      if (!prepared && this.data.soundEnabled) {
        this._audioError = '提示音还没有准备好，请试听成功后再点准备。';
        this.setData({ error: this._audioError }); return;
      }
      this._rewardError = '';
      return await this._client.ready(expectedRewardRevision);
    } catch (_) {
      if (this._alive && this._visible && audioGeneration === this._audioGeneration) { this._audioError = '提示音准备失败，请试听后重试。'; this.setData({ error: this._audioError }); }
    } finally {
      if (this._alive && this._visible && audioGeneration === this._audioGeneration) this.setData({ working: false, audioPreparing: false });
    }
  },
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
    this._audioError = '';
    this._audio.unlock(); this._audio.setEnabled(enabled);
    if (!enabled) this._audio.stop();
    this.setData({ soundEnabled: enabled, error: '' });
    try { wx.setStorageSync(SOUND_KEY, enabled); } catch (_) {}
  },
  async testSound() {
    if (!this._alive || !this._visible) return;
    const audioGeneration = this._audioGeneration;
    this._audioError = '';
    const prepared = await this._audio.prepare();
    if (!this._alive || !this._visible || audioGeneration !== this._audioGeneration) return;
    if (!prepared || !this._audio.play('test')) { this._audioError = '手机提示音暂时无法播放，请检查媒体音量后重试。'; }
    this.setData({ error: this._audioError });
  }
});
