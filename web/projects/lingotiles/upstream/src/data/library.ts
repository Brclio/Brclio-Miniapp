import { LEVELS, type Level, type Word } from './vocabulary.ts';

export const STAGE_PROFILES = [
  { id: 'primary', title: '小学基础', short: '小学', wordCount: 6, memorySeconds: 90, description: '从日常事物和高频基础词开始，一次记住 6 个词。' },
  { id: 'junior', title: '初中进阶', short: '初中', wordCount: 8, memorySeconds: 80, description: '扩展常用表达，以中考标签词汇为主要参考。' },
  { id: 'senior', title: '高中提升', short: '高中', wordCount: 10, memorySeconds: 75, description: '进入更丰富的阅读词汇，以高考标签为主要参考。' },
  { id: 'cet4', title: '大学四级', short: '四级', wordCount: 12, memorySeconds: 70, description: '增加抽象表达和学术常用词，以四级标签为主要参考。' },
  { id: 'cet6', title: '大学六级', short: '六级', wordCount: 14, memorySeconds: 65, description: '挑战更细致的含义、更复杂的词形和更多卡牌。' },
  { id: 'advanced', title: '大学拓展', short: '拓展', wordCount: 16, memorySeconds: 60, description: '探索低频词和专业词。按词频排序，适合有基础后拓展。' },
] as const;
export type StageId = typeof STAGE_PROFILES[number]['id'];
export type StageProfile = typeof STAGE_PROFILES[number];
export type VocabularyChunk = { path: string; count: number; start: number };
export type VocabularyStage = { id: StageId; title: string; count: number; chunks: VocabularyChunk[] };
export type VocabularyManifest = {
  version: number; total: number; curatedWordCount: number;
  stages: VocabularyStage[];
  lookupFiles: Record<string, string>;
  source: { name: string; url: string; revision: string; csvSha256: string; license: string };
};
export type CourseLevel = Level & { stageId: StageId; stageTitle: string; round: number; roundCount: number };
const curated = new Map(LEVELS.flatMap(level => level.words).map(word => [word.word.toLowerCase(), word]));
const resourceCache = new Map<string, Promise<unknown>>();
let manifestPromise: Promise<VocabularyManifest> | undefined;
let lastSearch: { key: string; words: Word[] } | undefined;

