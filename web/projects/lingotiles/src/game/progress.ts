import { LEVELS } from '../data/vocabulary.ts';

export type Progress = {
  completed: Record<string, { stars: number; bestScore: number; bestTime: number }>;
  seen: string[];
  saved: string[];
  sessions: number;
  lastPlayed: string | null;
  streak: number;
  lastResultId?: string;
};

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export type GameResult = {
  id?: string;
  levelId: number | string;
  stars: number;
  score: number;
  timeSeconds: number;
  wordIds: string[];
  playedAt?: Date;
};

export const PROGRESS_STORAGE_KEY = 'lingotiles.progress.v1';
export const EMPTY_PROGRESS: Progress = {
  completed: {},
  seen: [],
  saved: [],
  sessions: 0,
  lastPlayed: null,
  streak: 0,
};

const validWordIds = new Set(LEVELS.flatMap((level) => level.words.map((word) => word.id)));
const validLevelIds = new Set(LEVELS.map((level) => String(level.id)));

function validLevelId(id: string): boolean {
  if (validLevelIds.has(id)) return true;
  const value = Number(id);
  return /^\d+$/.test(id) && Number.isSafeInteger(value) && value >= 100001 && value <= 160000;
}

/** External entries remain valid before their dictionary chunk is loaded. */
function validWordId(id: string): boolean {
  return validWordIds.has(id) || (id.length <= 200 && /^dict:[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .,'’()&/+_-]*$/u.test(id));
}

function validResultId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 200 && !/[\u0000-\u001f\u007f]/.test(id);
}
const MAX_COUNT = 1_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedNumber(value: unknown, fallback = 0, maximum = MAX_COUNT): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(0, Math.floor(value)))
    : fallback;
}

function cleanWordIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string' && validWordId(id)))]
    : [];
}

function validDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function cleanProgress(value: unknown): Progress {
  const source = isRecord(value) ? value : {};
  const completed: Progress['completed'] = {};
  if (isRecord(source.completed)) {
    for (const [id, result] of Object.entries(source.completed)) {
      if (!validLevelId(id) || !isRecord(result)) continue;
      if (!['stars', 'bestScore', 'bestTime'].every((key) => typeof result[key] === 'number' && Number.isFinite(result[key]) && result[key] >= 0)) continue;
      const stars = boundedNumber(result.stars, 0, 3);
      if (stars < 1) continue;
      completed[id] = {
        stars,
        bestScore: boundedNumber(result.bestScore),
        bestTime: boundedNumber(result.bestTime, 0, 86_400),
      };
    }
  }
  const lastPlayed = validDay(source.lastPlayed) ? source.lastPlayed : null;
  return {
    completed,
    seen: cleanWordIds(source.seen),
    saved: cleanWordIds(source.saved),
    sessions: boundedNumber(source.sessions),
    lastPlayed,
    streak: lastPlayed === null ? 0 : boundedNumber(source.streak),
    ...(validResultId(source.lastResultId) ? { lastResultId: source.lastResultId } : {}),
  };
}

function browserStorage(): StorageLike | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

/** Returns a fresh, validated object even when storage is blocked or damaged. */
export function loadProgress(storage: StorageLike | null = browserStorage()): Progress {
  try {
    const stored = storage?.getItem(PROGRESS_STORAGE_KEY);
    return cleanProgress(stored ? JSON.parse(stored) : null);
  } catch {
    return cleanProgress(null);
  }
}

/** Storage failures do not interrupt a running game; callers may show a notice. */
export function saveProgress(progress: Progress, storage: StorageLike | null = browserStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(cleanProgress(progress)));
    return true;
  } catch {
    return false;
  }
}

export function toggleSaved(progress: Progress, wordId: string): Progress {
  const next = cleanProgress(progress);
  if (!validWordId(wordId)) return next;
  next.saved = next.saved.includes(wordId)
    ? next.saved.filter((id) => id !== wordId)
    : [...next.saved, wordId];
  return next;
}

export function markSeen(progress: Progress, wordIds: string[]): Progress {
  const next = cleanProgress(progress);
  next.seen = cleanWordIds([...next.seen, ...wordIds]);
  return next;
}

function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** A streak is still active before today's practice only if yesterday was played. */
export function getCurrentStreak(progress: Progress, now = new Date()): number {
  if (!Number.isFinite(now.getTime()) || !validDay(progress.lastPlayed)) return 0;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return progress.lastPlayed === localDay(now) || progress.lastPlayed === localDay(yesterday)
    ? boundedNumber(progress.streak)
    : 0;
}

/** Records a completed round. Each best value is retained independently. */
export function recordResult(progress: Progress, result: GameResult): Progress {
  const next = cleanProgress(progress);
  const levelId = String(result.levelId);
  if (validResultId(result.id) && next.lastResultId === result.id) return next;
  if (!validLevelId(levelId) || result.stars < 1 || !Number.isFinite(result.stars) || !Number.isFinite(result.score) || result.score < 0 || !Number.isFinite(result.timeSeconds) || result.timeSeconds < 0) return next;

  const stars = boundedNumber(result.stars, 0, 3);
  const score = boundedNumber(result.score);
  const time = boundedNumber(result.timeSeconds, 0, 86_400);
  const previous = next.completed[levelId];
  next.completed[levelId] = {
    stars: Math.max(previous?.stars ?? 0, stars),
    bestScore: Math.max(previous?.bestScore ?? 0, score),
    bestTime: previous ? Math.min(previous.bestTime, time) : time,
  };
  next.seen = cleanWordIds([...next.seen, ...result.wordIds]);
  next.sessions = Math.min(MAX_COUNT, next.sessions + 1);

  const playedAt = result.playedAt && Number.isFinite(result.playedAt.getTime()) ? result.playedAt : new Date();
  const today = localDay(playedAt);
  const yesterday = new Date(playedAt);
  yesterday.setDate(yesterday.getDate() - 1);
  if (next.lastPlayed !== today) {
    next.streak = next.lastPlayed === localDay(yesterday) ? Math.min(MAX_COUNT, next.streak + 1) : 1;
  } else if (next.streak === 0) {
    next.streak = 1;
  }
  next.lastPlayed = today;
  if (validResultId(result.id)) next.lastResultId = result.id;
  return next;
}
