'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const ROOT = path.resolve(__dirname, '..');
const { duelGitHubFixture } = require('./helpers/duel-github.cjs');
const SECRET = 'test-only-online-duel-secret-at-least-32-characters';

test('real workerd validates websocket tickets/origins and connects two native clients through the DO', { timeout: 15000 }, async () => {
  const { issueDuelTicket } = await import('../web/duel-ticket.mjs');
  const modules = ['realtime/worker.mjs', 'realtime/duel-hub.mjs', 'realtime/invite-store.mjs', 'web/duel-ticket.mjs', 'web/account-store.mjs'].map(file => ({ type: 'ESModule', path: path.join(ROOT, file) }));
  const github = duelGitHubFixture();
  const runtime = new Miniflare(convertV4MiniflareOptions({ name: 'brclio-duel-test', modules, modulesRoot: ROOT, compatibilityDate: '2026-10-01', durableObjects: { DUEL_HUB: { className: 'DuelLobby', useSQLite: true } }, bindings: { DUEL_TICKET_SECRET: SECRET, ...github.bindings }, serviceBindings: github.serviceBindings }));
  const sockets = [];
  try {
    const A = { id: 'a'.repeat(32), displayName: '小红', avatarUrl: '' }, B = { id: 'b'.repeat(32), displayName: '小蓝', avatarUrl: '' };
    const tickets = await Promise.all([A, B].map(user => issueDuelTicket(user, SECRET, 'wss://duel.example/connect')));
    const connect = (ticket, Origin = 'https://servicewechat.com') => runtime.dispatchFetch('https://duel.example/connect?ticket=' + encodeURIComponent(ticket), { headers: { Upgrade: 'websocket', Origin } });
    assert.equal((await connect(tickets[0].ticket + '-invalid')).status, 401);
    assert.equal((await connect(tickets[0].ticket, 'https://untrusted.example')).status, 403);
    assert.equal((await runtime.dispatchFetch('https://duel.example/connect')).status, 426);
    async function open(ticket) {
      const response = await connect(ticket); assert.equal(response.status, 101);
      const socket = response.webSocket; sockets.push(socket);
      const events = [], waiters = new Set();
      const client = {
        events, socket, send(value) { socket.send(JSON.stringify(value)); },
        wait(predicate, limit = 2500) {
          const past = events.find(predicate); if (past) return Promise.resolve(past);
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { waiters.delete(check); reject(Error('websocket event not received')); }, limit);
            const check = value => { if (predicate(value)) { clearTimeout(timer); waiters.delete(check); resolve(value); } };
            waiters.add(check);
          });
        }
      };
      socket.addEventListener('message', event => {
        const value = JSON.parse(event.data); events.push(value);
        if (value.type === 'pong') client.send({ type: 'probe_ack', probeId: value.probeId });
        for (const check of waiters) check(value);
      });
      socket.accept(); await client.wait(value => value.type === 'hello');
      return client;
    }
    const [a, b] = await Promise.all(tickets.map(ticket => open(ticket.ticket)));
    await a.wait(value => value.type === 'lobby' && value.users.length === 2);
    a.send({ type: 'invite', userId: B.id });
    const invited = await b.wait(value => value.type === 'state' && value.invitation);
    b.send({ type: 'accept', invitationId: invited.invitation.id });
    const joined = await a.wait(value => value.type === 'state' && value.room);
    assert.deepEqual(new Set(joined.room.players.map(player => player.color)), new Set(['red', 'blue']));
    a.send({ type: 'ping', id: 1, clientAt: Date.now() }); b.send({ type: 'ping', id: 2, clientAt: Date.now() });
    await Promise.all([a.wait(value => value.type === 'pong'), b.wait(value => value.type === 'pong')]);
    a.send({ type: 'ready', rtt: 50, uncertainty: 25 }); b.send({ type: 'ready', rtt: 50, uncertainty: 25 });
    const arming = await a.wait(value => value.type === 'state' && value.room?.phase === 'arming');
    a.send({ type: 'armed', roundId: arming.room.roundId });
    a.send({ type: 'ping', id: 3, clientAt: Date.now() }); await a.wait(value => value.type === 'pong' && value.id === 3);
    // Force the actual workerd isolate out of memory while keeping sockets.
    // The second acknowledgement must rebuild the first from attachments.
    await runtime.unsafeEvictDurableObject('brclio-duel-test', 'DuelLobby', { name: 'lobby-v1', webSockets: 'hibernate' });
    b.send({ type: 'armed', roundId: arming.room.roundId });
    const scheduled = await b.wait(value => value.type === 'state' && value.room?.phase === 'scheduled');
    assert.equal(scheduled.room.signalAt, arming.room.signalAt);
    await runtime.unsafeEvictDurableObject('brclio-duel-test', 'DuelLobby', { name: 'lobby-v1', webSockets: 'hibernate' });
    // Exercise transport cleanup rather than waiting for a reaction timer. The
    // deterministic engine/client integration tests cover GO and settlement.
    a.socket.close(1000, 'backgrounded');
    const aborted = await b.wait(value => value.type === 'state' && value.room?.phase === 'aborted');
    assert.equal(aborted.room.result.winnerId, null);
    assert.equal(aborted.room.result.reason, 'aborted');
  } finally {
    for (const socket of sockets) { try { socket.close(); } catch {} }
    await runtime.dispose();
  }
});
