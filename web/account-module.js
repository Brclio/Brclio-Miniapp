// Shared module adapter. Account runtime owns authentication, bounded boot
// hydration, status UI and cross-tab reload; games only read the settled scope.
let boot;
let boundScope;
const HISTORY_KEY = 'lingotiles.history.v1';
const HISTORY_FIELDS = ['id', 'levelId', 'levelTitle', 'mode', 'wordCount', 'gameSeconds', 'studySeconds', 'totalSeconds', 'score', 'stars', 'assists', 'completedAt', 'stageId', 'stageTitle', 'round'];

function runtime() { return typeof window === 'undefined' ? null : window.BrclioAccount || null; }
export function moduleScope() {
  const account = runtime();
  return account && account.getScope ? account.getScope() : account && account.sync && account.sync.getScope ? account.sync.getScope() : 'guest';
}
function controlled() {
  const scope = moduleScope();
  if (boundScope === undefined) boundScope = scope;
  if (scope !== boundScope) throw new Error('账号已变化，请重新打开当前模块。');
  return runtime();
}
function local() {
  const host = typeof window === 'undefined' ? globalThis : window;
  return host.localStorage;
}
export function moduleReady() {
  if (boot) return boot;
  const account = runtime();
  let ready;
  try { ready = account && account.startModule ? account.startModule({ timeoutMs: 1800 }) : account && account.ready; }
  catch (_) { ready = null; }
  boot = Promise.resolve(ready).catch(() => {}).then(() => {
    boundScope = moduleScope();
    return moduleStorage;
  });
  return boot;
}

export const moduleStorage = {
  getItem(key) {
    const account = controlled();
    if (account && account.storage) return account.storage.getItem(String(key));
    return local().getItem(String(key));
  },
  setItem(key, value) {
    const account = controlled(); key = String(key);
    if (account && account.storage) {
      // Native sound/reduce-motion values are booleans in the shared protocol.
      if (['RGD_SOUND_ENABLED', 'lingotiles.native.reduce-motion.v1'].includes(key)) account.storage.setStorageSync(key, value === true || value === 'true');
      else account.storage.setItem(key, String(value));
    } else local().setItem(key, String(value));
  },
  removeItem(key) { const account = controlled(); if (account && account.storage) account.storage.removeItem(String(key)); else local().removeItem(String(key)); },
  getStorageSync(key) {
    const account = controlled();
    if (account && account.storage) return account.storage.getStorageSync(String(key));
    const raw = local().getItem(key === 'brclio.duel.v1' ? 'brclio-minigame:' + key : String(key));
    return raw === null ? '' : JSON.parse(raw);
  },
  setStorageSync(key, value, options) {
    const account = controlled();
    if (account && account.storage) account.storage.setStorageSync(String(key), value, options);
    else local().setItem(key === 'brclio.duel.v1' ? 'brclio-minigame:' + key : String(key), JSON.stringify(value));
  },
  removeStorageSync(key) {
    const account = controlled();
    if (account && account.storage) account.storage.removeStorageSync(String(key));
    else local().removeItem(key === 'brclio.duel.v1' ? 'brclio-minigame:' + key : String(key));
  }
};

// A manual shared reduction remains effective on web. With no manual reduction,
// keep the browser preference and its existing live accessibility listeners.
export function moduleMotionPreference() {
  try {
    if (moduleStorage.getStorageSync('lingotiles.native.reduce-motion.v1') === true) return {
      matches: true, addEventListener() {}, removeEventListener() {}
    };
  } catch (_) { /* An unreadable preference keeps the system default. */ }
  return window.matchMedia('(prefers-reduced-motion: reduce)');
}

function recent(records) {
  const output = []; let bytes = 2;
  const encoder = new TextEncoder();
  for (const record of records.slice().sort((a, b) => b.completedAt.localeCompare(a.completedAt) || b.id.localeCompare(a.id)).slice(0, 200)) {
    const value = {};
    for (const key of HISTORY_FIELDS) if (record[key] !== undefined) value[key] = record[key];
    const size = encoder.encode(JSON.stringify(value)).length + (output.length ? 1 : 0);
    if (bytes + size > 200 * 1024 - 1024) break;
    output.push(value); bytes += size;
  }
  return output;
}

