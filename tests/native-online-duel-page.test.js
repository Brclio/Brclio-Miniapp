'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pageFile = path.resolve(__dirname, '../miniprogram/duel-online/pages/lobby/index.js');
const user = { id: 'me', displayName: '悦创', avatarUrl: '' };
const peer = { id: 'peer', displayName: '对手', avatarUrl: '' };
const online = { connection: 'online', user, users: [user, peer], room: null, invitation: null, syncReady: true, myReady: false, tapped: false, rtt: 42, error: '', notice: '' };

function host(options = {}) {
  let definition, bridge, pendingConnect, pendingAudio, pendingReward, audioOptions;
  const calls = [], sounds = [], wake = [], writes = [], navigations = [], clipboard = [];
  const audio = {
    unlock() { sounds.push(['unlock']); }, play(type) { sounds.push(['play', type]); return options.playFailure !== true; },
    activate() { sounds.push(['activate']); }, deactivate() { sounds.push(['deactivate']); },
    prepare() { sounds.push(['prepare']); return options.pendingAudio ? new Promise(resolve => { pendingAudio = resolve; }) : Promise.resolve(options.audioFailure !== true); },
    stop(cancelPreparation) { sounds.push(['stop']); if (cancelPreparation !== false && pendingAudio) pendingAudio(false); }, dispose() { sounds.push(['dispose']); }, setEnabled(enabled) { sounds.push(['enabled', enabled]); }
  };
  const client = {};
  for (const method of ['connect', 'disconnect', 'dispose', 'calibrate', 'invite', 'accept', 'decline', 'cancel', 'ready', 'tap', 'leave', 'createCode', 'joinCode', 'cancelCode', 'refreshFriends', 'requestFriend', 'respondFriend', 'removeFriend', 'setReward', 'randomReward']) {
    client[method] = value => {
      calls.push([method, structuredClone(value)]);
      if (method === 'connect' && options.pendingConnect) return new Promise(resolve => { pendingConnect = resolve; });
      if (method === 'connect') bridge.onChange(options.state || online);
      if (method === 'disconnect') bridge.onSound('stop');
      if (['setReward', 'randomReward'].includes(method) && options.pendingReward) return new Promise(resolve => { pendingReward = resolve; });
    };
  }
  vm.runInNewContext(fs.readFileSync(pageFile, 'utf8'), {
    Page(value) { definition = value; },
    require(id) {
      if (id === '../../../lib/online-duel') return { createOnlineDuel(value) { bridge = value; return client; } };
      if (id === '../../../lib/online-duel-audio') return { createOnlineDuelAudio(api, value) { audioOptions = value; return audio; } };
      if (id === '../../../lib/ready-go-data') return require('../miniprogram/lib/ready-go-data');
      if (id === '../../../lib/account-sync') return { storage: { getStorageSync() { return options.sound; }, setStorageSync(key, value) { writes.push([key, value]); } } };
      throw new Error('Unexpected import: ' + id);
    },
    wx: {
      getStorageSync() { return options.onlineSound; }, setStorageSync(key, value) { writes.push([key, value]); },
      setClipboardData(value) { clipboard.push(value.data); }, showShareMenu() {},
      showModal(value) { value.success({ confirm: options.confirmRemove !== false }); },
      setKeepScreenOn(value) { wake.push(value.keepScreenOn); },
      navigateTo(value) { navigations.push(value.url); }, navigateBack(value) { navigations.push('back'); if (options.backFail) value.fail(); },
      redirectTo(value) { navigations.push(value.url); }
    }
  }, { filename: pageFile });
  const page = Object.assign({}, definition, { data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } });
  page.onLoad({ code: options.code });
  return { page, calls, sounds, wake, writes, navigations, clipboard, emit: state => bridge.onChange(state), sound: type => bridge.onSound(type), resolveConnect() { pendingConnect(); }, resolveAudio(value) { pendingAudio(value); }, resolveReward(value) { pendingReward(value); }, audioFailure(message) { audioOptions.onFailure(message); } };
}

