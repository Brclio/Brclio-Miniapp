import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Download, History, Timer, Trophy } from 'lucide-react';
import { exportCompletionsCsv, getCompletionPage, getCompletionSummary, type CompletionPage, type CompletionSummary } from '../game/history';
import './history.css';

type Props = { refreshKey: number; legacySessions: number; onBack: () => void };
const PAGE_SIZE = 12;

function duration(seconds: number): string {
  const whole = Math.floor(seconds);
  if (whole >= 3600) return `${Math.floor(whole / 3600)}:${String(Math.floor(whole / 60) % 60).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function dateTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export default function HistoryPanel({ refreshKey, legacySessions, onBack }: Props) {
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<CompletionPage | null>(null);
  const [summary, setSummary] = useState<CompletionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getCompletionPage({ page, pageSize: PAGE_SIZE }), getCompletionSummary()])
      .then(([nextResults, nextSummary]) => {
        if (cancelled) return;
        setResults(nextResults);
        setSummary(nextSummary);
        setNotice(nextResults.error ?? nextSummary.error ?? '');
      })
      .catch(() => { if (!cancelled) setNotice('暂时无法读取通关记录，请稍后重新打开本页。'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, refreshKey]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const result = await exportCompletionsCsv();
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `LingoTiles-通关记录-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(result.error ?? '已生成完整 CSV，包含每一次通关的记忆、消除和总用时。');
    } catch { setNotice('导出失败，请重试。'); }
    finally { setExporting(false); }
  };

  const pages = Math.max(1, Math.ceil((results?.total ?? 0) / PAGE_SIZE));
  const oldSessions = Math.max(0, legacySessions - (summary?.total ?? 0));

  return <section className="history-panel" aria-labelledby="history-title" aria-busy={loading}>
    <div className="page-heading history-heading">
      <div><p className="history-eyebrow">MY LEARNING JOURNEY</p><h1 id="history-title">每一次通关，都有迹可循。</h1><p>记下认真记忆的时间，也记下越玩越快的自己。</p></div>
      <button className="history-button" onClick={onBack}><ArrowLeft size={16} />返回闯关</button>
    </div>

    <div className="history-summary" aria-label="通关概览">
      <div><span><Trophy size={17} />完整通关记录</span><strong>{summary?.total ?? '—'}<small> 次</small></strong><p>同一关重玩也会单独记录</p></div>
      <div><span><History size={17} />最近消除用时</span><strong>{summary?.latest ? duration(summary.latest.gameSeconds) : '—'}</strong><p>{summary?.latest?.levelTitle ?? '完成第一关后开始记录'}</p></div>
      <div><span><Timer size={17} />最快消除用时</span><strong>{summary?.fastest ? duration(summary.fastest.gameSeconds) : '—'}</strong><p>{summary?.fastest?.levelTitle ?? '你的新纪录，等你创造'}</p></div>
    </div>

    <div className="history-list-heading"><div><h2>通关足迹</h2><p>按完成时间倒序 · 用时不包含暂停 · 最快用时包含使用道具的记录</p></div><button className="history-button" disabled={exporting || !summary?.total} onClick={exportCsv}><Download size={16} />{exporting ? '正在导出…' : '导出全部 CSV'}</button></div>
    {notice && <p className={`history-notice ${results?.persisted === false ? 'storage-warning' : ''}`} role="status">{notice}</p>}
    {summary && oldSessions > 0 && <p className="history-legacy">另有 {oldSessions} 次通关仅保留成绩汇总，无法还原逐局用时。已有最佳成绩继续保留。</p>}
    {loading && !results ? <p className="history-loading" role="status">正在读取通关足迹…</p> : results?.records.length ? <div className="history-table-wrap">
      <table className="history-table">
        <caption className="sr-only">每一次通关的时间与成绩</caption>
        <thead><tr><th scope="col">关卡 / 完成时间</th><th scope="col">消除用时</th><th scope="col">记忆 / 总用时</th><th scope="col">成绩</th></tr></thead>
        <tbody>{results.records.map(record => <tr key={record.id}>
          <td><span className="history-mode">{record.mode === 'theme' ? '经典主题' : record.stageTitle ?? '分级课程'}{record.mode === 'curriculum' && record.round ? ` · 第 ${record.round} 关` : ''}</span><strong className="history-level-name">{record.levelTitle}</strong><time dateTime={record.completedAt}>{dateTime(record.completedAt)}</time></td>
          <td className="history-game-time"><strong>{duration(record.gameSeconds)}</strong><small>{record.wordCount} 个单词</small></td>
          <td><span>记忆 {duration(record.studySeconds)}</span><small>合计 {duration(record.totalSeconds)}</small></td>
          <td><span className="history-stars" aria-label={`${record.stars} 颗星`}>{'★'.repeat(record.stars)}<span aria-hidden="true">{'☆'.repeat(3 - record.stars)}</span></span><strong className="history-score">{record.score} 分</strong><small>使用道具 {record.assists} 次</small></td>
        </tr>)}</tbody>
      </table>
    </div> : <div className="empty-state history-empty"><History size={36} strokeWidth={1.3} /><h2>第一条足迹，从下一关开始</h2><p>成功通关后，记忆用时、消除用时和成绩会出现在这里。</p><button className="history-button" onClick={onBack}>开始一次挑战<ChevronRight size={16} /></button></div>}
    {!!results?.total && <div className="history-pagination" aria-label="通关记录分页"><p>共 {results.total} 条 · 第 {page} / {pages} 页</p><div><button className="history-button" disabled={page <= 1 || loading} onClick={() => setPage(current => current - 1)}><ChevronLeft size={16} />上一页</button><button className="history-button" disabled={page >= pages || loading} onClick={() => setPage(current => current + 1)}>下一页<ChevronRight size={16} /></button></div></div>}
    <p className="history-footnote">{results?.persisted === false || summary?.persisted === false ? '部分记录目前仅临时保存在本页，刷新或关闭页面后可能丢失，请先导出 CSV 备份。' : results ? '记录保存在当前浏览器。清除网站数据会移除记录，可通过 CSV 留存完整足迹。' : '正在读取本地记录，可通过 CSV 备份已保存的通关足迹。'}不同关卡的单词数量和难度不同，用时仅作学习参考。</p>
  </section>;
}
