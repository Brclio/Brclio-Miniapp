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
  let definition, bridge, pendingConnect;
  const calls = [], sounds = [], wake = [], writes = [], navigations = [], clipboard = [];
  const audio = {
    unlock() { sounds.push(['unlock']); }, play(type) { sounds.push(['play', type]); },
    stop() { sounds.push(['stop']); }, dispose() { sounds.push(['dispose']); }, setEnabled(enabled) { sounds.push(['enabled', enabled]); }
  };
  const client = {};
  for (const method of ['connect', 'disconnect', 'dispose', 'calibrate', 'invite', 'accept', 'decline', 'cancel', 'ready', 'tap', 'leave', 'createCode', 'joinCode', 'cancelCode', 'refreshFriends', 'requestFriend', 'respondFriend', 'removeFriend']) {
    client[method] = value => {
      calls.push([method, structuredClone(value)]);
      if (method === 'connect' && options.pendingConnect) return new Promise(resolve => { pendingConnect = resolve; });
      if (method === 'connect') bridge.onChange(options.state || online);
      if (method === 'disconnect') bridge.onSound('stop');
    };
  }
  vm.runInNewContext(fs.readFileSync(pageFile, 'utf8'), {
    Page(value) { definition = value; },
    require(id) {
      if (id === '../../../lib/online-duel') return { createOnlineDuel(value) { bridge = value; return client; } };
      if (id === '../../../lib/duel') return { createDuelAudio() { return audio; } };
      if (id === '../../../lib/account-sync') return { storage: { getStorageSync() { return options.sound; }, setStorageSync(key, value) { writes.push([key, value]); } } };
      throw new Error('Unexpected import: ' + id);
    },
    wx: {
      getStorageSync() {}, setStorageSync(key, value) { writes.push([key, value]); },
      setClipboardData(value) { clipboard.push(value.data); }, showShareMenu() {},
      showModal(value) { value.success({ confirm: options.confirmRemove !== false }); },
      setKeepScreenOn(value) { wake.push(value.keepScreenOn); },
      navigateTo(value) { navigations.push(value.url); }, navigateBack(value) { navigations.push('back'); if (options.backFail) value.fail(); },
      redirectTo(value) { navigations.push(value.url); }
    }
  }, { filename: pageFile });
  const page = Object.assign({}, definition, { data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } });
  page.onLoad({ code: options.code });
  return { page, calls, sounds, wake, writes, navigations, clipboard, emit: state => bridge.onChange(state), sound: type => bridge.onSound(type), resolveConnect() { pendingConnect(); } };
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
  const h = host({ sound: false }), p = h.page; p.onShow(); await Promise.resolve();
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
