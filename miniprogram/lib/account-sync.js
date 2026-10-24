'use strict';
const defaultAccount = require('./account');
const schema = require('./account-sync-schema');
const META_PREFIX = 'brclio.miniapp-sync.v1:';
const DATA_PREFIX = 'brclio.miniapp-data.v1:';
const CLAIM_KEY = 'brclio.miniapp-sync.guest-owner.v1';
const clone = value => JSON.parse(JSON.stringify(value));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const empty = () => ({ schemaVersion: 1, revision: 0, entries: {}, dirty: {}, materialized: {}, blocked: {}, favoriteEdits: {}, nurseryFavoriteEdits: {}, duelEdits: {}, lastSyncedAt: null });

function createAccountSync(options) {
  const opt = options || {}, account = opt.account || defaultAccount;
  const now = opt.now || Date.now, schedule = opt.setTimeout || setTimeout, cancel = opt.clearTimeout || clearTimeout;
  const throttleMs = opt.throttleMs === undefined ? 1200 : opt.throttleMs;
  const api = () => opt.wx || (typeof wx !== 'undefined' ? wx : null);
  const listeners = new Set();
  const envelopes = new Map();
  let scope = 'guest', epoch = 0, activated = false, destroyed = false, connected = true, timer = null, pending = null;
  let hydrationEpoch = 0, safeActive = false;
  let guestOwner, lastStamp = 0, state = 'guest', message = '', hydrationVersion = 0, currentError = null;
  function rawGet(key) { const wx = api(); return wx && wx.getStorageSync ? wx.getStorageSync(key) : undefined; }
  function rawSet(key, value) { const wx = api(); if (!wx || !wx.setStorageSync) throw new Error('本机存储暂不可用。'); wx.setStorageSync(key, value); }
  function rawRemove(key) { const wx = api(); if (!wx || !wx.removeStorageSync) throw new Error('本机存储暂不可用。'); wx.removeStorageSync(key); }
  function physical(key, owner = scope) { return owner === 'guest' || !schema.scopedKey(key) ? key : DATA_PREFIX + encodeURIComponent(owner) + ':' + key; }
  function missing(value) { return value === undefined || value === null || value === ''; }
  function stamp() { lastStamp = Math.max(Math.floor(now()), lastStamp + 1); return lastStamp; }
  function liveUser() { const user = account.getCachedUser(); return user && typeof user.id === 'string' && user.id ? user.id : 'guest'; }
  function getGuestOwner() {
    if (guestOwner !== undefined) return guestOwner;
    try { const value = rawGet(CLAIM_KEY); guestOwner = value && typeof value.userId === 'string' ? value.userId : null; } catch (_) { return null; }
    return guestOwner;
  }
  function load(owner = scope) {
    if (envelopes.has(owner)) return envelopes.get(owner);
    let value;
    try { value = rawGet(META_PREFIX + encodeURIComponent(owner)); }
    catch (_) { throw new Error('本机同步记录暂不可读取，已保留原有数据。'); }
    const meta = empty();
    if (value && value.schemaVersion === 1) {
      if (Number.isSafeInteger(value.revision) && value.revision >= 0) meta.revision = value.revision;
      if (Number.isFinite(value.lastSyncedAt)) meta.lastSyncedAt = value.lastSyncedAt;
      if (value.favoriteEdits && typeof value.favoriteEdits === 'object' && !Array.isArray(value.favoriteEdits)) {
        for (const id of Object.keys(value.favoriteEdits)) {
          const edit = value.favoriteEdits[id];
          if (edit && typeof edit.saved === 'boolean' && Number.isSafeInteger(edit.updatedAt) && id.length <= 200 && !['__proto__', 'constructor', 'prototype'].includes(id)) meta.favoriteEdits[id] = { saved: edit.saved, updatedAt: edit.updatedAt };
        }
      }
      if (value.nurseryFavoriteEdits && typeof value.nurseryFavoriteEdits === 'object' && !Array.isArray(value.nurseryFavoriteEdits)) {
        for (const id of Object.keys(value.nurseryFavoriteEdits)) {
          const edit = value.nurseryFavoriteEdits[id];
          if (edit && typeof edit.saved === 'boolean' && Number.isSafeInteger(edit.updatedAt) && /^\d{1,20}$/.test(id)) meta.nurseryFavoriteEdits[id] = { saved: edit.saved, updatedAt: edit.updatedAt };
        }
      }
      if (value.duelEdits && typeof value.duelEdits === 'object' && !Array.isArray(value.duelEdits)) {
        for (const field of ['targetScore', 'haptics', 'soundEnabled', 'names', 'matches']) {
          const edit = value.duelEdits[field];
          if (!edit || !Number.isSafeInteger(edit.updatedAt) || schema.normalizeValue('brclio.duel.v1', { [field]: edit.value }) === undefined) continue;
          meta.duelEdits[field] = clone(edit);
        }
      }
      for (const key of schema.SYNC_KEYS) {
        const entry = value.entries && value.entries[key];
        if (!entry || !Number.isSafeInteger(entry.updatedAt) || entry.updatedAt < 0) continue;
        const typed = schema.normalizeValue(key, entry.value);
        if (typed === undefined) continue;
        meta.entries[key] = { value: typed, updatedAt: entry.updatedAt };
        if (value.dirty && value.dirty[key]) meta.dirty[key] = true;
        if (value.blocked && value.blocked[key]) meta.blocked[key] = true;
        if (value.materialized && own(value.materialized, key)) {
          const shadow = schema.normalizeValue(key, value.materialized[key]);
          if (shadow !== undefined) meta.materialized[key] = shadow;
        } else meta.materialized[key] = typed;
        lastStamp = Math.max(lastStamp, entry.updatedAt);
      }
    }
    envelopes.set(owner, meta);
    return meta;
  }
  function persist(owner = scope) { rawSet(META_PREFIX + encodeURIComponent(owner), clone(load(owner))); }
  function getStatus() {
    let meta; try { meta = load(); } catch (_) { meta = empty(); }
    return { userId: scope === 'guest' ? null : scope, scope, state, pending: Object.keys(meta.dirty).length, lastSyncedAt: meta.lastSyncedAt, message: message || ({ guest: '访客记录保存在本机。', idle: '已同步。', pending: '已保存本机，等待同步。', syncing: '正在同步。', offline: '网络恢复后会自动继续同步。', error: '同步暂未完成，本机记录已保留。' }[state] || ''), hydrationVersion };
  }
  function emit(next, text) {
    if (next) state = next;
    message = text || '';
    const status = getStatus();
    listeners.forEach(listener => { try { listener(status); } catch (_) {} });
  }
  function failure(error) {
    currentError = error;
    emit(!connected || error && error.code === 'network_error' ? 'offline' : 'error', error && error.message || '同步暂未完成，本机记录已保留。');
  }
  function later(delay = throttleMs) {
    if (destroyed || scope === 'guest' || !connected) return;
    if (timer !== null) cancel(timer);
    timer = schedule(() => { timer = null; void flush(); }, Math.max(0, delay));
  }
  function favoriteIntent(meta, value, previous, at, nursery = false) {
    if (!value || typeof value !== 'object') return;
    const field = nursery ? 'favorites' : 'saved', edits = nursery ? meta.nurseryFavoriteEdits : meta.favoriteEdits;
    const old = new Set(previous && Array.isArray(previous[field]) ? previous[field] : []);
    const next = new Set(Array.isArray(value[field]) ? value[field] : []);
    for (const id of next) if (!old.has(id)) edits[id] = { saved: true, updatedAt: at };
    for (const id of old) if (!next.has(id)) edits[id] = { saved: false, updatedAt: at };
  }
  function outgoingProgress(meta, value, base, nursery = false) {
    if (!value || typeof value !== 'object') return value;
    const field = nursery ? 'favorites' : 'saved', edits = nursery ? meta.nurseryFavoriteEdits : meta.favoriteEdits;
    const saved = new Set(base && Array.isArray(base[field]) ? base[field] : []);
    for (const id of Object.keys(edits)) { if (edits[id].saved) saved.add(id); else saved.delete(id); }
    return { ...value, [field]: [...saved] };
  }
  function duelIntent(meta, value, previous, changedKeys, at) {
    if (!value || typeof value !== 'object') { meta.duelEdits = {}; return; }
    const fields = Array.isArray(changedKeys) ? changedKeys : Object.keys(value).filter(field => !previous || !schema.equal(previous[field], value[field]));
    for (const field of ['targetScore', 'haptics', 'soundEnabled', 'names', 'matches']) {
      if (!fields.includes(field) || !own(value, field)) continue;
      if (field !== 'matches') { meta.duelEdits[field] = { value: clone(value[field]), updatedAt: at }; continue; }
      const before = new Set(previous && Array.isArray(previous.matches) ? previous.matches.map(item => item.id) : []);
      const existing = meta.duelEdits.matches || {};
      const added = new Map();
      const clear = value.matches.length === 0 || existing.clear === true;
      if (value.matches.length) {
        (existing.added || []).forEach(item => added.set(item.id, item));
        value.matches.filter(item => !before.has(item.id)).forEach(item => added.set(item.id, item));
      }
      meta.duelEdits.matches = { value: clone(value.matches), added: [...added.values()], clear, updatedAt: at };
    }
  }
  function outgoingDuel(meta, value, base) {
    if (value === null) return null;
    const result = base && typeof base === 'object' ? clone(base) : {};
    for (const field of Object.keys(meta.duelEdits)) {
      const edit = meta.duelEdits[field];
      if (field !== 'matches') { result[field] = clone(edit.value); continue; }
      const matches = new Map();
      [...(edit.added || []), ...(!edit.clear && Array.isArray(result.matches) ? result.matches : [])].forEach(item => { if (!matches.has(item.id)) matches.set(item.id, item); });
      result.matches = [...matches.values()].sort((a, b) => b.at - a.at).slice(0, 20);
    }
    return result;
  }
  function mark(key, value, options) {
    const meta = load();
    let typed = schema.normalizeValue(key, value);
    if (typed === undefined) {
      meta.blocked[key] = true;
      try { persist(); } catch (_) {}
      failure(new Error('部分本机记录超出同步范围，已保留在本机。')); return;
    }
    delete meta.blocked[key];
    if (key === 'lingotiles.progress.v1') favoriteIntent(meta, typed, meta.materialized[key], stamp());
    if (key === schema.NURSERY_FAVORITES_KEY) favoriteIntent(meta, typed, meta.materialized[key], stamp(), true);
    if (key === 'brclio.duel.v1') duelIntent(meta, typed, meta.materialized[key], options && options.changedKeys, stamp());
    meta.materialized[key] = clone(typed);
    const old = meta.entries[key];
    if (key === 'lingotiles.progress.v1') typed = outgoingProgress(meta, typed, old && old.value);
    if (key === schema.NURSERY_FAVORITES_KEY) typed = outgoingProgress(meta, typed, old && old.value, true);
    if (key === 'brclio.duel.v1') typed = outgoingDuel(meta, typed, old && old.value);
    if (old && schema.equal(old.value, typed)) { try { persist(); } catch (error) { failure(error); } return; }
    meta.entries[key] = { value: typed, updatedAt: stamp() };
    meta.dirty[key] = true;
    try { persist(); currentError = null; emit(scope === 'guest' ? 'guest' : connected ? 'pending' : 'offline'); }
    catch (error) { failure(error); }
    later();
  }
  function reconcile(owner = scope) {
    const meta = load(owner);
    let changed = false;
    for (const key of schema.SYNC_KEYS) {
      let value;
      try { value = rawGet(physical(key, owner)); } catch (_) { continue; }
      const old = meta.entries[key];
      const shadow = own(meta.materialized, key) ? meta.materialized[key] : undefined;
      if (missing(value)) {
        if (shadow !== undefined && shadow !== null) { meta.materialized[key] = null; delete meta.blocked[key]; }
        if (shadow !== undefined && shadow !== null) { meta.entries[key] = { value: null, updatedAt: stamp() }; meta.dirty[key] = true; changed = true; }
        continue;
      }
      let typed = schema.normalizeValue(key, value);
      if (typed === undefined) { meta.blocked[key] = true; changed = true; continue; }
      if (meta.blocked[key]) { delete meta.blocked[key]; changed = true; }
      if (shadow === undefined || !schema.equal(shadow, typed)) {
        if (key === 'lingotiles.progress.v1') favoriteIntent(meta, typed, shadow, stamp());
        if (key === schema.NURSERY_FAVORITES_KEY) favoriteIntent(meta, typed, shadow, stamp(), true);
        if (key === 'brclio.duel.v1') duelIntent(meta, typed, shadow, undefined, stamp());
        meta.materialized[key] = clone(typed);
        const outgoing = key === 'lingotiles.progress.v1' ? outgoingProgress(meta, typed, old && old.value) : key === schema.NURSERY_FAVORITES_KEY ? outgoingProgress(meta, typed, old && old.value, true) : key === 'brclio.duel.v1' ? outgoingDuel(meta, typed, old && old.value) : typed;
        meta.entries[key] = { value: outgoing, updatedAt: stamp() }; meta.dirty[key] = true; changed = true;
      }
    }
    if (changed) persist(owner);
  }
  function deriveNurseryFavorites(snapshot) {
    if (own(snapshot, schema.NURSERY_FAVORITES_KEY)) return;
    let legacy = snapshot[schema.NURSERY_LOCAL_KEY];
    if (typeof legacy === 'string') { try { legacy = JSON.parse(legacy); } catch (_) { return; } }
    if (!legacy || legacy.version !== 1 || !Array.isArray(legacy.favorites)) return;
    const value = schema.normalizeValue(schema.NURSERY_FAVORITES_KEY, { favorites: legacy.favorites });
    if (value !== undefined) snapshot[schema.NURSERY_FAVORITES_KEY] = value;
  }
  function nurserySnapshot() {
    const snapshot = {};
    for (const key of [schema.NURSERY_LOCAL_KEY, schema.NURSERY_FAVORITES_KEY]) {
      const value = rawGet(key);
      if (!missing(value)) snapshot[key] = clone(value);
    }
    deriveNurseryFavorites(snapshot);
    return snapshot;
  }
  function freezeNurseryUpgrade(previousClaim) {
    if (!previousClaim || previousClaim.copyComplete !== true || previousClaim.nurseryCopyComplete === true) return previousClaim;
    const snapshot = previousClaim.nurserySnapshot;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      const frozen = { ...previousClaim, nurseryCopyComplete: false, nurserySnapshot: nurserySnapshot() };
      rawSet(CLAIM_KEY, frozen);
      return frozen;
    }
    return previousClaim;
  }
  function migrateGuestNursery() {
    if (!missing(rawGet(schema.NURSERY_FAVORITES_KEY))) return;
    const snapshot = nurserySnapshot();
    if (own(snapshot, schema.NURSERY_FAVORITES_KEY)) rawSet(schema.NURSERY_FAVORITES_KEY, snapshot[schema.NURSERY_FAVORITES_KEY]);
  }
  function upgradeNurseryClaim(owner, previousClaim) {
    if (previousClaim.nurseryCopyComplete === true) return;
    previousClaim = freezeNurseryUpgrade(previousClaim);
    const snapshot = previousClaim.nurserySnapshot;
    // Earlier releases completed the guest claim before nursery data was scoped.
    // Only that original owner may import it, from one frozen upgrade snapshot.
    const meta = load(owner);
    for (const key of [schema.NURSERY_LOCAL_KEY, schema.NURSERY_FAVORITES_KEY]) {
      if (!own(snapshot, key) || !missing(rawGet(physical(key, owner)))) continue;
      rawSet(physical(key, owner), clone(snapshot[key]));
      if (key === schema.NURSERY_FAVORITES_KEY) {
        const value = schema.normalizeValue(key, snapshot[key]);
        if (value === undefined) continue;
        favoriteIntent(meta, value, null, stamp(), true);
        meta.materialized[key] = clone(value);
        meta.entries[key] = { value, updatedAt: stamp() }; meta.dirty[key] = true;
      }
    }
    persist(owner);
    const complete = { ...previousClaim, nurseryCopyComplete: true };
    delete complete.nurserySnapshot;
    rawSet(CLAIM_KEY, complete);
  }
  function claim(owner) {
    const existingOwner = getGuestOwner();
    if (existingOwner && existingOwner !== owner) return;
    const previousClaim = rawGet(CLAIM_KEY);
    if (existingOwner === owner && previousClaim && previousClaim.copyComplete === true) { upgradeNurseryClaim(owner, previousClaim); return; }
    let snapshot = previousClaim && previousClaim.snapshot;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      snapshot = {};
      for (const key of schema.SYNC_KEYS.concat(schema.LOCAL_ONLY_KEYS)) {
        let value; try { value = rawGet(key); } catch (_) { continue; }
        if (!missing(value)) snapshot[key] = clone(value);
      }
    }
    deriveNurseryFavorites(snapshot);
    // Freeze the claimed guest snapshot before copying. A storage interruption
    // may retry this same snapshot, but can never claim later guest activity.
    const claimedAt = previousClaim && previousClaim.claimedAt || now();
    rawSet(CLAIM_KEY, { userId: owner, claimedAt, copyComplete: false, snapshot });
    guestOwner = owner;
    const meta = load(owner), guest = load('guest');
    for (const key of schema.SYNC_KEYS.concat(schema.LOCAL_ONLY_KEYS)) {
      if (!own(snapshot, key)) continue;
      const raw = snapshot[key], destination = physical(key, owner);
      let previous; try { previous = rawGet(destination); } catch (_) { continue; }
      if (!missing(previous)) continue;
      rawSet(destination, clone(raw));
      if (schema.SYNC_KEYS.includes(key)) {
        const value = schema.normalizeValue(key, raw);
        if (value !== undefined) { if (key === 'lingotiles.progress.v1') favoriteIntent(meta, value, null, stamp()); if (key === schema.NURSERY_FAVORITES_KEY) favoriteIntent(meta, value, null, stamp(), true); if (key === 'brclio.duel.v1') duelIntent(meta, value, null, undefined, stamp()); meta.materialized[key] = clone(value); meta.entries[key] = { value, updatedAt: guest.entries[key] ? guest.entries[key].updatedAt : stamp() }; meta.dirty[key] = true; }
      }
    }
    persist(owner);
    rawSet(CLAIM_KEY, { userId: owner, claimedAt, copyComplete: true, nurseryCopyComplete: true });
  }
  function switchScope(owner) {
    if (owner === scope && activated) {
      if (owner !== 'guest') { try { claim(owner); } catch (error) { failure(error); } }
      return;
    }
    if (timer !== null) cancel(timer); timer = null;
    epoch += 1; scope = owner; activated = true; pending = null; currentError = null;
    try {
      freezeNurseryUpgrade(rawGet(CLAIM_KEY));
      if (owner !== 'guest') claim(owner);
      else migrateGuestNursery();
      load(owner); reconcile(owner);
      emit(owner === 'guest' ? 'guest' : connected ? Object.keys(load().dirty).length ? 'pending' : 'idle' : 'offline');
    } catch (error) { failure(error); }
  }
  function still(owner, run) { return !destroyed && owner === scope && run === epoch && liveUser() === owner; }
  function validateRemote(value) {
    if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0 || !value.entries || typeof value.entries !== 'object' || Array.isArray(value.entries)) throw new Error('云端记录暂时无法读取，本机记录已保留。');
    const entries = {};
    for (const key of Object.keys(value.entries)) {
      if (!schema.SYNC_KEYS.includes(key)) throw new Error('云端记录格式不兼容，本机记录已保留。');
      const entry = value.entries[key], typed = entry && schema.normalizeValue(key, entry.value);
      if (!entry || !Number.isSafeInteger(entry.updatedAt) || entry.updatedAt < 0 || typed === undefined) throw new Error('云端记录格式不兼容，本机记录已保留。');
      entries[key] = { value: typed, updatedAt: entry.updatedAt };
    }
    return { revision: value.revision, entries };
  }
  function mergeRemote(value, hydrate) {
    const remote = validateRemote(value), meta = load();
    meta.revision = remote.revision;
    for (const key of schema.SYNC_KEYS) {
      const local = meta.entries[key], incoming = remote.entries[key];
      if (!incoming) { if (local) meta.dirty[key] = true; continue; }
      const merged = schema.mergeEntry(key, local, incoming);
      if (key === 'lingotiles.progress.v1' && meta.dirty[key] && merged.value && incoming.value) {
        // Full progress snapshots also accompany practice and seen-word changes.
        // Only an observed favorite toggle is an intention to add/remove one.
        const saved = new Set(incoming.value.saved);
        for (const id of Object.keys(meta.favoriteEdits)) {
          if (meta.favoriteEdits[id].saved) saved.add(id); else saved.delete(id);
        }
        merged.value.saved = [...saved];
      }
      if (key === schema.NURSERY_FAVORITES_KEY && meta.dirty[key] && merged.value && incoming.value) merged.value = outgoingProgress(meta, merged.value, incoming.value, true);
      if (key === 'brclio.duel.v1' && meta.dirty[key] && merged.value && incoming.value) merged.value = outgoingDuel(meta, merged.value, incoming.value);
      if (schema.normalizeValue(key, merged.value) === undefined) throw new Error('合并记录超出同步范围，本机记录已保留。');
      if (!own(meta.materialized, key)) {
        const present = rawGet(physical(key));
        const shadow = missing(present) ? null : schema.normalizeValue(key, present);
        meta.materialized[key] = shadow === undefined ? null : shadow;
      }
      meta.entries[key] = merged;
      lastStamp = Math.max(lastStamp, merged.updatedAt);
      if (schema.equal(merged, incoming)) {
        delete meta.dirty[key];
        if (key === 'lingotiles.progress.v1') meta.favoriteEdits = {};
        if (key === schema.NURSERY_FAVORITES_KEY) meta.nurseryFavoriteEdits = {};
        if (key === 'brclio.duel.v1') meta.duelEdits = {};
      } else meta.dirty[key] = true;
    }
    if (hydrate) {
      for (const key of schema.SYNC_KEYS) {
        const entry = meta.entries[key]; if (!entry || meta.blocked[key]) continue;
        const destination = physical(key);
        if (entry.value === null) rawRemove(destination);
        else {
          const previous = rawGet(destination);
          rawSet(destination, schema.encodeLocal(key, entry.value, previous));
        }
        meta.materialized[key] = clone(entry.value);
      }
      hydrationVersion += 1;
    }
    persist();
  }
  function nextPatch() {
    const meta = load(), entries = {};
    for (const key of schema.SYNC_KEYS) {
      if (!meta.dirty[key] || !meta.entries[key] || meta.blocked[key]) continue;
      const next = { ...entries, [key]: meta.entries[key] };
      if (schema.byteLength({ revision: meta.revision, entries: next }) > schema.MAX_REQUEST_BYTES - 1024) {
        if (!Object.keys(entries).length) throw new Error('本机记录较大，暂时无法同步。');
        break;
      }
      entries[key] = clone(meta.entries[key]);
    }
    return { revision: meta.revision, entries };
  }
  async function perform(owner, run, pull, safeEpoch) {
    emit('syncing');
    try {
      if (pull || load().revision === 0) {
        const remote = await account.readSync();
        if (!still(owner, run)) return getStatus();
        mergeRemote(remote, pull && safeActive && safeEpoch === hydrationEpoch);
      }
      for (let attempt = 0; attempt < schema.SYNC_KEYS.length + 4; attempt++) {
        if (!still(owner, run)) return getStatus();
        const patch = nextPatch();
        if (!Object.keys(patch.entries).length) break;
        try {
          const response = await account.writeSync(patch);
          if (!still(owner, run)) return getStatus();
          // No hydration on background writes: an active game keeps its own snapshot.
          mergeRemote(response, false);
        } catch (error) {
          if (!still(owner, run)) return getStatus();
          if (error.status !== 409 && error.code !== 'sync_conflict') throw error;
          const remote = await account.readSync();
          if (!still(owner, run)) return getStatus();
          mergeRemote(remote, false);
        }
      }
      if (!still(owner, run)) return getStatus();
      const meta = load(); meta.lastSyncedAt = now(); persist(); currentError = null;
      if (Object.keys(meta.blocked).length) emit('error', '部分本机记录超出同步范围，已保留在本机。');
      else emit(Object.keys(meta.dirty).length ? 'pending' : 'idle');
      if (Object.keys(meta.dirty).some(key => !meta.blocked[key])) later();
    } catch (error) {
      if (still(owner, run)) failure(error);
    }
    return getStatus();
  }
  function retryRevocations() { if (typeof account.flushRevocations === 'function') void account.flushRevocations().catch(() => {}); }
  function run(pull, safeEpoch) {
    retryRevocations();
    if (destroyed) return Promise.resolve(getStatus());
    const owner = liveUser();
    switchScope(owner);
    if (scope === 'guest') return Promise.resolve(getStatus());
    if (!connected) { emit('offline', '网络恢复后会自动继续同步。'); return Promise.resolve(getStatus()); }
    if (pending) {
      if (!pull) return pending.promise;
      // Queue the safe-point pull after an in-flight write, without enabling
      // hydration inside that write's unrelated background response.
      return pending.promise.then(() => safeActive && safeEpoch === hydrationEpoch ? run(true, safeEpoch) : getStatus());
    }
    if (timer !== null) cancel(timer); timer = null;
    const runEpoch = epoch, runOwner = scope;
    const promise = perform(runOwner, runEpoch, pull, safeEpoch).finally(() => { if (pending && pending.promise === promise) pending = null; });
    pending = { promise };
    return promise;
  }
  function flush() { return run(false); }
  function safeRun(settings) {
    const pull = !settings || settings.pull !== false;
    if (!pull) return run(false);
    safeActive = true;
    return run(true, ++hydrationEpoch);
  }
  const storage = {
    getStorageSync(key) { return rawGet(physical(String(key))); },
    setStorageSync(key, value, options) {
      key = String(key);
      // The durable local write completes before scheduling any network work.
      rawSet(physical(key), value);
      if (schema.SYNC_KEYS.includes(key)) mark(key, value, options);
    },
    removeStorageSync(key) {
      key = String(key); rawRemove(physical(key));
      if (schema.SYNC_KEYS.includes(key)) mark(key, null);
    },
    getItem(key) { const value = this.getStorageSync(key); return value === undefined || value === '' || value === null ? null : typeof value === 'string' ? value : JSON.stringify(value); },
    setItem(key, value) { this.setStorageSync(key, String(value)); },
    removeItem(key) { this.removeStorageSync(key); }
  };
  const unsubscribeAccount = typeof account.subscribe === 'function' ? account.subscribe(() => {
    if (!activated) return;
    const owner = liveUser();
    if (owner !== scope) { switchScope(owner); later(); }
  }) : () => {};
  return {
    storage, getStatus, getGuestOwner, getScope: () => scope, getScopedKey: key => physical(String(key)),
    subscribe(listener) { if (typeof listener !== 'function') return () => {}; listeners.add(listener); return () => listeners.delete(listener); },
    activate: safeRun,
    onShow: safeRun,
    onHide() { safeActive = false; hydrationEpoch += 1; return flush(); }, flush,
    networkChanged(value) { connected = typeof value === 'boolean' ? value : !!(value && value.isConnected); if (connected) { retryRevocations(); later(0); } else emit(scope === 'guest' ? 'guest' : 'offline', '网络恢复后会自动继续同步。'); return getStatus(); },
    destroy() { destroyed = true; epoch += 1; if (timer !== null) cancel(timer); timer = null; unsubscribeAccount(); listeners.clear(); },
    // Useful for adapters which complete a local-only write before explicit sync.
    markChanged(key) { if (schema.SYNC_KEYS.includes(key)) mark(key, rawGet(physical(key))); }
  };
}
module.exports = Object.assign(createAccountSync(), { createAccountSync, META_PREFIX, DATA_PREFIX, CLAIM_KEY });
