import { useState, type RefObject } from 'react';
import { ChevronDown, Sprout } from 'lucide-react';
import type { Word } from '../data/vocabulary';
import { exportMissingIllustrations, getWordIllustration } from '../game/wordIllustrations';
import WordIllustration from './WordIllustration';
import './word-harvest.css';

type Props = { words: Word[]; total: number; targetRef: RefObject<HTMLDivElement | null> };

function HarvestWord({ word }: { word: Word }) {
  return <><WordIllustration word={word} className="harvest-image" /><div className="harvest-word-copy"><strong className="harvest-word" lang="en">{word.word}</strong><div className="harvest-meaning"><span className="pos-chip">{word.pos}</span><span>{word.meaning}</span></div></div></>;
}

export default function WordHarvest({ words, total, targetRef }: Props) {
  const [expanded, setExpanded] = useState(false);
  const latest = words.at(-1);
  const illustratedCount = words.filter(word => getWordIllustration(word)).length;
  const missingCount = words.length - illustratedCount;
  return <section className="word-harvest" aria-label="本关收获区" data-harvest-count={words.length}>
    <div className="harvest-heading"><span><Sprout size={15} />本关收获 <strong>{words.length} / {total}</strong></span><button disabled={!words.length} aria-expanded={expanded} aria-controls="harvest-collection" onClick={() => setExpanded(value => !value)}>{expanded ? '收起' : '查看词卡'}<ChevronDown size={14} style={{ transform: expanded ? 'rotate(180deg)' : undefined }} /></button></div>
    <div className="harvest-collection" id="harvest-collection" hidden={!expanded}>
      <div className="harvest-illustration-status"><p>已收获词卡：{illustratedCount} 个已配图{missingCount > 0 && `，${missingCount} 个待配图`}</p>{missingCount > 0 && <button onClick={() => exportMissingIllustrations()}>导出待配图词单</button>}</div>
      {words.map(word => <article className="harvest-collected-word" key={word.id}><HarvestWord word={word} /></article>)}
    </div>
    <div className={`harvest-destination ${latest ? 'has-word' : ''}`} ref={targetRef}>
      {latest ? <HarvestWord word={latest} /> : <p>下一组配对，会成为一张完整词卡。</p>}
    </div>
  </section>;
}