test('online page enters on show, leaves on hide and ignores late state/audio while hidden or unloaded', async () => {
  const h = host({ pendingConnect: true }), p = h.page;
  p.onShow();
  assert.equal(h.calls[0][0], 'connect');
  h.emit(online);
  p.onHide();
  assert.equal(h.calls.at(-1)[0], 'disconnect');
  assert.equal(h.wake.at(-1), false);
  const prior = JSON.stringify(p.data);
  h.emit({ ...online, notice: '迟到响应', users: [] });
  h.sound('go');
  assert.equal(JSON.stringify(p.data), prior);
  assert.equal(h.sounds.some(call => call[0] === 'play'), false);
  h.resolveConnect(); await Promise.resolve();
  p.onUnload();
  assert.equal(h.calls.at(-1)[0], 'dispose', 'unloading must release the account subscription');
  h.emit({ ...online, notice: '已卸载' });
  assert.equal(JSON.stringify(p.data), prior);
  assert.equal(h.sounds.at(-1)[0], 'dispose');
});

test('deep-link invitation survives login and joins once only after connection calibration', async () => {
  const options = { code: 'abcd-2345', state: { ...online, connection: 'login', user: null, syncReady: false } };
  const h = host(options), p = h.page; p.onShow(); await Promise.resolve();
  assert.equal(p.data.pendingEntryCode, 'ABCD2345');
  assert.equal(h.calls.some(call => call[0] === 'joinCode'), false);
  p.login(); p.onHide(); options.state = { ...online, syncReady: false }; p.onShow(); await Promise.resolve();
  assert.equal(h.calls.some(call => call[0] === 'joinCode'), false);
  h.emit(online); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(h.calls.filter(call => call[0] === 'joinCode'), [['joinCode', 'ABCD2345']]);
  h.emit(online); await Promise.resolve();
  assert.equal(h.calls.filter(call => call[0] === 'joinCode').length, 1);
  assert.equal(p.data.pendingEntryCode, ''); p.onUnload();
});

test('sharing and copying use the already-created code and never mutate a room from the share handler', async () => {
  const h = host(), p = h.page; p.onShow(); await Promise.resolve();
  await p.createCode(); assert.equal(h.calls.at(-1)[0], 'createCode');
  h.emit({ ...online, shareInvite: { code: 'ABCD2345', owner: user, guest: null, status: 'waiting', expiresAt: 1800000600000, ownerOnline: true, guestOnline: false }, shareRemainingSeconds: 590 });
  assert.equal(p.data.shareCountdown, '9:50');
  const callCount = h.calls.length, share = p.onShareAppMessage();
  assert.equal(share.path, '/duel-online/pages/lobby/index?code=ABCD2345');
  assert.equal(h.calls.length, callCount);
  p.copyCode(); assert.deepEqual(h.clipboard, ['ABCD2345']);
  p.onHide(); assert.equal(p.onShareAppMessage().path, share.path, 'sharing can hide the page before the share callback runs');
  p.onShow(); await Promise.resolve();
  assert.equal(p.onShareAppMessage().path, '/duel-online/pages/lobby/index');
  p.onUnload();
});

test('manual code joins reject confusing characters and preserve a valid code while logging in', async () => {
  const h = host(), p = h.page; p.onShow(); await Promise.resolve();
  p.codeInput({ detail: { value: 'ABCD01IO' } }); p.joinCode();
  assert.match(p.data.error, /8 位邀请码/); assert.equal(h.calls.some(call => call[0] === 'joinCode'), false);
  p.codeInput({ detail: { value: 'abcd 2345' } }); p.joinCode(); await Promise.resolve();
  assert.deepEqual(h.calls.filter(call => call[0] === 'joinCode'), [['joinCode', 'ABCD2345']]);
  p.onUnload();
});

test('restored own or reserved invitation does not auto-join its own code again', async () => {
  for (const owner of [true, false]) {
    const shareInvite = { code: 'ABCD2345', owner: owner ? user : peer, guest: owner ? null : user, status: 'waiting', ownerOnline: owner, guestOnline: !owner };
    const h = host({ code: 'ABCD2345', state: { ...online, shareInvite } });
    h.page.onShow(); await Promise.resolve();
    assert.equal(h.calls.some(call => call[0] === 'joinCode'), false);
    assert.equal(h.page.data.shareIsOwner, owner); assert.equal(h.page.data.pendingEntryCode, '');
    h.page.onUnload();
  }
});