function resourceUrl(path: string) {
  return `${import.meta.env?.BASE_URL ?? '/'}${path.replace(/^\//, '')}`;
}
async function loadJson<T>(path: string): Promise<T> {
  let cached = resourceCache.get(path);
  if (!cached) {
    cached = fetch(resourceUrl(path)).then(response => {
      if (!response.ok) throw new Error(`词库文件暂时无法读取（${response.status}），请重试。`);
      return response.json();
    }).catch(error => { resourceCache.delete(path); throw error; });
    resourceCache.set(path, cached);
    // Bound retained full dictionary chunks; the browser may keep HTTP responses cached.
    if (resourceCache.size > 36) resourceCache.delete(resourceCache.keys().next().value!);
  }
  return cached as Promise<T>;
}
export function loadManifest(): Promise<VocabularyManifest> {
  if (!manifestPromise) manifestPromise = loadJson<VocabularyManifest>('/vocabulary/manifest.json').then(manifest => {
    if (manifest.total !== 100000 || manifest.stages.length !== 6 || manifest.stages.reduce((sum, stage) => sum + stage.count, 0) !== manifest.total) throw new Error('词库清单不完整，请刷新后重试。');
    return manifest;
  }).catch(error => { manifestPromise = undefined; resourceCache.delete('/vocabulary/manifest.json'); throw error; });
  return manifestPromise;
}
function overlayWord(word: Word): Word {
  const original = curated.get(word.word.toLowerCase());
  return original ? { ...word, ...original } : word;
}
async function loadChunk(path: string): Promise<Word[]> {
  const rows = await loadJson<Word[]>(path);
  if (!Array.isArray(rows)) { resourceCache.delete(path); throw new Error('词库分片格式异常，请重试。'); }
  return rows;
}
export function stageProfile(id: string): StageProfile {
  return STAGE_PROFILES.find(stage => stage.id === id) ?? STAGE_PROFILES[0];
}
export function courseLevelId(stageId: StageId, round: number): number {
  const index = STAGE_PROFILES.findIndex(stage => stage.id === stageId);
  if (index < 0 || !Number.isInteger(round) || round < 1 || round >= 10000) throw new Error('无效的分级关卡');
  return 100000 + index * 10000 + round;
}
export function totalRounds(stage: VocabularyStage): number {
  return Math.ceil(stage.count / stageProfile(stage.id).wordCount);
}
export async function readVocabularyPage({ stageId, page = 0, pageSize = 36 }: { stageId?: StageId; page?: number; pageSize?: number } = {}): Promise<{ words: Word[]; total: number }> {
  const manifest = await loadManifest();
  const stages = manifest.stages.filter(stage => !stageId || stage.id === stageId);
  const total = stages.reduce((sum, stage) => sum + stage.count, 0);
  let start = Math.max(0, page) * pageSize;
  let remaining = pageSize;
  const words: Word[] = [];
  for (const stage of stages) {
    for (const chunk of stage.chunks) {
      if (start >= chunk.count) { start -= chunk.count; continue; }
      const rows = await loadChunk(chunk.path);
      const chosen = rows.slice(start, start + remaining);
      words.push(...chosen.map(overlayWord));
      remaining -= chosen.length;
      start = 0;
      if (remaining === 0) return { words, total };
    }
  }
  return { words, total };
}
export async function loadCourseLevel(stageId: StageId, round: number): Promise<CourseLevel> {
  const manifest = await loadManifest();
  const stage = manifest.stages.find(item => item.id === stageId);
  if (!stage) throw new Error('没有找到这个学习阶段。');
  const profile = stageProfile(stageId);
  if (!Number.isInteger(round) || round < 1 || round > totalRounds(stage)) throw new Error('关卡编号超出本阶段范围。');
  const { words } = await readVocabularyPage({ stageId, page: round - 1, pageSize: profile.wordCount });
  return { id: courseLevelId(stageId, round), title: `${profile.title} · 第 ${round} 关`, subtitle: 'Step by step, word by word.', description: profile.description, icon: 'GraduationCap', words, memorySeconds: profile.memorySeconds, stageId, stageTitle: profile.title, round, roundCount: totalRounds(stage) };
}
export async function wordsByIds(ids: readonly string[]): Promise<Word[]> {
  if (!ids.length) return [];
  const manifest = await loadManifest();
  const resolved = new Map<string, Word>();
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const key = id.replace(/^dict:/, '').toLowerCase();
    const known = curated.get(key);
    if (known) { resolved.set(id, known); continue; }
    const letter = /^[a-z]/.test(key) ? key[0] : 'other';
    groups.set(letter, [...(groups.get(letter) ?? []), id]);
  }
  await Promise.all([...groups].map(async ([letter, group]) => {
    const indexPath = manifest.lookupFiles[letter];
    if (!indexPath) return;
    const index = await loadJson<Record<string, [number, number, number]>>(indexPath);
    await Promise.all(group.map(async id => {
      const position = index[id.replace(/^dict:/, '').toLowerCase()];
      if (!position) return;
      const chunk = manifest.stages[position[0]]?.chunks[position[1]];
      if (!chunk) return;
      const word = (await loadChunk(chunk.path))[position[2]];
      if (word) resolved.set(id, overlayWord(word));
    }));
  }));
  return ids.map(id => resolved.get(id)).filter((word): word is Word => !!word);
}
export async function searchVocabulary(query: string, options: { page?: number; pageSize?: number; stageId?: StageId; allowedIds?: readonly string[]; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}): Promise<{ words: Word[]; total: number }> {
  const { page = 0, pageSize = 36, stageId, allowedIds, signal, onProgress } = options;
  const normalized = query.trim().toLowerCase();
  const key = JSON.stringify([normalized, stageId, allowedIds]);
  if (!lastSearch || lastSearch.key !== key) {
    const manifest = await loadManifest();
    const stages = manifest.stages.filter(stage => !stageId || stage.id === stageId);
    const count = stages.reduce((sum, stage) => sum + stage.count, 0);
    const allowed = allowedIds ? new Set(allowedIds) : null;
    const matches: Word[] = [];
    let done = 0;
    for (const stage of stages) for (const chunk of stage.chunks) {
      signal?.throwIfAborted();
      const rows = await loadChunk(chunk.path);
      for (const row of rows) {
        const word = overlayWord(row);
        if (allowed && !allowed.has(word.id)) continue;
        if (`${word.word} ${word.meaning} ${word.definition ?? ''}`.toLowerCase().includes(normalized)) matches.push(word);
      }
      done += rows.length;
      onProgress?.(done, count);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    signal?.throwIfAborted();
    const relevance = (word: Word) => word.word.toLowerCase() === normalized ? 0 : word.word.toLowerCase().startsWith(normalized) ? 1 : 2;
    matches.sort((a, b) => relevance(a) - relevance(b));
    lastSearch = { key, words: matches };
  }
  signal?.throwIfAborted();
  return { words: lastSearch.words.slice(page * pageSize, (page + 1) * pageSize), total: lastSearch.words.length };
}
