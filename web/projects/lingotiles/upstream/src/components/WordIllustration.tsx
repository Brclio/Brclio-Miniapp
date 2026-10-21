import { useState } from 'react';
import { getWordIllustration } from '../game/wordIllustrations';
import './word-illustration.css';

type Props = {
  word: { word: string; pos: string; meaning: string };
  className?: string;
  loading?: 'eager' | 'lazy';
};

/** Only reviewed, meaning-specific assets are eligible for a word card. */
export default function WordIllustration({ word, className = '', loading = 'eager' }: Props) {
  const illustration = getWordIllustration(word);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  if (!illustration) return null;
  const failed = failedSource === illustration.src;

  return <div className={`word-illustration ${className}`} data-image-state={failed ? 'error' : loadedSource === illustration.src ? 'ready' : 'loading'}>
    <img
      key={illustration.src}
      src={illustration.src}
      alt={illustration.alt}
      width={512}
      height={512}
      decoding="async"
      loading={loading}
      draggable={false}
      hidden={failed}
      onLoad={() => setLoadedSource(illustration.src)}
      onError={() => setFailedSource(illustration.src)}
    />
    {failed && <span className="word-illustration-unavailable">配图暂不可用</span>}
  </div>;
}
