import seed from '../data/illustrations.seed.json' with { type: 'json' };
import { illustrationBucket, illustrationSenseKey, type IllustrationEntry, type IllustrationManifest, type IllustratedSense } from '../data/illustrationSchema.ts';
export type { IllustratedSense } from '../data/illustrationSchema.ts';
export type WordIllustration = { src: string; alt: string };

/** Only the original themes are bundled; the full-library index loads by small buckets. */
export const WORD_ILLUSTRATIONS: ReadonlyArray<IllustrationEntry> = seed;
const senseKey = illustrationSenseKey;
const illustrations = new Map(WORD_ILLUSTRATIONS.map(item => [senseKey(item), item]));

export function getWordIllustration(word: IllustratedSense): WordIllustration | null {
  return illustrations.get(senseKey(word)) ?? null;
}

let manifestPromise: Promise<IllustrationManifest> | undefined;
const buckets = new Map<string, Promise<void>>();
export function loadIllustrationManifest(): Promise<IllustrationManifest> {
  if (!manifestPromise) manifestPromise = fetch('./images/words/index/manifest.json', { signal: AbortSignal.timeout(5000) }).then(async response => {
    if (!response.ok) throw Error('配图索引暂不可用');
    const value = await response.json() as IllustrationManifest;
    if (value.version !== 1 || value.total !== 100000 || !Number.isInteger(value.ready) || value.ready < 0 || value.ready > value.total || value.pending !== value.total - value.ready || !value.buckets || typeof value.buckets !== 'object' || Array.isArray(value.buckets) || typeof value.revision !== 'string') throw Error('配图索引格式异常');
    const parts = Object.entries(value.buckets);
    if (!parts.every(([bucket, part]) => /^[a-f0-9]{2}$/.test(bucket) && part && part.path === `images/words/index/${bucket}.json` && Number.isInteger(part.count) && part.count > 0)
      || parts.reduce((sum, [, part]) => sum + part.count, 0) !== value.ready) throw Error('配图索引数量异常');
    return value;
  }).catch(error => { manifestPromise = undefined; throw error; });
  return manifestPromise;
}

/** Missing or failed indexes keep a round playable and retry on a later visit. */
export async function loadWordIllustrations(words: IllustratedSense[]): Promise<void> {
  const missing = words.filter(word => !getWordIllustration(word));
  if (!missing.length) return;
  try {
    const manifest = await loadIllustrationManifest();
    const required = new Set(missing.map(illustrationBucket));
    await Promise.allSettled([...required].map(bucket => {
      const part = manifest.buckets[bucket];
      if (!part) return;
      if (!buckets.has(bucket)) {
        const loading = (async () => {
          if (part.path !== `images/words/index/${bucket}.json`) throw Error('配图分片路径异常');
          const response = await fetch(`./${part.path}?v=${manifest.revision}`, { signal: AbortSignal.timeout(5000) });
          if (!response.ok) throw Error('配图分片暂不可用');
          const entries: unknown = await response.json();
          if (!Array.isArray(entries) || entries.length !== part.count) throw Error('配图分片不完整');
          const valid = entries.every((entry: IllustrationEntry) => entry && ['word', 'pos', 'meaning', 'src', 'alt'].every(key => typeof entry[key as keyof IllustrationEntry] === 'string' && entry[key as keyof IllustrationEntry].length > 0)
            && /^\.\/images\/words\/[a-zA-Z0-9/_-]+\.webp$/.test(entry.src) && illustrationBucket(entry) === bucket);
          if (!valid) throw Error('配图分片格式异常');
          for (const entry of entries as IllustrationEntry[]) illustrations.set(senseKey(entry), entry);
        })().catch(error => { buckets.delete(bucket); throw error; });
        buckets.set(bucket, loading);
      }
      return buckets.get(bucket);
    }));
  } catch { /* Images complement vocabulary; an unavailable picture must not block learning. */ }
}

const preloaded = new Map<string, HTMLImageElement>();
/** Warm only this level's images. Never block the memorization or match timers. */
export function preloadWordIllustrations(words: IllustratedSense[]): void {
  if (typeof Image === 'undefined') return;
  for (const word of words) {
    const image = getWordIllustration(word);
    if (!image || preloaded.has(image.src)) continue;
    const element = new Image();
    preloaded.set(image.src, element);
    if (preloaded.size > 32) preloaded.delete(preloaded.keys().next().value!);
    element.onerror = () => { if (preloaded.get(image.src) === element) preloaded.delete(image.src); };
    element.src = image.src;
  }
}

export type PendingIllustration = IllustratedSense & { firstPlayedAt: string };
const QUEUE_KEY = 'lingotiles.illustrations.pending.v1';
type QueueStorage = Pick<Storage, 'getItem' | 'setItem'>;
function browserStorage(): QueueStorage | null {
  if (typeof window === 'undefined') return null;
  try { return globalThis.localStorage ?? null; } catch { return null; }
}
function isPending(value: unknown): value is PendingIllustration {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return ['word', 'pos', 'meaning'].every(key => typeof record[key] === 'string' && (record[key] as string).trim().length > 0 && (record[key] as string).length <= 1000)
    && typeof record.firstPlayedAt === 'string' && Number.isFinite(Date.parse(record.firstPlayedAt));
}

/** Records only words actually matched; no dictionary-wide guessing or remote calls. */
export class IllustrationQueue {
  private temporary = new Map<string, PendingIllustration>();
  private storage: QueueStorage | null;
  constructor(storage: QueueStorage | null = browserStorage()) { this.storage = storage; }

  list(): PendingIllustration[] {
    const records = new Map<string, PendingIllustration>();
    try {
      const parsed: unknown = JSON.parse(this.storage?.getItem(QUEUE_KEY) ?? '[]');
      if (Array.isArray(parsed)) for (const value of parsed) if (isPending(value)) {
        const { word, pos, meaning, firstPlayedAt } = value;
        records.set(senseKey(value), { word, pos, meaning, firstPlayedAt });
      }
    } catch { /* Keep any in-session records available when local storage fails. */ }
    for (const [key, value] of this.temporary) if (!records.has(key)) records.set(key, value);
    return [...records.values()].filter(value => !getWordIllustration(value)).sort((a, b) => a.firstPlayedAt.localeCompare(b.firstPlayedAt));
  }

  add(word: IllustratedSense, now = new Date().toISOString()): boolean {
    if (getWordIllustration(word)) return true;
    const value = { word: word.word, pos: word.pos, meaning: word.meaning, firstPlayedAt: now };
    if (!isPending(value)) return false;
    const records = this.list();
    const key = senseKey(word);
    if (!records.some(item => senseKey(item) === key)) records.push(value);
    this.temporary = new Map(records.map(item => [senseKey(item), item]));
    try {
      if (!this.storage) return false;
      this.storage.setItem(QUEUE_KEY, JSON.stringify(records));
      this.temporary.clear();
      return true;
    } catch { return false; }
  }
}

const queue = new IllustrationQueue();
export const recordIllustrationPractice = (word: IllustratedSense): boolean => queue.add(word);
export const getMissingIllustrations = (): PendingIllustration[] => queue.list();

/** Downloading a batch does not erase it. Newly approved senses disappear automatically. */
export function exportMissingIllustrations(): void {
  const words = queue.list();
  const blob = new Blob([JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), words }, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `lingotiles-待配图-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