test('friend lists retain offline users, expose mutual approval, and refresh only when requested', async () => {
  const offline = { id: 'offline', displayName: '离线朋友', online: false, busy: false };
  const h = host({ state: { ...online, friends: [offline], friendRequests: { incoming: [{ id: 'request-in', from: peer }], outgoing: [{ id: 'request-out', to: { id: 'other', displayName: '另一位' } }] } } }), p = h.page;
  p.onShow(); await Promise.resolve();
  assert.equal(p.data.friendCount, 1); assert.equal(p.data.friends[0].online, false);
  assert.equal(p.data.incomingCount, 1); assert.equal(p.data.users[0].friendStatus, 'incoming');
  assert.equal(h.calls.some(call => call[0] === 'refreshFriends'), false, 'the page must not poll friends independently of its client');
  await p.selectList({ currentTarget: { dataset: { list: 'friends' } } });
  assert.equal(p.data.activeList, 'friends'); assert.equal(h.calls.at(-1)[0], 'refreshFriends');
  await p.addFriend({ currentTarget: { dataset: { id: peer.id } } });
  assert.deepEqual(h.calls.at(-1), ['respondFriend', { requestId: 'request-in', accept: true }]);
  await p.respondFriend({ currentTarget: { dataset: { id: 'request-in', accept: false } } });
  assert.deepEqual(h.calls.at(-1), ['respondFriend', { requestId: 'request-in', accept: false }]);
  p.usernameInput({ detail: { value: ' Brclio ' } }); await p.addByUsername();
  assert.deepEqual(h.calls.at(-1), ['requestFriend', { username: 'brclio' }]);
  p.removeFriend({ currentTarget: { dataset: { id: offline.id } } }); await Promise.resolve();
  assert.deepEqual(h.calls.at(-1), ['removeFriend', offline.id]); p.onUnload();
});

test('canceling friend removal leaves the friendship untouched', async () => {
  const h = host({ confirmRemove: false }), p = h.page; p.onShow(); await Promise.resolve();
  p.removeFriend({ currentTarget: { dataset: { id: peer.id } } });
  assert.equal(h.calls.some(call => call[0] === 'removeFriend'), false); p.onUnload();
});

test('opening a shared invite as the first page can return to the original local duel', () => {
  const h = host({ backFail: true, code: 'ABCD2345' });
  h.page.back(); assert.deepEqual(h.navigations, ['back', '/pages/duel/index']); h.page.onUnload();
});

test('own target forwards early touches for false-start judging and blocks ready, settled and repeated touches', async () => {
  const h = host(), p = h.page; p.onShow(); await Promise.resolve();
  const room = { id: 'room', phase: 'ready', players: [{ ...user, color: 'red', ready: false }, { ...peer, color: 'blue', ready: true }] };
  h.emit({ ...online, room, myColor: 'red' }); p.tap();
  assert.equal(h.calls.filter(call => call[0] === 'tap').length, 0);
  h.emit({ ...online, room: { ...room, phase: 'waiting' }, myColor: 'red' }); p.tap();
  assert.equal(h.calls.filter(call => call[0] === 'tap').length, 1, 'waiting taps must reach the referee');
  h.emit({ ...online, room: { ...room, phase: 'go' }, myColor: 'red', tapped: true }); p.tap();
  h.emit({ ...online, room: { ...room, phase: 'settling' }, myColor: 'red' }); p.tap();
  assert.equal(h.calls.filter(call => call[0] === 'tap').length, 1);
  assert.equal(p.data.players.length, 2);
  assert.equal(p.data.players[0].mine, true);
  assert.equal(p.data.players[1].mine, false);
  p.onUnload();
});

test('results show each reaction and distinguish tie, timeout, false start and aborted rounds', async () => {
  const h = host(), p = h.page; p.onShow(); await Promise.resolve();
  const room = { id: 'r', phase: 'result', players: [{ ...user, color: 'blue' }, { ...peer, color: 'red' }], result: { winnerId: 'me', reason: 'reaction', reactions: { me: 234.2, peer: 281 } } };
  h.emit({ ...online, room });
  assert.equal(p.data.players[0].reactionLabel, '234 ms');
  assert.equal(p.data.players[1].reactionLabel, '281 ms');
  assert.match(p.data.resultTitle, /你赢了/);
  for (const [reason, title] of [['tie', /平局/], ['timeout', /没有人出手/], ['false_start', /你赢了/], ['aborted', /中止/]]) {
    h.emit({ ...online, room: { ...room, result: { ...room.result, reason } } });
    assert.match(p.data.resultTitle, title);
  }
  h.emit({ ...online, room: { ...room, phase: 'aborted', result: null } });
  assert.equal(p.data.roomFinished, true);
  assert.match(p.data.phaseCopy, /不计胜负/);
  p.onUnload();
});

