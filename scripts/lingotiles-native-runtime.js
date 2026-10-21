'use strict';

// Kept outside the web project: native requests and storage never change globals.
const temporaryValues = new Map();
const unreadableKeys = new Set();
function platform() { return typeof wx === 'undefined' ? null : wx; }
function copy(value) { return JSON.parse(JSON.stringify(value)); }

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
    if (temporaryValues.has(key)) return temporaryValues.get(key);
    const api = platform();
    if (!api) return null;
    try {
      const value = api.getStorageSync(key);
      unreadableKeys.delete(key);
      return value === undefined || value === '' ? null : String(value);
    } catch (error) {
      unreadableKeys.add(key);
      throw error;
    }
  },
  setItem(key, value) {
    const api = platform();
    try {
      if (!api || !api.setStorageSync) throw new Error('本地存储不可用');
      // A fallback display after a denied read must not overwrite unknown progress.
      if (unreadableKeys.has(key)) throw new Error('原有进度暂时不可读取，已保护原始存档');
      api.setStorageSync(key, value);
      temporaryValues.delete(key);
    } catch (error) {
      temporaryValues.set(key, value);
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

/** One immutable file per completion avoids a storage-key limit or capped history. */
function createHistoryClass(validateCompletion, completionsToCsv) {
  return class NativeCompletionHistoryStore {
    constructor(api = platform(), directory) {
      this.api = api;
      this.directory = directory || (api && api.env ? api.env.USER_DATA_PATH + '/lingotiles-history-v1' : '');
      this.temporary = new Map();
      this.fileCache = new Map();
      this.writeQueue = Promise.resolve();
      this.nonce = 0;
    }

    filesystem() {
      if (!this.api || !this.api.getFileSystemManager || !this.directory) throw new Error('本地文件存储不可用');
      return this.api.getFileSystemManager();
    }

    read() {
      const records = new Map();
      let persisted = true;
      try {
        const fs = this.filesystem();
        try { fs.accessSync(this.directory); } catch (_) { fs.mkdirSync(this.directory, true); }
        const names = fs.readdirSync(this.directory);
        const present = new Set(names);
        for (const name of this.fileCache.keys()) if (!present.has(name)) this.fileCache.delete(name);
        for (const name of names) {
          if (!/^round-[a-f0-9]+-\d+\.json$/.test(name)) continue;
          // Damaged files cause a visible persistence notice; valid history stays exportable.
          try {
            // Files are immutable after rename. Read each body once per app open;
            // newly added files are still discovered without an O(N) disk reread.
            let value = this.fileCache.get(name);
            if (!value) {
              value = JSON.parse(fs.readFileSync(this.directory + '/' + name, 'utf8'));
              if (!validateCompletion(value)) throw new Error('无效记录');
              this.fileCache.set(name, value);
            }
            if (!records.has(value.id)) records.set(value.id, value);
          } catch (_) { persisted = false; }
        }
      } catch (_) { persisted = false; }
      for (const [id, value] of this.temporary) if (!records.has(id)) records.set(id, value);
      if (this.temporary.size) persisted = false;
      return { records: [...records.values()].sort(newestFirst), persisted, ...(!persisted ? { error: STORAGE_NOTICE } : {}) };
    }

    append(record) {
      if (!record || !validateCompletion(record)) return Promise.resolve({ persisted: false, duplicate: false, error: '通关记录内容无效，未能保存。' });
      const immutable = copy({ ...record, completedAt: new Date(record.completedAt).toISOString() });
      const operation = this.writeQueue.then(() => {
        const view = this.read();
        const previous = view.records.find(value => value.id === immutable.id);
        const alreadyTemporary = this.temporary.has(immutable.id);
        if (previous && !alreadyTemporary) return { persisted: view.persisted, duplicate: true, ...(!view.persisted ? { error: STORAGE_NOTICE } : {}) };
        const value = previous || immutable;
        let pending;
        try {
          const fs = this.filesystem();
          const prefix = this.directory + '/round-' + hash(value.id) + '-';
          let index = 0;
          let destination;
          while (true) {
            destination = prefix + index + '.json';
            try { fs.accessSync(destination); index++; } catch (_) { break; }
          }
          pending = destination + '.pending-' + (++this.nonce);
          fs.writeFileSync(pending, JSON.stringify(value), 'utf8');
          // Rename succeeds only after the whole immutable record is written.
          fs.renameSync(pending, destination);
          this.fileCache.set(destination.slice(this.directory.length + 1), value);
          this.temporary.delete(immutable.id);
          return { persisted: true, duplicate: !!previous };
        } catch (_) {
          if (pending) { try { this.filesystem().unlinkSync(pending); } catch (_) {} }
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
}

function writeExportFile(text, extension, prefix = 'lingotiles') {
  const api = platform();
  if (!api || !api.env || !api.getFileSystemManager) throw new Error('当前环境不能导出文件。');
  const filePath = api.env.USER_DATA_PATH + '/' + prefix + '-' + Date.now() + '.' + extension;
  try { api.getFileSystemManager().writeFileSync(filePath, text, 'utf8'); }
  catch (_) { throw new Error('导出失败：本地空间不足或文件暂时不可写，请清理空间后重试。'); }
  return filePath;
}

module.exports = { nativeFetch, assetUrl, nativeStorage, createHistoryClass, writeExportFile };
