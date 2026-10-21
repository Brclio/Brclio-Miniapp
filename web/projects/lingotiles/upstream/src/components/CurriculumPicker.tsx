import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, GraduationCap, LoaderCircle, RefreshCw } from 'lucide-react';
import { STAGE_PROFILES, totalRounds, courseLevelId, stageProfile, type StageId, type VocabularyManifest } from '../data/library';
import type { Progress } from '../game/progress';

type Props = { manifest: VocabularyManifest | null; stageId: StageId; round: number; loading: boolean; error: string; progress: Progress; onSelect: (stageId: StageId, round: number) => void; onRetry: () => void };
export default function CurriculumPicker({ manifest, stageId, round, loading, error, progress, onSelect, onRetry }: Props) {
  const stage = manifest?.stages.find(item => item.id === stageId);
  const profile = stageProfile(stageId);
  const [jump, setJump] = useState(String(round));
  useEffect(() => setJump(String(round)), [round, stageId]);
  const nextRound = (id: StageId) => {
    const chosen = manifest?.stages.find(item => item.id === id);
    if (!chosen) return 1;
    for (let index = 1; index <= totalRounds(chosen); index++) if (!progress.completed[courseLevelId(id, index)]) return index;
    return 1;
  };
  return <section className="curriculum-picker" aria-labelledby="curriculum-title">
    <div className="section-heading"><h2 id="curriculum-title"><GraduationCap size={20} />从基础出发，一步步进阶</h2><span className="library-total">{manifest ? manifest.total.toLocaleString() : '100,000'} 个内置词条</span></div>
    <div className="stage-track" aria-label="选择学习阶段">{STAGE_PROFILES.map((item, index) => {
      const data = manifest?.stages.find(stage => stage.id === item.id);
      return <button key={item.id} className={`stage-choice ${stageId === item.id ? 'active' : ''}`} aria-pressed={stageId === item.id} disabled={!manifest || loading} onClick={() => onSelect(item.id, nextRound(item.id))}><span className="stage-index">{index + 1}</span><strong>{item.title}</strong><small>{data ? `${data.count.toLocaleString()} 词` : '准备词库'}</small><span className="stage-density">每关 {item.wordCount} 词</span></button>;
    })}</div>
    <div className="course-detail"><div><h3>{profile.title}<span>每关最多 {profile.wordCount * 3} 张牌 · 标准记忆 {profile.memorySeconds} 秒</span></h3><p>{profile.description}</p></div><div className="round-navigation"><button className="icon-button" aria-label="上一分级关卡" disabled={loading || round <= 1} onClick={() => onSelect(stageId, round - 1)}><ArrowLeft size={16} /></button><form onSubmit={event => { event.preventDefault(); const number = Number(jump); if (stage && Number.isInteger(number) && number >= 1 && number <= totalRounds(stage)) onSelect(stageId, number); }}><label>第 <input type="number" aria-label="分级关卡编号" min={1} max={stage ? totalRounds(stage) : 1} value={jump} onChange={event => setJump(event.target.value)} disabled={loading} /> 关 / {stage ? totalRounds(stage) : '—'}</label><button type="submit" className="text-button" disabled={loading || !stage}>前往</button></form><button className="icon-button" aria-label="下一分级关卡" disabled={loading || !stage || round >= totalRounds(stage)} onClick={() => onSelect(stageId, round + 1)}><ArrowRight size={16} /></button></div></div>
    <p className="grading-note"><BookOpen size={14} />小学为精选基础词，初高中及大学参考考试标签与词频自动分级，并非官方教材或考试大纲。各阶段展示去重后的新增词汇；大学拓展包含专业词与低频词。</p>
    {loading && <p className="library-loading" role="status"><LoaderCircle size={16} />正在准备本关词汇…</p>}
    {error && <div className="library-error" role="alert"><span>{error}</span><button className="text-button" onClick={onRetry}><RefreshCw size={14} />重新加载</button></div>}
  </section>;
}