test('lobby invitations use peer ids, login returns to existing account screen, and online sound never changes the local game setting', async () => {
  const h = host({ onlineSound: false }), p = h.page; p.onShow(); await Promise.resolve();
  assert.equal(p.data.soundEnabled, false);
  assert.equal(h.writes.length, 0);
  assert.equal(p.data.onlineCount, 1);
  assert.equal(p.data.users[0].id, peer.id);
  await p.invite({ currentTarget: { dataset: { id: peer.id } } });
  assert.deepEqual(h.calls.at(-1), ['invite', peer.id]);
  h.emit({ ...online, invitation: { id: 'invite', from: peer, to: user, direction: 'incoming' } });
  assert.equal(p.data.invitationName, peer.displayName);
  await p.accept(); assert.deepEqual(h.calls.at(-1), ['accept', 'invite']);
  p.toggleSound();
  assert.deepEqual(h.writes, [['brclio.online-duel.sound.v1', true]]);
  h.sound('go'); assert.deepEqual(h.sounds.at(-1), ['play', 'go']);
  h.sound('stop'); assert.deepEqual(h.sounds.at(-1), ['stop']);
  p.login(); assert.deepEqual(h.navigations, ['/pages/account/index']);
  await p.calibrate(); assert.equal(h.calls.at(-1)[0], 'calibrate');
  p.onUnload();
});

test('online audio starts enabled independently of a muted original game and respects its own saved mute', async () => {
  const fresh = host({ sound: false }); fresh.page.onShow(); await Promise.resolve();
  assert.equal(fresh.page.data.soundEnabled, true, 'the original game mute is not an online preference');
  assert.equal(fresh.writes.length, 0);
  fresh.page.onUnload();
  const saved = host({ sound: true, onlineSound: false }); saved.page.onShow(); await Promise.resolve();
  assert.equal(saved.page.data.soundEnabled, false); assert.equal(saved.writes.length, 0);
  saved.page.onUnload();
});

test('each phone waits for its own audio readiness and peer state updates cannot cancel it', async () => {
  const phones = [host({ pendingAudio: true }), host({ pendingAudio: true })];
  const pending = [];
  for (const h of phones) {
    h.page.onShow(); await Promise.resolve();
    h.emit({ ...online, room: { id: 'ready-room', phase: 'ready', players: [user, peer] } });
    pending.push(h.page.ready());
    assert.equal(h.page.data.audioPreparing, true);
    assert.equal(h.calls.some(call => call[0] === 'ready'), false);
    h.sound('stop');
    assert.equal(h.calls.some(call => call[0] === 'ready'), false);
    h.resolveAudio(true);
  }
  await Promise.all(pending);
  for (const h of phones) {
    assert.equal(h.calls.filter(call => call[0] === 'ready').length, 1);
    assert.equal(h.page.data.audioPreparing, false);
    assert.equal(h.sound('start'), true); assert.equal(h.sound('go'), true);
    assert.deepEqual(h.sounds.filter(call => call[0] === 'play'), [['play', 'start'], ['play', 'go']]);
    h.page.onUnload();
  }
});

test('audio failure keeps the player unready with an actionable error that state refreshes cannot hide', async () => {
  const h = host({ audioFailure: true }); h.page.onShow(); await Promise.resolve();
  h.emit({ ...online, room: { id: 'r', phase: 'ready', players: [user, peer] } });
  await h.page.ready();
  assert.equal(h.calls.some(call => call[0] === 'ready'), false);
  assert.match(h.page.data.error, /提示音.*准备好/); assert.equal(h.page.data.working, false);
  h.emit({ ...online, room: { id: 'r', phase: 'ready', players: [user, peer] }, notice: '同步完成' });
  assert.match(h.page.data.error, /提示音.*准备好/);
  h.page.onUnload();
});

test('a preparation completed after hide, return or a room change cannot ready a new session', async () => {
  const h = host({ pendingAudio: true }); h.page.onShow(); await Promise.resolve();
  const room = { id: 'r', phase: 'ready', players: [user, peer] };
  h.emit({ ...online, room }); const previous = h.page.ready();
  h.page.onHide(); h.page.onShow(); await Promise.resolve();
  h.emit({ ...online, room }); h.resolveAudio(true); await previous;
  assert.equal(h.calls.some(call => call[0] === 'ready'), false);
  const next = h.page.ready();
  h.emit({ ...online, room: { ...room, id: 'other' } }); h.resolveAudio(true); await next;
  assert.equal(h.calls.some(call => call[0] === 'ready'), false);
  h.page.onUnload();
});

