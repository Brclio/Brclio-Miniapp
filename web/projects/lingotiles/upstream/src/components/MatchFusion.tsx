import { useLayoutEffect, useRef, type RefObject } from 'react';
import { getWordIllustration } from '../game/wordIllustrations';
import WordIllustration from './WordIllustration';
import './match-fusion.css';

export type FusionRect = { left: number; top: number; width: number; height: number };
export type FusionEvent = {
  id: string;
  word: { id: string; word: string; pos: string; meaning: string; phonetic?: string };
  sources: Array<{ kind: 'word' | 'pos' | 'meaning'; text: string; rect: FusionRect }>;
};

type MatchFusionProps = {
  event: FusionEvent;
  targetRef: RefObject<HTMLElement | null>;
  paused: boolean;
  onComplete: (id: string) => void;
};

const DURATION = 2180;
const REDUCED_DURATION = 1520;
// Illustrated cards retain the original gathering speed, then hold for 1.6 seconds.
const ILLUSTRATED_DURATION = 2700;
const ILLUSTRATED_REDUCED_DURATION = 2000;
const EASE_OUT = 'cubic-bezier(.25, 1, .5, 1)';
const EASE_IN_OUT = 'cubic-bezier(.76, 0, .24, 1)';
const LABELS = { word: '英文', pos: '词性', meaning: '中文' };
const bounded = (value: number, min: number, max: number) => Math.min(Math.max(min, max), Math.max(min, value));

