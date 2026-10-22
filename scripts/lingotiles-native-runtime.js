'use strict';

// Kept outside the web project: native requests and storage never change globals.
const temporaryValues = new Map();
const unreadableKeys = new Set();
const HISTORY_KEY = 'lingotiles.history.v1';
const HISTORY_LIMIT = 200;
const HISTORY_BYTES = 200 * 1024 - 1024;
const GUEST_HISTORY_CLAIM = 'brclio.lingotiles.guest-history-claim.v1';
const guestSnapshots = new Map();
let accountSync = null;
let historyFactory = null;
let unsubscribeSync = null;
function platform() { return typeof wx === 'undefined' ? null : wx; }
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function captureGuestOwner() {
  try { if (historyFactory && getScope() !== 'guest') new historyFactory().captureGuest(); }
  catch (_) { /* A later history read retries without using another scope. */ }
}
function configureAccountSync(value) {
  if (unsubscribeSync) unsubscribeSync();
  accountSync = value || null;
  unsubscribeSync = accountSync && accountSync.subscribe ? accountSync.subscribe(captureGuestOwner) : null;
  captureGuestOwner();
}
function getScope() {
  const scope = accountSync && accountSync.getScope ? accountSync.getScope() : 'guest';
  if (scope !== 'guest' && !/^[a-f0-9]{32}$/.test(scope)) throw new Error('账号数据暂不可读取');
  return scope;
}
function storageApi() { return accountSync && accountSync.storage || platform(); }
function memoryKey(scope, key) { return scope + '\0' + key; }

function assetUrl(path) {
  // The config stays external to the bundle so configure.js can update it.
  const config = require('../config');
  return String(config.webOrigin || '').replace(/\/$/, '') + '/projects/lingotiles/' + String(path).replace(/^\.\//, '').replace(/^\//, '');
}

function nativeFetch(url) {
  return new Promise((resolve, reject) => {
    const api = platform();
    if (!api || !api.request) { reject(new Error('请连接网络后读取分级词库。')); return; }
    api.request({
      url, method: 'GET', dataType: 'json', timeout: 15000,
      success(response) {
        const status = response.statusCode;
        resolve({ ok: status >= 200 && status < 300, status,
          json: async () => typeof response.data === 'string' ? JSON.parse(response.data) : response.data });
      },
      fail() { reject(new Error('词库暂时无法连接，请检查网络后重试。')); }
    });
  });
}

const nativeStorage = {
  getItem(key) {
    const scoped = memoryKey(getScope(), key);
    if (temporaryValues.has(scoped)) return temporaryValues.get(scoped);
    const api = storageApi();
    if (!api) return null;
    try {
      const value = api.getItem ? api.getItem(key) : api.getStorageSync(key);
      unreadableKeys.delete(scoped);
      return value === undefined || value === '' || value === null ? null : typeof value === 'string' ? value : JSON.stringify(value);
    } catch (error) {
      unreadableKeys.add(scoped);
      throw error;
    }
  },
  setItem(key, value) {
    const scoped = memoryKey(getScope(), key);
    const api = storageApi();
    try {
      if (!api || (!api.setItem && !api.setStorageSync)) throw new Error('本地存储不可用');
      // A fallback display after a denied read must not overwrite unknown progress.
      if (unreadableKeys.has(scoped)) throw new Error('原有进度暂时不可读取，已保护原始存档');
      if (api.setItem) api.setItem(key, value); else api.setStorageSync(key, value);
      temporaryValues.delete(scoped);
    } catch (error) {
      temporaryValues.set(scoped, value);
      throw error;
    }
  }
};

const STORAGE_NOTICE = '通关记录暂时只保存在本次打开的小程序中，退出后可能丢失。请导出 CSV 备份。';
function newestFirst(a, b) { return b.completedAt.localeCompare(a.completedAt) || b.id.localeCompare(a.id); }
function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) { value ^= text.charCodeAt(i); value = Math.imul(value, 16777619); }
  return (value >>> 0).toString(16).padStart(8, '0');
}
function jsonBytes(value) {
  const text = JSON.stringify(value);
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
}
function recentRecords(records) {
  const selected = [];
  let bytes = 2;
  for (const record of records.slice().sort(newestFirst).slice(0, HISTORY_LIMIT)) {
    const value = {};
    for (const key of ['id', 'levelId', 'levelTitle', 'mode', 'wordCount', 'gameSeconds', 'studySeconds', 'totalSeconds', 'score', 'stars', 'assists', 'completedAt', 'stageId', 'stageTitle', 'round']) {
      if (record[key] !== undefined) value[key] = record[key];
    }
    const next = bytes + jsonBytes(value) + (selected.length ? 1 : 0);
    if (next > HISTORY_BYTES) break;
    selected.push(value);
    bytes = next;
  }
  return selected;
}

