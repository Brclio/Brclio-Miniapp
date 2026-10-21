/** Per-round completions are append-only; the older best-score summary is separate. */
export type CompletionRecord = {
  id: string;
  levelId: number | string;
  levelTitle: string;
  mode: 'theme' | 'curriculum';
  stageId?: string;
  stageTitle?: string;
  round?: number;
  wordCount: number;
  gameSeconds: number;
  studySeconds: number;
  totalSeconds: number;
  score: number;
  stars: number;
  assists: number;
  completedAt: string;
};

type Persistence = { persisted: boolean; error?: string };
export type CompletionWrite = Persistence & { duplicate: boolean };
export type CompletionPage = Persistence & { records: CompletionRecord[]; total: number };
export type CompletionSummary = Persistence & { total: number; latest: CompletionRecord | null; fastest: CompletionRecord | null };

const DB_NAME = 'lingotiles.history.v1';
const STORE = 'completions';
const STORAGE_NOTICE = '通关记录暂时只保存在本页，刷新或关闭页面后可能丢失。请导出 CSV 备份。';

function safeText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
}

export function validateCompletion(value: CompletionRecord): boolean {
  if (typeof value.levelId === 'number' && (!Number.isSafeInteger(value.levelId) || value.levelId < 1)) return false;
  if (!safeText(value.id, 200) || !safeText(String(value.levelId), 200) || !safeText(value.levelTitle, 200)) return false;
  if (value.mode !== 'theme' && value.mode !== 'curriculum') return false;
  for (const optional of [value.stageId, value.stageTitle]) if (optional !== undefined && !safeText(optional, 200)) return false;
  if (value.round !== undefined && (!Number.isSafeInteger(value.round) || value.round < 1)) return false;
  for (const count of [value.wordCount, value.score, value.stars, value.assists]) if (!Number.isSafeInteger(count) || count < 0) return false;
  if (value.wordCount < 1 || value.stars < 1 || value.stars > 3) return false;
  for (const seconds of [value.gameSeconds, value.studySeconds, value.totalSeconds]) if (!Number.isFinite(seconds) || seconds < 0) return false;
  if (Math.abs(value.totalSeconds - value.gameSeconds - value.studySeconds) > 0.001) return false;
  return typeof value.completedAt === 'string' && Number.isFinite(Date.parse(value.completedAt));
}

function browserIndexedDB(): IDBFactory | null {
  try { return globalThis.indexedDB ?? null; } catch { return null; }
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法读取本地通关记录'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('通关记录写入被中止'));
    transaction.onerror = () => reject(transaction.error ?? new Error('无法保存通关记录'));
  });
}

function newestFirst(a: CompletionRecord, b: CompletionRecord): number {
  return b.completedAt.localeCompare(a.completedAt) || b.id.localeCompare(a.id);
}

function summarize(records: CompletionRecord[], persisted: boolean): CompletionSummary {
  const sorted = [...records].sort(newestFirst);
  const fastest = sorted.reduce<CompletionRecord | null>((best, record) => !best || record.gameSeconds < best.gameSeconds ? record : best, null);
  return { total: sorted.length, latest: sorted[0] ?? null, fastest, persisted, ...(!persisted ? { error: STORAGE_NOTICE } : {}) };
}

/** Injectable factory allows real IndexedDB behavior to be exercised in tests. */
export class CompletionHistoryStore {
  private factory: IDBFactory | null;
  private dbName: string;
  private opening: Promise<IDBDatabase> | null = null;
  private temporary = new Map<string, CompletionRecord>();
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(factory: IDBFactory | null = browserIndexedDB(), dbName = DB_NAME) {
    this.factory = factory;
    this.dbName = dbName;
  }

