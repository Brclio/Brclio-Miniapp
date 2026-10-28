import { createGitHubStore } from '../web/account-store.mjs';

const CODE = /^[A-HJ-NP-Z2-9]{8}$/;
const USER = /^[a-f0-9]{32}$/;
const copy = value => value == null ? value : structuredClone(value);
const codePath = code => 'realtime/v1/invites/' + code + '.json';
const userPath = id => 'users/v1/' + id.slice(0, 2) + '/' + id + '/duel-invite.json';
export class InviteStoreError extends Error {
  constructor(code = 'invite_store_unavailable') { super(code); this.safeCode = code; }
}
function validRecord(value, code) {
  const person = user => user && Object.keys(user).sort().join(',') === 'avatarUrl,displayName,id' && USER.test(user.id) && typeof user.displayName === 'string' && user.displayName.length <= 64 && typeof user.avatarUrl === 'string' && user.avatarUrl.length <= 2048 && (!user.avatarUrl || /^https:\/\/[^\s]+$/.test(user.avatarUrl));
  return value && Object.keys(value).sort().join(',') === 'code,expiresAt,guest,owner,roomId,schemaVersion' && value.roomId === null && value.schemaVersion === 1 && value.code === code && CODE.test(code) && person(value.owner) &&
    (value.guest === null || person(value.guest) && value.guest.id !== value.owner.id) && Number.isSafeInteger(value.expiresAt);
}
function record(value) { return { schemaVersion: 1, code: value.code, owner: copy(value.owner), guest: copy(value.guest), expiresAt: value.expiresAt, roomId: null }; }

// All persistent invitation data uses the existing private business repository.
// This module never uses Cloudflare SQL/KV, account credentials or public repos.
export function createInviteStore(env, { storeFactory = createGitHubStore, now = Date.now } = {}) {
  let backend;
  const store = () => backend ||= storeFactory(env, { repository: 'data',
    ...(env.GITHUB_API ? { fetchImpl: (input, init) => env.GITHUB_API.fetch(new Request(input, init)) } : {}) });
  async function cleanupExpired(code, id) {
    await store().transaction(async tx => {
      const value = await tx.get(codePath(code)), at = now();
      if (value && (!validRecord(value, code) || value.expiresAt > at)) return;
      const people = value ? [value.owner.id, value.guest?.id].filter(Boolean) : id ? [id] : [];
      for (const person of people) {
        const index = await tx.get(userPath(person));
        if (index?.code === code && index.expiresAt <= at) tx.delete(userPath(person));
      }
      if (value) tx.delete(codePath(code));
    });
  }
  async function readCode(code) {
    if (!CODE.test(code)) return null;
    const value = await store().read(codePath(code));
    if (value === null) return null;
    if (!validRecord(value, code)) throw new InviteStoreError('invite_record_invalid');
    if (value.expiresAt <= now()) { await cleanupExpired(code); return null; }
    return copy(value);
  }
  return {
    readCode,
    async readUser(id) {
      if (!USER.test(id)) throw new InviteStoreError('invite_user_invalid');
      const index = await store().read(userPath(id));
      if (!index || index.schemaVersion !== 1 || !CODE.test(index.code) || !Number.isSafeInteger(index.expiresAt)) return null;
      if (index.expiresAt <= now()) { await cleanupExpired(index.code, id); return null; }
      const value = await readCode(index.code);
      if (!value) return null;
      if (value.owner.id !== id && value.guest?.id !== id) throw new InviteStoreError('invite_index_invalid');
      return value;
    },
    async apply(changes) {
      if (!changes.length) return;
      await store().transaction(async tx => {
        const at = now();
        for (const [code, value] of changes) {
          if (!CODE.test(code)) throw new InviteStoreError('invite_record_invalid');
          const path = codePath(code), previous = await tx.get(path);
          if (previous && !validRecord(previous, code)) throw new InviteStoreError('invite_record_invalid');
          if (value !== null) {
            const next = record(value);
            if (!validRecord(next, code)) throw new InviteStoreError('invite_record_invalid');
            if (next.expiresAt <= at) throw new InviteStoreError('invite_expired');
            if (previous && previous.expiresAt > at && (previous.owner.id !== next.owner.id || previous.guest && previous.guest.id !== next.guest?.id)) throw new InviteStoreError('invite_conflict');
            for (const user of [next.owner, next.guest].filter(Boolean)) {
              const index = await tx.get(userPath(user.id));
              if (index && index.code !== code && index.expiresAt > at) {
                const other = CODE.test(index.code) ? await tx.get(codePath(index.code)) : null;
                if (other && validRecord(other, index.code) && other.expiresAt > at) throw new InviteStoreError('invite_user_busy');
              }
              tx.put(userPath(user.id), { schemaVersion: 1, code, expiresAt: next.expiresAt });
            }
            tx.put(path, next);
          } else {
            if (!previous) continue;
            for (const user of [previous.owner, previous.guest].filter(Boolean)) {
              const index = await tx.get(userPath(user.id));
              if (index?.code === code) tx.delete(userPath(user.id));
            }
            tx.delete(path);
          }
        }
      });
    }
  };
}

export const invitePaths = { codePath, userPath };