/** One immutable file per completion avoids a storage-key limit or capped history. */
function createHistoryClass(validateCompletion, completionsToCsv) {
  function valid(record) {
    try { return !!record && typeof record === 'object' && !Array.isArray(record) && ['string', 'number'].includes(typeof record.levelId) && validateCompletion(record); }
    catch (_) { return false; }
  }
  const HistoryStore = class NativeCompletionHistoryStore {
    constructor(api = platform(), directory, scope = getScope()) {
      this.api = api;
      if (scope !== 'guest' && !/^[a-f0-9]{32}$/.test(scope)) throw new Error('账号数据暂不可读取');
      this.scope = scope;
      this.guestDirectory = api && api.env ? api.env.USER_DATA_PATH + '/lingotiles-history-v1' : '';
      this.directory = directory || (scope === 'guest' ? this.guestDirectory : this.guestDirectory && this.guestDirectory + '/users/' + scope);
      this.temporary = new Map();
      this.fileCache = new Map();
      this.writeQueue = Promise.resolve();
      this.nonce = 0;
      this.guestImported = false;
    }

    filesystem() {
      if (!this.api || !this.api.getFileSystemManager || !this.directory) throw new Error('本地文件存储不可用');
      return this.api.getFileSystemManager();
    }

    active() { return getScope() === this.scope; }

    readFiles(directory = this.directory, cache = this.fileCache, allowedNames) {
      const records = new Map();
      let persisted = true;
      try {
        const fs = this.filesystem();
        try { fs.accessSync(directory); } catch (_) { fs.mkdirSync(directory, true); }
        let names = fs.readdirSync(directory);
        const present = new Set(names);
        if (allowedNames) {
          if (allowedNames.some(name => !present.has(name))) persisted = false;
          const allowed = new Set(allowedNames);
          names = names.filter(name => allowed.has(name));
        }
        for (const name of cache.keys()) if (!present.has(name)) cache.delete(name);
        for (const name of names) {
          if (!/^round-[a-f0-9]+-\d+\.json$/.test(name)) continue;
          // Damaged files cause a visible persistence notice; valid history stays exportable.
          try {
            // Files are immutable after rename. Read each body once per app open;
            // newly added files are still discovered without an O(N) disk reread.
            let value = cache.get(name);
            if (!value) {
              value = JSON.parse(fs.readFileSync(directory + '/' + name, 'utf8'));
              if (!valid(value)) throw new Error('无效记录');
              cache.set(name, value);
            }
            if (!records.has(value.id)) records.set(value.id, value);
          } catch (_) { persisted = false; }
        }
      } catch (_) { persisted = false; }
      return { records, persisted };
    }

    writeRecord(value) {
      const fs = this.filesystem();
      try { fs.accessSync(this.directory); } catch (_) { fs.mkdirSync(this.directory, true); }
      const prefix = this.directory + '/round-' + hash(value.id) + '-';
      let index = 0, destination, pending;
      while (true) {
        destination = prefix + index + '.json';
        try { fs.accessSync(destination); index++; } catch (_) { break; }
      }
      try {
        pending = destination + '.pending-' + (++this.nonce);
        fs.writeFileSync(pending, JSON.stringify(value), 'utf8');
        fs.renameSync(pending, destination);
        this.fileCache.set(destination.slice(this.directory.length + 1), value);
      } catch (error) {
        if (pending) { try { fs.unlinkSync(pending); } catch (_) {} }
        throw error;
      }
    }

    captureGuest() {
      if (this.scope === 'guest' || !this.active() || !accountSync || !accountSync.getGuestOwner || accountSync.getGuestOwner() !== this.scope) return null;
      const snapshot = () => {
        const fs = this.filesystem();
        try { fs.accessSync(this.guestDirectory); } catch (_) { fs.mkdirSync(this.guestDirectory, true); }
        return { version: 1, owner: this.scope, files: fs.readdirSync(this.guestDirectory).filter(name => /^round-[a-f0-9]+-\d+\.json$/.test(name)).sort() };
      };
      let saved;
      try { saved = this.api.getStorageSync(GUEST_HISTORY_CLAIM); }
      catch (error) { if (!guestSnapshots.has(this.scope)) guestSnapshots.set(this.scope, snapshot()); throw error; }
      if (saved === undefined || saved === null || saved === '') {
        saved = guestSnapshots.get(this.scope) || snapshot();
        guestSnapshots.set(this.scope, saved);
        this.api.setStorageSync(GUEST_HISTORY_CLAIM, saved);
      }
      if (!saved || saved.version !== 1 || saved.owner !== this.scope || !Array.isArray(saved.files) || saved.files.some(name => typeof name !== 'string' || !/^round-[a-f0-9]+-\d+\.json$/.test(name))) throw new Error(STORAGE_NOTICE);
      return saved;
    }

    importGuest() {
      if (this.guestImported || this.scope === 'guest' || !this.active() || !accountSync || !accountSync.getGuestOwner || accountSync.getGuestOwner() !== this.scope) return;
      const fs = this.filesystem(), marker = this.directory + '/guest-imported-v1.json';
      try { fs.accessSync(this.directory); } catch (_) { fs.mkdirSync(this.directory, true); }
      // An existing but unreadable marker must not turn into permission to
      // claim guest records created after the original migration.
      if (fs.readdirSync(this.directory).includes('guest-imported-v1.json')) {
        const value = JSON.parse(fs.readFileSync(marker, 'utf8'));
        if (!value || value.version !== 1 || value.owner !== this.scope) throw new Error(STORAGE_NOTICE);
        this.guestImported = true;
        return;
      }
      const snapshot = this.captureGuest();
      if (!snapshot) return;
      const guest = this.readFiles(this.guestDirectory, new Map(), snapshot.files);
      const own = this.readFiles();
      for (const record of guest.records.values()) if (!own.records.has(record.id)) this.writeRecord(copy(record));
      if (!guest.persisted || !own.persisted) throw new Error(STORAGE_NOTICE);
      const pending = marker + '.pending-' + (++this.nonce);
      try {
        fs.writeFileSync(pending, JSON.stringify({ version: 1, owner: this.scope }), 'utf8');
        fs.renameSync(pending, marker);
        this.guestImported = true;
      } catch (error) { try { fs.unlinkSync(pending); } catch (_) {} throw error; }
    }

    read() {
      let imported = true;
      try { this.importGuest(); } catch (_) { imported = false; }
      const local = this.readFiles(), records = local.records;
      for (const id of this.temporary.keys()) if (records.has(id)) this.temporary.delete(id);
      let persisted = local.persisted && imported, cloudReadable = true;
      if (this.active()) {
        try {
          const api = storageApi();
          let cloud = api && api.getStorageSync ? api.getStorageSync(HISTORY_KEY) : null;
          if (typeof cloud === 'string' && cloud !== '') cloud = JSON.parse(cloud);
          if (cloud !== undefined && cloud !== null && cloud !== '' && !Array.isArray(cloud)) throw new Error('无效记录');
          for (const record of cloud || []) {
            if (!valid(record)) { cloudReadable = false; continue; }
            if (records.has(record.id)) continue;
            const value = copy({ ...record, completedAt: new Date(record.completedAt).toISOString() });
            try { this.writeRecord(value); records.set(value.id, value); this.temporary.delete(value.id); }
            catch (_) { this.temporary.set(value.id, value); persisted = false; }
          }
        } catch (_) { cloudReadable = false; }
        if (persisted && cloudReadable) this.publish([...records.values()]);
      }
      for (const [id, value] of this.temporary) if (!records.has(id)) records.set(id, value);
      if (this.temporary.size) persisted = false;
      return { records: [...records.values()].sort(newestFirst), persisted, ...(!persisted ? { error: STORAGE_NOTICE } : {}) };
    }

    publish(records) {
      if (!this.active()) return;
      try {
        const api = storageApi();
        if (!api || !api.setStorageSync) return;
        const recent = recentRecords(records);
        const previous = api.getStorageSync(HISTORY_KEY);
        if (JSON.stringify(previous) !== JSON.stringify(recent)) api.setStorageSync(HISTORY_KEY, recent);
      } catch (_) { /* Complete files remain the source for a later sync retry. */ }
    }

    prepareSync() { return this.read(); }

    append(record) {
      if (!valid(record)) return Promise.resolve({ persisted: false, duplicate: false, error: '通关记录内容无效，未能保存。' });
      const immutable = copy({ ...record, completedAt: new Date(record.completedAt).toISOString() });
      const operation = this.writeQueue.then(() => {
        const view = this.read();
        const previous = view.records.find(value => value.id === immutable.id);
        const alreadyTemporary = this.temporary.has(immutable.id);
        if (previous && !alreadyTemporary) return { persisted: view.persisted, duplicate: true, ...(!view.persisted ? { error: STORAGE_NOTICE } : {}) };
        const value = previous || immutable;
        try {
          this.writeRecord(value);
          this.temporary.delete(immutable.id);
          if (this.active()) this.read();
          return { persisted: true, duplicate: !!previous };
        } catch (_) {
          if (!alreadyTemporary) this.temporary.set(immutable.id, immutable);
          return { persisted: false, duplicate: alreadyTemporary, error: STORAGE_NOTICE };
        }
      });
      this.writeQueue = operation.catch(() => undefined);
      return operation;
    }

    async page({ page = 1, pageSize = 20 } = {}) {
      await this.writeQueue;
      const view = this.read();
      const size = Number.isFinite(pageSize) ? Math.min(100, Math.max(1, Math.floor(pageSize))) : 20;
      const current = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
      return { ...view, total: view.records.length, records: copy(view.records.slice((current - 1) * size, current * size)) };
    }

    async summary() {
      await this.writeQueue;
      const { records, ...status } = this.read();
      const fastest = records.reduce((best, value) => !best || value.gameSeconds < best.gameSeconds ? value : best, null);
      return copy({ ...status, total: records.length, latest: records[0] || null, fastest });
    }

    async exportCsv() {
      await this.writeQueue;
      const { records, ...status } = this.read();
      return { ...status, csv: completionsToCsv(records) };
    }

    async close() { await this.writeQueue; }
  };
  historyFactory = HistoryStore;
  captureGuestOwner();
  return HistoryStore;
}

function writeExportFile(text, extension, prefix = 'lingotiles') {
  const api = platform();
  if (!api || !api.env || !api.getFileSystemManager) throw new Error('当前环境不能导出文件。');
  const filePath = api.env.USER_DATA_PATH + '/' + prefix + '-' + Date.now() + '.' + extension;
  try { api.getFileSystemManager().writeFileSync(filePath, text, 'utf8'); }
  catch (_) { throw new Error('导出失败：本地空间不足或文件暂时不可写，请清理空间后重试。'); }
  return filePath;
}

module.exports = { nativeFetch, assetUrl, nativeStorage, createHistoryClass, writeExportFile, configureAccountSync, getScope };
