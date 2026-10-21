import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Bookmark, CheckCheck, LoaderCircle, Search, Volume2 } from 'lucide-react';
import { loadManifest, readVocabularyPage, searchVocabulary, STAGE_PROFILES, wordsByIds, type StageId, type VocabularyManifest } from '../data/library';
import type { Word } from '../data/vocabulary';
import type { Progress } from '../game/progress';
import { getWordIllustration, loadWordIllustrations } from '../game/wordIllustrations';
import WordIllustration from './WordIllustration';

const PAGE_SIZE = 36;
export default function VocabularyNotebook({ progress, onSave, speak }: { progress: Progress; onSave: (id: string) => void; speak: (text: string) => void }) {
  const [filter, setFilter] = useState<'all' | 'seen' | 'saved'>('all');
  const [query, setQuery] = useState('');
  const [stageId, setStageId] = useState<StageId | ''>('');
  const [page, setPage] = useState(0);
  const [words, setWords] = useState<Word[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [scan, setScan] = useState(0);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [manifest, setManifest] = useState<VocabularyManifest | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setScan(0);
    const timer = setTimeout(async () => {
      try {
        const info = await loadManifest();
        if (controller.signal.aborted) return;
        setManifest(info);
        let result: { words: Word[]; total: number };
        if (query.trim() || (filter !== 'all' && stageId)) {
          result = await searchVocabulary(query, { page, pageSize: PAGE_SIZE, stageId: stageId || undefined, allowedIds: filter === 'all' ? undefined : progress[filter], signal: controller.signal, onProgress: (done, count) => { if (!controller.signal.aborted) setScan(Math.round(done / count * 100)); } });
        } else if (filter !== 'all') {
          const ids = progress[filter];
          result = { words: await wordsByIds(ids.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)), total: ids.length };
        } else result = await readVocabularyPage({ page, pageSize: PAGE_SIZE, stageId: stageId || undefined });
        if (!controller.signal.aborted) {
          const lastPage = Math.max(0, Math.ceil(result.total / PAGE_SIZE) - 1);
          setTotal(result.total);
          if (page > lastPage) { setPage(lastPage); return; }
          setWords(result.words); setLoading(false);
          // Show the vocabulary immediately, then render this page's newly loaded pictures.
          await loadWordIllustrations(result.words);
          if (!controller.signal.aborted) setWords([...result.words]);
        }
      } catch (failure) {
        if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : '词库暂时无法读取，请重试。'); setLoading(false); }
      }
    }, query.trim() ? 300 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, filter, stageId, page, progress.saved, progress.seen, retry]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return <section aria-labelledby="notebook-title">
    <div className="page-heading notebook-heading"><div><h1 id="notebook-title">十万个词，一点点成为你的。</h1><p>分级浏览、搜索中英文，把还想再记一次的词收进收藏。</p></div><BookOpen size={30} strokeWidth={1.3} color="var(--green)" /></div>
    <div className="notebook-toolbar"><div className="filter-tabs" aria-label="词汇筛选">{([['all', `全部 ${manifest?.total.toLocaleString() ?? '100,000'}`], ['seen', `已复习 ${progress.seen.length.toLocaleString()}`], ['saved', `收藏 ${progress.saved.length.toLocaleString()}`]] as const).map(([key, label]) => <button key={key} className={filter === key ? 'active' : ''} aria-pressed={filter === key} onClick={() => { setFilter(key); setPage(0); }}>{label}</button>)}</div><div className="dictionary-controls"><label className="sr-only" htmlFor="dictionary-stage">按学习阶段筛选</label><select id="dictionary-stage" value={stageId} onChange={event => { setStageId(event.target.value as StageId | ''); setPage(0); }}><option value="">所有阶段</option>{STAGE_PROFILES.map(stage => <option value={stage.id} key={stage.id}>{stage.title}</option>)}</select><label className="search-box"><Search size={16} /><span className="sr-only">搜索英文或中文</span><input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="搜索英文或中文含义" /></label></div></div>
    <div className="dictionary-status" role="status">{loading ? <><LoaderCircle size={15} />{query.trim() || (filter !== 'all' && stageId) ? `正在检索词库 ${scan}%` : '正在读取词条…'}</> : error ? '词库未能加载' : `共 ${total.toLocaleString()} 个词条，每页 ${PAGE_SIZE} 个`}</div>
    {error ? <div className="library-error" role="alert"><p>{error}</p><button className="secondary-button" onClick={() => setRetry(value => value + 1)}>重试</button></div> : <div className={`notebook-list ${loading ? 'is-loading' : ''}`} aria-busy={loading}>{words.map(word => <article className={`notebook-row${getWordIllustration(word) ? ' has-illustration' : ''}`} key={word.id}>
      <div className="notebook-identity"><div className="notebook-word"><strong lang="en">{word.word}</strong><button className="pronounce" aria-label={`朗读 ${word.word}`} onClick={() => speak(word.word)}><Volume2 size={15} /></button>{progress.seen.includes(word.id) && <CheckCheck size={13} color="var(--green)" aria-label="已复习" />}</div><p className="notebook-phonetic" lang="en">{word.phonetic || '音标未收录'}</p><span className="word-stage">{STAGE_PROFILES.find(stage => stage.id === word.stageId)?.title ?? '主题词汇'}</span></div>
      <WordIllustration word={word} className="notebook-image" loading="lazy" />
      <div className="notebook-meaning"><span className="pos-chip">{word.pos}</span>{word.meaning}</div>
      <div className="word-context">{word.example ? <p className="example"><span lang="en" className="english-example">{word.example}</span><span>{word.exampleZh}</span></p> : <p className="definition-summary">{word.definition || `${word.pos} ${word.meaning}`}</p>}{word.definition && <details className="dictionary-definition"><summary>完整词典释义</summary><p>{word.definition}</p></details>}</div>
      <button className={`save-button ${progress.saved.includes(word.id) ? 'saved' : ''}`} aria-label={`${progress.saved.includes(word.id) ? '取消收藏' : '收藏'} ${word.word}`} aria-pressed={progress.saved.includes(word.id)} onClick={() => onSave(word.id)}><Bookmark size={19} fill={progress.saved.includes(word.id) ? 'currentColor' : 'none'} /></button>
    </article>)}</div>}
    {!loading && !error && total === 0 && <div className="empty-state"><Bookmark size={33} strokeWidth={1.3} /><h2>{query ? '还没找到这个词' : filter === 'saved' ? '把容易忘的词，留在这里' : '你的单词旅程，正要开始'}</h2><p>{query ? '试试英文拼写或更短的中文关键词。' : filter === 'saved' ? '点击词条旁的书签，就能加入收藏。' : '完成记忆阶段后，单词会自动出现在这里。'}</p></div>}
    <div className="dictionary-pagination"><button className="secondary-button" disabled={page === 0 || loading} onClick={() => setPage(value => value - 1)}><ArrowLeft size={15} />上一页</button><span>第 {page + 1} / {pageCount.toLocaleString()} 页</span><button className="secondary-button" disabled={page + 1 >= pageCount || loading} onClick={() => setPage(value => value + 1)}>下一页<ArrowRight size={15} /></button></div>
    <p className="dictionary-attribution">词库来源：<a href="https://github.com/skywind3000/ECDICT" target="_blank" rel="noreferrer">ECDICT · MIT</a>，经去重与词性义项整理。分级仅作学习参考；保留原六主题的人工例句。拓展词包含专业与低频词，词典释义可能有多义或历史用法。</p>
  </section>;
}
