import { publicAvatar } from './account-avatar.mjs';

const USER_ID = /^[a-f0-9]{32}$/;
const REQUEST_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const FRIEND_LIMITS = Object.freeze({ friends: 100, pending: 50, requestsPerDay: 20, pendingMs: 7 * 86400000 });
export class FriendsError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new FriendsError(status, code, message); };
const invalid = () => fail(503, 'friends_data_invalid', '好友资料暂不可用，请稍后再试。');
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => { if (!record(value) || Object.keys(value).some(key => !keys.includes(key))) fail(400, 'invalid_fields', '好友请求格式错误。'); };
const clone = value => structuredClone(value);
const validAt = value => Number.isSafeInteger(value) && value >= 0;
export function friendsPath(id) {
  if (typeof id !== 'string' || !USER_ID.test(id)) fail(400, 'friend_user_invalid', '请输入正确的用户账号。');
  return 'users/v1/' + id.slice(0, 2) + '/' + id + '/friends.json';
}
export function publicFriend(profile, origin = '') {
  if (!profile || !USER_ID.test(profile.id)) fail(404, 'friend_user_unavailable', '暂时无法添加这位用户，请核对账号。');
  const avatar = profile.avatarUrl ? profile.avatarUrl : publicAvatar(profile, origin).avatarUrl;
  return {
    id: profile.id,
    displayName: String(profile.displayName || 'Brclio 用户').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 64),
    avatarUrl: typeof avatar === 'string' && /^https:\/\//.test(avatar) ? avatar.slice(0, 2048) : '',
    username: typeof profile.username === 'string' && /^[a-z][a-z0-9_]{3,23}$/.test(profile.username) ? profile.username : ''
  };
}
function validUser(value) {
  return record(value) && Object.keys(value).every(key => ['id', 'displayName', 'avatarUrl', 'username'].includes(key)) &&
    USER_ID.test(value.id) && typeof value.displayName === 'string' && value.displayName.length <= 64 &&
    typeof value.avatarUrl === 'string' && value.avatarUrl.length <= 2048 && (!value.avatarUrl || /^https:\/\//.test(value.avatarUrl)) &&
    typeof value.username === 'string' && (!value.username || /^[a-z][a-z0-9_]{3,23}$/.test(value.username));
}
function document(value, at) {
  if (value === null || value === undefined) return { schemaVersion: 1, revision: 0, friends: [], incoming: [], outgoing: [], handled: [], requestRate: { day: Math.floor(at / 86400000), count: 0 } };
  if (!record(value) || value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      !Array.isArray(value.friends) || value.friends.length > FRIEND_LIMITS.friends ||
      !Array.isArray(value.incoming) || !Array.isArray(value.outgoing) || value.incoming.length + value.outgoing.length > FRIEND_LIMITS.pending ||
      !Array.isArray(value.handled) || value.handled.length > FRIEND_LIMITS.pending ||
      !record(value.requestRate) || !validAt(value.requestRate.day) || !validAt(value.requestRate.count)) invalid();
  const ids = new Set();
  for (const friend of value.friends) {
    if (!record(friend) || !validUser(friend.user) || !validAt(friend.since) || ids.has(friend.user.id)) invalid();
    ids.add(friend.user.id);
  }
  const pendingIds = new Set();
  for (const [entries, field] of [[value.incoming, 'from'], [value.outgoing, 'to']]) for (const item of entries) {
    if (!record(item) || !REQUEST_ID.test(item.id) || !validUser(item[field]) || !validAt(item.createdAt) || pendingIds.has(item.id)) invalid();
    pendingIds.add(item.id);
  }
  for (const item of value.handled) if (!record(item) || !REQUEST_ID.test(item.id) || !USER_ID.test(item.userId) || typeof item.accepted !== 'boolean' || !validAt(item.at)) invalid();
  const result = clone(value);
  result.incoming = result.incoming.filter(item => item.createdAt + FRIEND_LIMITS.pendingMs > at);
  result.outgoing = result.outgoing.filter(item => item.createdAt + FRIEND_LIMITS.pendingMs > at);
  if (result.requestRate.day !== Math.floor(at / 86400000)) result.requestRate = { day: Math.floor(at / 86400000), count: 0 };
  return result;
}
function snapshot(value) {
  // Whitelist every field so malformed private records never become responses.
  return { friends: value.friends.map(item => ({ user: publicFriend(item.user), since: item.since })),
    incoming: value.incoming.map(item => ({ id: item.id, from: publicFriend(item.from), createdAt: item.createdAt })),
    outgoing: value.outgoing.map(item => ({ id: item.id, to: publicFriend(item.to), createdAt: item.createdAt })),
    limits: { friends: FRIEND_LIMITS.friends, pending: FRIEND_LIMITS.pending } };
}
function removePending(value, userId) {
  value.incoming = value.incoming.filter(item => item.from.id !== userId);
  value.outgoing = value.outgoing.filter(item => item.to.id !== userId);
}
function persist(tx, id, value) { value.revision += 1; tx.put(friendsPath(id), value); }

// GitHub's transaction updates both per-user files with one non-force commit;
// optimistic conflicts rerun all capacity/ownership checks on the latest HEAD.
export async function handleFriends({ route, body, user, store, resolveUser, resolveUsername, at, origin = '' }) {
  const mine = publicFriend(user, origin), ownPath = friendsPath(mine.id);
  const read = async () => snapshot(document(await store.read(ownPath), at));
  if (route === '/friends') return read();
  if (route === '/friends/request') {
    exact(body, ['userId', 'username']);
    if ((body.userId === undefined) === (body.username === undefined)) fail(400, 'friend_user_invalid', '请填写一个用户账号。');
    let targetId = body.userId;
    if (body.username !== undefined) {
      if (typeof body.username !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{3,23}$/.test(body.username.trim())) fail(400, 'friend_user_invalid', '请输入 4–24 位公开账号，不支持邮箱。');
      targetId = await resolveUsername(body.username.trim().toLowerCase());
    }
    if (typeof targetId !== 'string' || !USER_ID.test(targetId)) fail(404, 'friend_user_unavailable', '暂时无法添加这位用户，请核对账号。');
    if (targetId === mine.id) fail(400, 'friend_self', '不能添加自己为好友。');
    const peer = publicFriend(await resolveUser(targetId), origin), id = crypto.randomUUID();
    await store.transaction(async tx => {
      const own = document(await tx.get(ownPath), at), other = document(await tx.get(friendsPath(peer.id)), at);
      if (own.friends.some(item => item.user.id === peer.id)) return;
      if (own.outgoing.some(item => item.to.id === peer.id)) return;
      if (own.incoming.some(item => item.from.id === peer.id)) fail(409, 'friend_request_received', '对方已经申请，请在好友申请中接受。');
      if (own.friends.length >= FRIEND_LIMITS.friends || other.friends.length >= FRIEND_LIMITS.friends) fail(409, 'friends_full', '有一方的好友已满，请清理后再试。');
      if (own.incoming.length + own.outgoing.length >= FRIEND_LIMITS.pending || other.incoming.length + other.outgoing.length >= FRIEND_LIMITS.pending) fail(409, 'friend_requests_full', '有一方的好友申请已满，请先处理现有申请。');
      if (own.requestRate.count >= FRIEND_LIMITS.requestsPerDay) fail(429, 'friend_rate_limited', '今天的好友申请次数已用完，请明天再试。');
      own.requestRate.count += 1;
      own.outgoing.push({ id, to: peer, createdAt: at }); other.incoming.push({ id, from: mine, createdAt: at });
      persist(tx, mine.id, own); persist(tx, peer.id, other);
    });
    return read();
  }
  if (route === '/friends/respond') {
    exact(body, ['requestId', 'accept']);
    if (!REQUEST_ID.test(body.requestId) || typeof body.accept !== 'boolean') fail(400, 'friend_request_invalid', '好友申请格式错误。');
    // Own inbound document determines the peer; callers cannot supply a forged
    // sender or act on another user's requests by knowing their IDs.
    const initial = document(await store.read(ownPath), at);
    const pending = initial.incoming.find(item => item.id === body.requestId);
    const handled = initial.handled.find(item => item.id === body.requestId);
    if (!pending && handled) {
      if (handled.accepted !== body.accept) fail(409, 'friend_request_handled', '这条申请已经处理过了。');
      return read();
    }
    if (!pending) fail(404, 'friend_request_missing', '申请已结束或已过期，请刷新好友列表。');
    const peer = publicFriend(await resolveUser(pending.from.id), origin);
    await store.transaction(async tx => {
      const own = document(await tx.get(ownPath), at), other = document(await tx.get(friendsPath(peer.id)), at);
      const current = own.incoming.find(item => item.id === body.requestId && item.from.id === peer.id);
      if (!current) {
        const done = own.handled.find(item => item.id === body.requestId);
        if (done && done.accepted === body.accept) return;
        fail(404, 'friend_request_missing', '申请已结束或已过期，请刷新好友列表。');
      }
      if (!other.outgoing.some(item => item.id === current.id && item.to.id === mine.id)) fail(409, 'friend_request_missing', '申请已撤回，请刷新好友列表。');
      if (body.accept) {
        if ((own.friends.length >= FRIEND_LIMITS.friends && !own.friends.some(item => item.user.id === peer.id)) ||
            (other.friends.length >= FRIEND_LIMITS.friends && !other.friends.some(item => item.user.id === mine.id))) fail(409, 'friends_full', '有一方的好友已满，请清理后再试。');
        own.friends = own.friends.filter(item => item.user.id !== peer.id); other.friends = other.friends.filter(item => item.user.id !== mine.id);
        own.friends.push({ user: peer, since: at }); other.friends.push({ user: mine, since: at });
      }
      removePending(own, peer.id); removePending(other, mine.id);
      own.handled = [...own.handled.filter(item => item.id !== current.id), { id: current.id, userId: peer.id, accepted: body.accept, at }].slice(-FRIEND_LIMITS.pending);
      persist(tx, mine.id, own); persist(tx, peer.id, other);
    });
    return read();
  }
  if (route === '/friends/remove') {
    exact(body, ['userId']);
    if (typeof body.userId !== 'string' || !USER_ID.test(body.userId) || body.userId === mine.id) fail(400, 'friend_user_invalid', '请选择正确的好友。');
    await store.transaction(async tx => {
      const own = document(await tx.get(ownPath), at), other = document(await tx.get(friendsPath(body.userId)), at);
      const exists = own.friends.some(item => item.user.id === body.userId) || own.incoming.some(item => item.from.id === body.userId) || own.outgoing.some(item => item.to.id === body.userId);
      if (!exists) return;
      own.friends = own.friends.filter(item => item.user.id !== body.userId); other.friends = other.friends.filter(item => item.user.id !== mine.id);
      removePending(own, body.userId); removePending(other, mine.id);
      persist(tx, mine.id, own); persist(tx, body.userId, other);
    });
    return read();
  }
  fail(404, 'not_found', '好友接口不存在。');
}