test('an asynchronous audio interruption aborts an active round while hidden errors are ignored', async () => {
  const h = host(); h.page.onShow(); await Promise.resolve();
  h.emit({ ...online, room: { id: 'r', phase: 'waiting', players: [user, peer] } });
  h.audioFailure('手机提示音播放中断，请试听成功后重新准备。');
  assert.equal(h.calls.filter(call => call[0] === 'leave').length, 1);
  assert.match(h.page.data.error, /提示音播放中断/);
  h.page.onHide(); const previous = h.page.data.error;
  h.audioFailure('迟到的音频错误'); assert.equal(h.page.data.error, previous);
  h.page.onUnload();
});

test('reconnecting state is visible and synchronous sound failure reaches the transport', async () => {
  const h = host({ playFailure: true }); h.page.onShow(); await Promise.resolve();
  h.emit({ ...online, connection: 'reconnecting', syncReady: false, users: [] });
  assert.equal(h.page.data.connectionLabel, '正在自动重连');
  assert.equal(h.page.data.canCreateCode, false);
  assert.equal(h.sound('start'), false);
  assert.equal(h.sound('stop'), true);
  h.page.onUnload();
});

const rewardRoom = (overrides = {}) => ({ id: 'reward-room', phase: 'ready', players: [{ ...user, color: 'blue' }, { ...peer, color: 'red' }],
  rewards: { me: { text: '', mode: 'none', category: '' }, peer: { text: '请喝一杯奶茶', mode: 'custom', category: '' } }, rewardRevision: 1, ...overrides });

test('both agreed rewards are visible, own draft survives peer updates and must be saved before ready', async () => {
  const h = host({ pendingReward: true }), p = h.page; p.onShow(); await Promise.resolve();
  let room = rewardRoom(); h.emit({ ...online, room });
  assert.equal(p.data.canEditRewards, true);
  assert.equal(p.data.rewardPlayers[0].text, '这局不设彩头'); assert.equal(p.data.rewardPlayers[1].text, '请喝一杯奶茶');
  p.rewardInput({ detail: { value: '  免洗碗一天  ' } });
  assert.equal(p.data.rewardDraftDirty, true); await p.ready();
  assert.equal(h.calls.some(call => call[0] === 'ready'), false); assert.match(p.data.error, /还没保存/);
  room = rewardRoom({ rewardRevision: 2, rewards: { ...room.rewards, peer: { text: '一起看一部电影', mode: 'random', category: 'LOVE' } } });
  h.emit({ ...online, room });
  assert.equal(p.data.rewardDraft, '  免洗碗一天  '); assert.equal(p.data.rewardPlayers[1].text, '一起看一部电影');
  const saved = p.saveReward(); assert.deepEqual(h.calls.at(-1), ['setReward', '免洗碗一天']);
  assert.equal(p.data.rewardPending, true); assert.equal(p.data.working, true); await p.ready();
  assert.equal(h.calls.some(call => call[0] === 'ready'), false, 'server acknowledgement is required before ready');
  room = rewardRoom({ rewardRevision: 3, rewards: { ...room.rewards, me: { text: '免洗碗一天', mode: 'custom', category: '' } } });
  h.emit({ ...online, room }); h.resolveReward(true); await saved;
  assert.equal(p.data.rewardPending, false); assert.equal(p.data.rewardDraft, '免洗碗一天'); assert.equal(p.data.rewardDraftDirty, false);
  await p.ready(); assert.deepEqual(h.calls.at(-1), ['ready', 3]);
  assert.deepEqual(h.writes, [], 'online rewards must not change original game preferences'); p.onUnload();
});