/** Wrap only the default browser store; the pinned injectable IDB class stays intact. */
export function createModuleHistory(Store, validateCompletion) {
  const stores = new Map();
  const active = scope => moduleScope() === scope && (boundScope === undefined || boundScope === scope);
  function store(scope) {
    if (!stores.has(scope)) stores.set(scope, new Store(undefined, scope === 'guest' ? HISTORY_KEY : HISTORY_KEY + ':user:' + encodeURIComponent(scope)));
    return stores.get(scope);
  }
  async function all(instance) {
    const first = await instance.page({ page: 1, pageSize: 100 });
    const records = [...first.records]; let persisted = first.persisted;
    for (let page = 2; records.length < first.total; page++) {
      const value = await instance.page({ page, pageSize: 100 });
      if (!value.records.length) break;
      records.push(...value.records); persisted = persisted && value.persisted;
    }
    return { records, persisted };
  }
  async function migrate(scope, instance) {
    const account = runtime(), owner = account && account.getGuestOwner ? account.getGuestOwner() : account && account.sync && account.sync.getGuestOwner ? account.sync.getGuestOwner() : null;
    if (scope === 'guest' || owner !== scope) return true;
    const marker = 'brclio.lingotiles.web-history-claim.v1';
    let claim;
    try { const raw = local().getItem(marker); if (raw) claim = JSON.parse(raw); }
    catch (_) { return false; }
    if (claim && (claim.owner !== null && claim.owner !== scope || !Array.isArray(claim.ids))) return false;
    if (claim && claim.complete) return true;
    const guest = await all(store('guest'));
    if (!guest.persisted) return false;
    if (!claim) {
      claim = { version: 1, owner: scope, ids: guest.records.map(record => record.id), complete: false };
      try { local().setItem(marker, JSON.stringify(claim)); } catch (_) { return false; }
    } else if (claim.owner === null) {
      claim.owner = scope;
      try { local().setItem(marker, JSON.stringify(claim)); } catch (_) { return false; }
    }
    const ids = new Set(claim.ids);
    for (const record of guest.records) if (ids.has(record.id)) {
      if (!active(scope)) return false;
      if (!(await instance.append(record)).persisted) return false;
    }
    claim.complete = true;
    try { local().setItem(marker, JSON.stringify(claim)); } catch (_) { return false; }
    return true;
  }
  async function prepare(scope, instance) {
    if (!await migrate(scope, instance) || !active(scope)) return false;
    let cloud;
    try { cloud = moduleStorage.getStorageSync(HISTORY_KEY); if (typeof cloud === 'string' && cloud) cloud = JSON.parse(cloud); }
    catch (_) { return false; }
    const localView = await all(instance);
    const savedIds = localView.persisted ? new Set(localView.records.map(record => record.id)) : new Set();
    if (Array.isArray(cloud)) for (const record of cloud) {
      let valid = false; try { valid = validateCompletion(record); } catch (_) {}
      if (!valid) return false;
      if (!savedIds.has(record.id) && !(await instance.append(record)).persisted) return false;
      if (!active(scope)) return false;
    }
    if (cloud !== undefined && cloud !== null && cloud !== '' && !Array.isArray(cloud)) return false;
    return publish(scope, instance);
  }
  async function publish(scope, instance) {
    const account = runtime(), owner = account && account.getGuestOwner ? account.getGuestOwner() : account && account.sync && account.sync.getGuestOwner ? account.sync.getGuestOwner() : null;
    const first = await instance.page({ page: 1, pageSize: 100 });
    const second = first.total > 100 ? await instance.page({ page: 2, pageSize: 100 }) : { records: [], persisted: true };
    const view = scope === 'guest' && !owner ? await all(instance) : { records: [...first.records, ...second.records], persisted: first.persisted && second.persisted };
    if (!view.persisted || !active(scope)) return false;
    try {
      if (scope === 'guest') {
        const marker = 'brclio.lingotiles.web-history-claim.v1', raw = local().getItem(marker);
        const previous = raw ? JSON.parse(raw) : null;
        if (!owner && (!previous || previous.owner === null)) local().setItem(marker, JSON.stringify({ version: 1, owner: null, ids: view.records.map(record => record.id), complete: false }));
        else if (owner && !previous) local().setItem(marker, JSON.stringify({ version: 1, owner, ids: [], complete: false }));
      }
      const value = recent(view.records), previous = moduleStorage.getStorageSync(HISTORY_KEY);
      let decoded = previous;
      if (typeof decoded === 'string' && decoded) decoded = JSON.parse(decoded);
      if (decoded !== undefined && decoded !== null && decoded !== '' && (!Array.isArray(decoded) || decoded.some(record => { try { return !validateCompletion(record); } catch (_) { return true; } }))) return false;
      if (JSON.stringify(value) !== JSON.stringify(previous)) moduleStorage.setStorageSync(HISTORY_KEY, value);
      return true;
    } catch (_) { return false; /* Full IndexedDB records remain available and exportable. */ }
  }
  const preparing = new Map();
  const prepared = new Set();
  async function current() {
    await moduleReady();
    controlled();
    const scope = moduleScope(), instance = store(scope);
    if (!prepared.has(scope)) {
      if (!preparing.has(scope)) preparing.set(scope, prepare(scope, instance).then(done => { if (done) prepared.add(scope); }).catch(() => {}).finally(() => preparing.delete(scope)));
      await preparing.get(scope);
    }
    return { scope, instance };
  }
  return {
    prepare: async () => { await current(); },
    append: async record => {
      const { scope, instance } = await current();
      if (!active(scope)) return { persisted: false, duplicate: false, error: '账号已变化，请重新打开当前模块。' };
      const result = await instance.append(record);
      if (result.persisted) await publish(scope, instance);
      return result;
    },
    page: async options => (await current()).instance.page(options),
    summary: async () => (await current()).instance.summary(),
    exportCsv: async () => (await current()).instance.exportCsv()
  };
}