  private open(): Promise<IDBDatabase> {
    if (this.opening) return this.opening;
    if (!this.factory) return Promise.reject(new Error('当前浏览器未允许本地记录存储'));
    const factory = this.factory;
    this.opening = new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        settled = true;
        reject(new Error('本地记录存储打开超时'));
      }, 3000);
      let request: IDBOpenDBRequest;
      try { request = factory.open(this.dbName, 1); }
      catch (error) { clearTimeout(timeout); reject(error); return; }
      request.onupgradeneeded = () => {
        const database = request.result;
        const store = database.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('completedAt', ['completedAt', 'id']);
        store.createIndex('gameSeconds', ['gameSeconds', 'completedAt', 'id']);
      };
      request.onsuccess = () => {
        clearTimeout(timeout);
        const database = request.result;
        if (settled) { database.close(); return; }
        settled = true;
        database.onversionchange = () => { database.close(); this.opening = null; };
        resolve(database);
      };
      request.onerror = () => {
        clearTimeout(timeout);
        settled = true;
        reject(request.error ?? new Error('本地记录存储不可用'));
      };
      request.onblocked = () => {
        clearTimeout(timeout);
        settled = true;
        reject(new Error('本地记录存储正被其他页面占用'));
      };
    }).catch(error => { this.opening = null; throw error; });
    return this.opening;
  }

  /** A successful transaction, rather than request success, confirms persistence. */
  append(record: CompletionRecord): Promise<CompletionWrite> {
    if (!validateCompletion(record)) return Promise.resolve({ persisted: false, duplicate: false, error: '通关记录内容无效，未能保存。' });
    const immutable = structuredClone({ ...record, completedAt: new Date(record.completedAt).toISOString() });
    const operation = this.writeQueue.then(async (): Promise<CompletionWrite> => {
      const alreadyTemporary = this.temporary.has(immutable.id);
      try {
        const database = await this.open();
        const transaction = database.transaction(STORE, 'readwrite');
        const done = transactionDone(transaction);
        const store = transaction.objectStore(STORE);
        let duplicate = false;
        const read = store.get(immutable.id);
        // Queue add inside the request callback to keep the IDB transaction active.
        read.onsuccess = () => {
          duplicate = read.result !== undefined;
          if (!duplicate) store.add(this.temporary.get(immutable.id) ?? immutable);
        };
        await done;
        this.temporary.delete(immutable.id);
        return { persisted: true, duplicate: duplicate || alreadyTemporary };
      } catch {
        if (!alreadyTemporary) this.temporary.set(immutable.id, immutable);
        return { persisted: false, duplicate: alreadyTemporary, error: STORAGE_NOTICE };
      }
    });
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  private async all(): Promise<{ records: CompletionRecord[] } & Persistence> {
    await this.writeQueue;
    try {
      const database = await this.open();
      const values = await requestValue<CompletionRecord[]>(database.transaction(STORE, 'readonly').objectStore(STORE).getAll());
      const merged = new Map(this.temporary);
      values.forEach(record => merged.set(record.id, record));
      const persisted = this.temporary.size === 0;
      return { records: structuredClone([...merged.values()]).sort(newestFirst), persisted, ...(!persisted ? { error: STORAGE_NOTICE } : {}) };
    } catch {
      return { records: structuredClone([...this.temporary.values()]).sort(newestFirst), persisted: false, error: STORAGE_NOTICE };
    }
  }

  async page({ page = 1, pageSize = 20 }: { page?: number; pageSize?: number } = {}): Promise<CompletionPage> {
    const size = Number.isFinite(pageSize) ? Math.min(100, Math.max(1, Math.floor(pageSize))) : 20;
    const current = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
    await this.writeQueue;
    if (this.temporary.size === 0) {
      try {
        const database = await this.open();
        const store = database.transaction(STORE, 'readonly').objectStore(STORE);
        const totalPromise = requestValue(store.count());
        const recordsPromise = new Promise<CompletionRecord[]>((resolve, reject) => {
          const records: CompletionRecord[] = [];
          const request = store.index('completedAt').openCursor(null, 'prev');
          let advanced = false;
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor || records.length >= size) { resolve(records); return; }
            if (!advanced && current > 1) {
              const offset = (current - 1) * size;
              if (offset > 0xffffffff) { resolve([]); return; }
              advanced = true; cursor.advance(offset); return;
            }
            records.push(cursor.value as CompletionRecord);
            if (records.length === size) resolve(records); else cursor.continue();
          };
        });
        const [total, records] = await Promise.all([totalPromise, recordsPromise]);
        return { total, records, persisted: true };
      } catch { /* Fall through to the explicitly marked temporary view. */ }
    }
    const result = await this.all();
    return { ...result, total: result.records.length, records: result.records.slice((current - 1) * size, current * size) };
  }

  async summary(): Promise<CompletionSummary> {
    await this.writeQueue;
    if (this.temporary.size === 0) {
      try {
        const database = await this.open();
        const store = database.transaction(STORE, 'readonly').objectStore(STORE);
        const [total, latest, fastest] = await Promise.all([
          requestValue(store.count()),
          requestValue(store.index('completedAt').openCursor(null, 'prev')),
          requestValue(store.index('gameSeconds').openCursor()),
        ]);
        return { total, latest: (latest?.value as CompletionRecord | undefined) ?? null, fastest: (fastest?.value as CompletionRecord | undefined) ?? null, persisted: true };
      } catch { /* Fall through to the explicitly marked temporary view. */ }
    }
    const result = await this.all();
    return summarize(result.records, result.persisted);
  }

  async exportCsv(): Promise<{ csv: string } & Persistence> {
    const { records, ...status } = await this.all();
    return { ...status, csv: completionsToCsv(records) };
  }

  async close(): Promise<void> {
    await this.writeQueue;
    if (this.opening) { try { (await this.opening).close(); } catch { /* Already unavailable. */ } }
    this.opening = null;
  }
}

/** Always quote cells and neutralize spreadsheet formulas, including whitespace prefixes. */
export function csvCell(value: string | number | undefined): string {
  let text = value === undefined ? '' : String(value);
  if (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function completionsToCsv(records: CompletionRecord[]): string {
  const header = ['记录 ID', '完成时间', '模式', '关卡 ID', '关卡名称', '阶段 ID', '阶段', '第几关', '单词数', '消除用时（秒）', '记忆用时（秒）', '总用时（秒）', '得分', '星级', '道具次数'];
  const rows = records.map(record => [record.id, record.completedAt, record.mode === 'theme' ? '经典主题' : '分级课程', record.levelId, record.levelTitle, record.stageId, record.stageTitle, record.round, record.wordCount, record.gameSeconds, record.studySeconds, record.totalSeconds, record.score, record.stars, record.assists]);
  return '\uFEFF' + [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const defaultStore = new CompletionHistoryStore();
export const appendCompletion = (record: CompletionRecord): Promise<CompletionWrite> => defaultStore.append(record);
export const getCompletionPage = (options?: { page?: number; pageSize?: number }): Promise<CompletionPage> => defaultStore.page(options);
export const getCompletionSummary = (): Promise<CompletionSummary> => defaultStore.summary();
export const exportCompletionsCsv = (): Promise<{ csv: string } & Persistence> => defaultStore.exportCsv();