/** The event ID names one match; changing pause state never restarts its timeline. */
export default function MatchFusion({ event, targetRef, paused, onComplete }: MatchFusionProps) {
  const illustrated = !!getWordIllustration(event.word);
  const overlayRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const sourceRefs = useRef<Array<HTMLDivElement | null>>([]);
  const callbackRef = useRef(onComplete);
  const pausedRef = useRef(paused);
  const controllerRef = useRef<{ sync: () => void } | null>(null);
  const completedId = useRef<string | null>(null);

  useLayoutEffect(() => {
    callbackRef.current = onComplete;
    pausedRef.current = paused;
    controllerRef.current?.sync();
  }, [onComplete, paused]);

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const card = cardRef.current;
    if (!overlay || !card || completedId.current === event.id) return;

    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let active = true;
    let animations: Animation[] = [];
    let clock: Animation | null = null;
    let reduced = preference.matches;
    let finishPending = false;

    const complete = () => {
      if (!active || completedId.current === event.id) return;
      completedId.current = event.id;
      callbackRef.current(event.id);
    };

    const cancelAnimations = () => {
      if (clock) clock.onfinish = null;
      animations.forEach(animation => animation.cancel());
      animations = [];
      clock = null;
      finishPending = false;
    };
    const sync = () => {
      if (!active) return;
      const shouldPause = pausedRef.current || document.hidden;
      // A finish event already queued before a pause must wait for resume too.
      if (finishPending && !shouldPause) { complete(); return; }
      for (const animation of animations) {
        if (animation.playState === 'finished') continue;
        if (shouldPause) animation.pause();
        else animation.play();
      }
    };
    const add = (element: HTMLElement, frames: Keyframe[], duration: number) => {
      const animation = element.animate(frames, { duration, fill: 'both', easing: 'linear' });
      animation.pause();
      animation.currentTime = 0;
      animations.push(animation);
      return animation;
    };

    const buildTimeline = (resumeTime = 0) => {
      cancelAnimations();
      overlay.dataset.motion = reduced ? 'reduced' : 'full';
      const width = window.innerWidth;
      const height = window.innerHeight;
      // Keep the complete relationship above the fixed harvest area on short screens.
      const cardBounds = card.getBoundingClientRect();
      const centerX = width / 2;
      const harvestBounds = targetRef.current?.closest('.word-harvest')?.getBoundingClientRect();
      const readableBottom = harvestBounds ? harvestBounds.top - 12 : height - 90;
      const centerY = bounded(height * .43, cardBounds.height / 2 + 14, readableBottom - cardBounds.height / 2);
      card.style.left = `${centerX}px`;
      card.style.top = `${centerY}px`;
      const centered = 'translate(-50%, -50%)';
      const duration = reduced
        ? (illustrated ? ILLUSTRATED_REDUCED_DURATION : REDUCED_DURATION)
        : (illustrated ? ILLUSTRATED_DURATION : DURATION);

      if (reduced) {
        sourceRefs.current.forEach(source => { if (source) source.style.visibility = 'hidden'; });
        add(card, [
          { opacity: 0, transform: centered, offset: 0 },
          { opacity: 1, transform: centered, offset: .08 },
          { opacity: 1, transform: centered, offset: .88 },
          { opacity: 0, transform: centered, offset: 1 },
        ], duration);
      } else {
        event.sources.forEach((source, index) => {
          const element = sourceRefs.current[index];
          if (!element) return;
          const tileWidth = bounded(source.rect.width, 42, width - 24);
          const tileHeight = bounded(source.rect.height, 38, 145);
          const left = bounded(source.rect.left, 8, width - tileWidth - 8);
          const top = bounded(source.rect.top, 8, height - tileHeight - 8);
          Object.assign(element.style, {
            left: `${left}px`, top: `${top}px`, width: `${tileWidth}px`, height: `${tileHeight}px`, visibility: 'visible',
          });
          // Three distinct positions make the relationship legible before the cards merge.
          const destinationX = centerX + (index - 1) * Math.min(77, width * .22);
          const destinationY = centerY + (index === 1 ? -20 : 12);
          const gather = `translate(${destinationX - left - tileWidth / 2}px, ${destinationY - top - tileHeight / 2}px) scale(.9)`;
          const merged = `translate(${centerX - left - tileWidth / 2}px, ${centerY - top - tileHeight / 2}px) scale(.62)`;
          add(element, [
            { opacity: 1, transform: 'translate(0px, 0px) scale(1)', offset: 0, easing: EASE_OUT },
            { opacity: 1, transform: gather, offset: illustrated ? 350 / duration : .16, easing: EASE_IN_OUT },
            { opacity: 0, transform: merged, offset: illustrated ? 530 / duration : .245 },
            { opacity: 0, transform: merged, offset: 1 },
          ], duration);
        });

        const destination = targetRef.current?.getBoundingClientRect();
        const targetX = destination ? destination.left + destination.width / 2 : centerX;
        const targetY = destination ? destination.top + destination.height / 2 : height - 45;
        const scale = destination ? bounded(destination.width / cardBounds.width, .16, .4) : .2;
        const arrival = `translate(calc(-50% + ${targetX - centerX}px), calc(-50% + ${targetY - centerY}px)) scale(${scale})`;
        add(card, [
          { opacity: 0, transform: `${centered} scale(.93)`, offset: 0 },
          { opacity: 0, transform: `${centered} scale(.93)`, offset: illustrated ? 330 / duration : .15, easing: EASE_OUT },
          { opacity: 1, transform: `${centered} scale(1)`, offset: illustrated ? 550 / duration : .25 },
          { opacity: 1, transform: `${centered} scale(1)`, offset: illustrated ? 2150 / duration : .77, easing: EASE_IN_OUT },
          { opacity: .9, transform: arrival, offset: .98 },
          { opacity: 0, transform: arrival, offset: 1 },
        ], duration);
      }

      // One animation owns completion. All visual animations share its paused time.
      clock = add(overlay, [{ opacity: 1 }, { opacity: 1 }], duration);
      const currentClock = clock;
      clock.onfinish = () => {
        if (!active || clock !== currentClock || completedId.current === event.id) return;
        finishPending = true;
        if (!pausedRef.current && !document.hidden) complete();
      };
      animations.forEach(animation => { animation.currentTime = Math.min(resumeTime, duration); });
      sync();
    };

    const handlePreference = () => {
      // Turning motion off takes effect immediately without flying the cards again.
      if (preference.matches && !reduced) { reduced = true; buildTimeline(); }
    };
    const handleResize = () => {
      if (active && clock && !finishPending) buildTimeline(Number(clock.currentTime ?? 0));
    };
    controllerRef.current = { sync };
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('resize', handleResize);
    preference.addEventListener('change', handlePreference);
    buildTimeline();
    return () => {
      active = false;
      controllerRef.current = null;
      cancelAnimations();
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('resize', handleResize);
      preference.removeEventListener('change', handlePreference);
    };
    // An immutable event ID owns this animation; pause/callback changes use refs above.
  }, [event.id, targetRef]);

  return <div className="match-fusion" ref={overlayRef} aria-hidden="true" data-fusion-id={event.id}>
    {event.sources.map((source, index) => <div
      key={`${event.id}-${source.kind}-${index}`}
      ref={element => { sourceRefs.current[index] = element; }}
      className={`fusion-source fusion-source-${source.kind}`}
    >
      <strong>{source.text}</strong><small>{LABELS[source.kind]}</small>
    </div>)}
    <div className={`fusion-word-card${illustrated ? ' is-illustrated' : ''}`} ref={cardRef}>
      <div className="fusion-card-eyebrow"><span>✓</span> 配对成功 <i>词卡 +1</i></div>
      <div className="fusion-card-content">
        <WordIllustration word={event.word} className="fusion-card-image" />
        <div className="fusion-card-copy">
          <strong className="fusion-card-word" lang="en">{event.word.word}</strong>
          {event.word.phonetic && <span className="fusion-card-phonetic">/{event.word.phonetic.replace(/^\/+|\/+$/g, '')}/</span>}
          <div className="fusion-card-definition"><span>{event.word.pos}</span><strong>{event.word.meaning}</strong></div>
        </div>
      </div>
    </div>
  </div>;
}