test('random categories reuse the original library; random and clear wait for the server without editing the peer', async () => {
  const h = host({ pendingReward: true }), p = h.page; p.onShow(); await Promise.resolve();
  let room = rewardRoom(); h.emit({ ...online, room });
  assert.deepEqual(Array.from(p.data.rewardCategories, category => category.key), ['ALL', 'FOOD', 'CHORES', 'PRANK', 'LOVE', 'MONEY']);
  p.selectRewardCategory({ detail: { value: '1' } });
  const random = p.randomReward(); assert.deepEqual(h.calls.at(-1), ['randomReward', 'FOOD']);
  room = rewardRoom({ rewardRevision: 2, rewards: { ...room.rewards, me: { text: '请喝超大杯奶茶', mode: 'random', category: 'FOOD' } } });
  h.emit({ ...online, room }); h.resolveReward(true); await random;
  assert.equal(p.data.ownReward, '请喝超大杯奶茶'); assert.equal(p.data.rewardDraft, '请喝超大杯奶茶');
  const cleared = p.clearReward(); assert.deepEqual(h.calls.at(-1), ['setReward', '']);
  h.emit({ ...online, room: rewardRoom({ rewardRevision: 3 }) }); h.resolveReward(true); await cleared;
  assert.equal(p.data.ownReward, ''); assert.equal(p.data.rewardDraft, ''); assert.equal(p.data.rewardPlayers[1].text, '请喝一杯奶茶');
  p.onUnload();
});

test('active rewards cannot be edited and failed reward acknowledgement keeps the draft for retry', async () => {
  const h = host({ pendingReward: true }), p = h.page; p.onShow(); await Promise.resolve();
  h.emit({ ...online, room: rewardRoom() }); p.rewardInput({ detail: { value: '指定彩头' } });
  const saving = p.saveReward(); h.resolveReward(false); await saving;
  assert.equal(p.data.rewardPending, false); assert.equal(p.data.rewardDraft, '指定彩头'); assert.equal(p.data.rewardDraftDirty, true);
  h.emit({ ...online, room: rewardRoom({ phase: 'waiting' }) });
  const count = h.calls.length; p.rewardInput({ detail: { value: '不能改' } }); await p.saveReward(); await p.randomReward(); await p.clearReward();
  assert.equal(h.calls.length, count); assert.equal(p.data.canEditRewards, false); assert.equal(p.data.rewardDraft, '指定彩头');
  p.onUnload();
});

test('a peer changing the agreement during audio preparation requires a fresh explicit ready', async () => {
  const h = host({ pendingAudio: true }), p = h.page; p.onShow(); await Promise.resolve();
  h.emit({ ...online, room: rewardRoom() }); const preparation = p.ready();
  h.emit({ ...online, room: rewardRoom({ rewardRevision: 2 }) }); h.resolveAudio(true); await preparation;
  assert.equal(h.calls.some(call => call[0] === 'ready'), false); assert.match(p.data.error, /彩头已更新/);
  const renewed = p.ready(); h.resolveAudio(true); await renewed;
  assert.deepEqual(h.calls.at(-1), ['ready', 2]); p.onUnload();
});

test('result reward uses the winning round snapshot and cannot change when next-round selections are edited', async () => {
  const h = host(), p = h.page; p.onShow(); await Promise.resolve();
  const result = { winnerId: user.id, reason: 'reaction', reward: '这一局约定的奶茶', rewardOwnerId: user.id, reactions: { me: 200, peer: 300 } };
  const room = rewardRoom({ phase: 'result', result }); h.emit({ ...online, room });
  assert.equal(p.data.winnerReward, result.reward); assert.equal(p.data.winnerRewardLabel, '你赢得的彩头');
  h.emit({ ...online, room: { ...room, rewardRevision: 2, rewards: { ...room.rewards, me: { text: '下一局免洗碗', mode: 'custom', category: '' } } } });
  assert.equal(p.data.winnerReward, result.reward);
  for (const reason of ['tie', 'timeout', 'aborted']) {
    h.emit({ ...online, room: { ...room, result: { ...result, reason } } }); assert.equal(p.data.winnerReward, '');
  }
  p.onUnload();
});

test('reward draft resets for a new room and late acknowledgement after leaving cannot change the page', async () => {
  const h = host({ pendingReward: true }), p = h.page; p.onShow(); await Promise.resolve();
  h.emit({ ...online, room: rewardRoom() }); p.rewardInput({ detail: { value: '临时草稿' } });
  h.emit({ ...online, room: rewardRoom({ id: 'another-room' }) }); assert.equal(p.data.rewardDraft, '');
  p.rewardInput({ detail: { value: '保存中的彩头' } }); const pending = p.saveReward(); p.onHide();
  const before = JSON.stringify(p.data); h.resolveReward(true); await pending;
  assert.equal(JSON.stringify(p.data), before); p.onUnload();
});
