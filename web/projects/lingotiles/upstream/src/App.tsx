import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowRight, BookOpen, Building2, Check, ChevronRight, CircleHelp, Coffee, Compass, Flame, GraduationCap, Heart, History, Layers3, Leaf, Lightbulb, LockKeyhole, Pause, Play, RotateCcw, ShieldCheck, Shuffle, Sparkles, Sprout, Star, Timer, Trophy, Undo2, Volume2, VolumeX, X } from 'lucide-react';
import { LEVELS, type Word } from './data/vocabulary';
import { createGame, getHint, isTileAvailable, selectTile, shuffleBoard, undoMove, type GameState, type Tile } from './game/engine';
import CurriculumPicker from './components/CurriculumPicker';
import VocabularyNotebook from './components/VocabularyNotebook';
import HistoryPanel from './components/HistoryPanel';
import VictoryCelebration from './components/VictoryCelebration';
import MatchFusion, { type FusionEvent } from './components/MatchFusion';
import WordHarvest from './components/WordHarvest';
import WordIllustration from './components/WordIllustration';
import { loadMatchAnimation, saveMatchAnimation } from './game/preferences';
import { getMatchedTiles } from './game/matchPresentation';
import { getWordIllustration, loadIllustrationManifest, loadWordIllustrations, preloadWordIllustrations, recordIllustrationPractice } from './game/wordIllustrations';
import type { IllustrationManifest } from './data/illustrationSchema';
import { appendCompletion } from './game/history';
import { loadCourseLevel, loadManifest, stageProfile, STAGE_PROFILES, type CourseLevel, type StageId, type VocabularyManifest } from './data/library';
import { getCurrentStreak, loadProgress, markSeen, recordResult, saveProgress, toggleSaved } from './game/progress';

type Phase = 'ready' | 'memory' | 'playing' | 'result';
type View = 'game' | 'notebook' | 'history';
type Dialog = 'rules' | 'leave' | null;
const KIND_LABELS = { word: '单词', pos: '词性', meaning: '含义' };
const POS_LABELS: Record<string, string> = { 'n.': '名词', 'v.': '动词', 'adj.': '形容词', 'adv.': '副词', 'pron.': '代词', 'prep.': '介词', 'conj.': '连词', 'num.': '数词', 'art.': '冠词', 'interj.': '感叹词' };
const LEVEL_ICONS = [Sprout, Coffee, Building2, Heart, Lightbulb, Compass];
const formatTime = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;

function StarRating({ value, size = 12 }: { value: number; size?: number }) {
  return <span className="stars" aria-label={`${value} 颗星`}>{[1, 2, 3].map(i => <Star key={i} size={size} fill={i <= value ? 'currentColor' : 'none'} strokeWidth={1.6} style={{ opacity: i <= value ? 1 : .35 }} />)}</span>;
}

function WordCard({ word, speak }: { word: Word; speak: (text: string) => void }) {
  return <article className={`memory-card${getWordIllustration(word) ? ' has-illustration' : ''}`}>
    <WordIllustration word={word} className="memory-image" />
    <div className="memory-card-copy">
      <div className="memory-word-line"><h3 className="memory-word" lang="en">{word.word}</h3><button className="pronounce" aria-label={`朗读 ${word.word}`} onClick={() => speak(word.word)}><Volume2 size={16} /></button></div>
      <p className="phonetic" lang="en">{word.phonetic}</p>
      <div className="memory-meaning"><span className="pos-chip" title={POS_LABELS[word.pos]}>{word.pos}</span><span>{word.meaning}</span></div>
    </div>
  </article>;
}

function TileFace({ tile }: { tile: Tile }) {
  return <><span className={`tile-content ${tile.text.length > 10 ? 'long-copy' : ''}`} lang={tile.kind === 'meaning' ? 'zh-CN' : 'en'}>{tile.text}</span><span className="tile-kind">{KIND_LABELS[tile.kind]}</span></>;
}

export default function App() {
  const [progress, setProgress] = useState(loadProgress);
  const [view, setView] = useState<View>('game');
  const [levelIndex, setLevelIndex] = useState(0);
  const [mode, setMode] = useState<'theme' | 'curriculum'>('theme');
  const [courseStage, setCourseStage] = useState<StageId>('primary');
  const [courseRound, setCourseRound] = useState(1);
  const [courseLevel, setCourseLevel] = useState<CourseLevel | null>(null);
  const [manifest, setManifest] = useState<VocabularyManifest | null>(null);
  const [pictureCoverage, setPictureCoverage] = useState<IllustrationManifest | null>(null);
  const [courseLoading, setCourseLoading] = useState(false);
  const [courseError, setCourseError] = useState('');
  const courseRequest = useRef(0);
  const level = mode === 'curriculum' && courseLevel ? courseLevel : LEVELS[levelIndex];
  const [phase, setPhase] = useState<Phase>('ready');
  const [memoryDuration, setMemoryDuration] = useState(60);
  const [remaining, setRemaining] = useState(60);
  const [game, setGame] = useState<GameState | null>(null);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [toolsLeft, setToolsLeft] = useState({ undo: 3, hint: 2, shuffle: 2 });
  const [assistCount, setAssistCount] = useState(0);
  const [hinted, setHinted] = useState<string[]>([]);
  const [lastMatched, setLastMatched] = useState<Word | null>(null);
  const [sound, setSound] = useState(false);
  const [matchAnimation, setMatchAnimation] = useState(loadMatchAnimation);
  const [fusion, setFusion] = useState<FusionEvent | null>(null);
  const fusionRef = useRef<FusionEvent | null>(null);
  const harvestTargetRef = useRef<HTMLDivElement>(null);
  const [toast, setToast] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [runId, setRunId] = useState('');
  const activeRunId = useRef('');
  const [historyRevision, setHistoryRevision] = useState(0);
  const [historySaveState, setHistorySaveState] = useState<'idle' | 'saving' | 'saved' | 'temporary'>('idle');
  const studySeconds = useRef(0);
  const memoryStarted = useRef(0);
  const memoryPaused = useRef(0);
  const modalRef = useRef<HTMLDialogElement>(null);
  const pendingAction = useRef<(() => void) | null>(null);
  const memoryDeadline = useRef(0);
  const roundStarted = useRef(0);
  const gamePauseStarted = useRef<number | null>(null);
  const pauseTotal = useRef(0);
  const gameElapsedMs = useRef(0);
  const gameFinishedAt = useRef<string | null>(null);
  const dialogPause = useRef<{ started: number; phase: Phase } | null>(null);
  const resultSaved = useRef(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const illustrationStorageWarned = useRef(false);
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3500);
  }, []);

  const clearFusion = useCallback(() => { fusionRef.current = null; setFusion(null); }, []);
  const finishFusion = useCallback((id: string) => {
    if (fusionRef.current?.id === id) clearFusion();
  }, [clearFusion]);
  const readGameElapsedMs = useCallback((now = Date.now()) => Math.max(0,
    now - roundStarted.current - pauseTotal.current - (gamePauseStarted.current === null ? 0 : now - gamePauseStarted.current)), []);
  const toggleMatchAnimation = () => {
    const enabled = !matchAnimation;
    setMatchAnimation(enabled);
    if (!enabled) clearFusion();
    if (!saveMatchAnimation(enabled)) notify('本次动画设置已生效，但浏览器未能保存，刷新后可能恢复默认。');
  };

  useEffect(() => { loadManifest().then(setManifest).catch(() => {}); }, []);
  useEffect(() => { loadIllustrationManifest().then(setPictureCoverage).catch(() => {}); }, []);
  useEffect(() => {
    if (view === 'game') preloadWordIllustrations(level.words);
  }, [view, level.words]);

  useEffect(() => {
    setStorageAvailable(saveProgress(progress));
  }, [progress]);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const speak = useCallback((text: string) => {
    if (!('speechSynthesis' in window)) { notify('当前浏览器暂不支持朗读，可以参考单词音标。'); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-GB';
    utterance.rate = .85;
    const voice = window.speechSynthesis.getVoices().find(item => item.lang === 'en-GB');
    if (voice) utterance.voice = voice;
    utterance.onerror = event => { if (event.error !== 'canceled' && event.error !== 'interrupted') notify('暂时无法播放发音，请检查浏览器的语音支持。'); };
    window.speechSynthesis.speak(utterance);
  }, [notify]);

  const startPlaying = useCallback(() => {
    if (phaseRef.current !== 'memory') return;
    phaseRef.current = 'playing';
    studySeconds.current = Math.round(Math.min(memoryDuration, Math.max(0, (Date.now() - memoryStarted.current - memoryPaused.current) / 1000)) * 1000) / 1000;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setGame(createGame(level.words, Date.now(), window.matchMedia('(max-width: 720px)').matches));
    setProgress(current => markSeen(current, level.words.map(word => word.id)));
    setPhase('playing');
    setRemaining(0);
    roundStarted.current = Date.now();
    pauseTotal.current = 0;
    gamePauseStarted.current = null;
    gameFinishedAt.current = null;
    gameElapsedMs.current = 0;
    setElapsed(0);
    setPaused(false);
    setToolsLeft({ undo: 3, hint: 2, shuffle: 2 });
    setAssistCount(0);
    setHinted([]);
    setLastMatched(null);
    resultSaved.current = false;
  }, [level, memoryDuration]);

  useEffect(() => {
    if (dialog && !dialogPause.current) {
      dialogPause.current = { started: Date.now(), phase };
    } else if (!dialog && dialogPause.current) {
      const previous = dialogPause.current;
      const duration = Date.now() - previous.started;
      if (previous.phase === phase) {
        if (phase === 'memory') { memoryDeadline.current += duration; memoryPaused.current += duration; }
      }
      dialogPause.current = null;
    }
  }, [dialog, phase]);

  // Count overlapping manual pauses, dialogs and card presentations only once.
  const gameInterrupted = paused || !!dialog || !!fusion;
  useEffect(() => {
    if (phase !== 'playing') { gamePauseStarted.current = null; return; }
    if (gameInterrupted) {
      if (gamePauseStarted.current === null) gamePauseStarted.current = Date.now();
    } else if (gamePauseStarted.current !== null) {
      pauseTotal.current += Date.now() - gamePauseStarted.current;
      gamePauseStarted.current = null;
    }
  }, [phase, gameInterrupted]);

  useEffect(() => {
    if (phase !== 'memory' || dialog) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((memoryDeadline.current - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) startPlaying();
    };
    tick();
    const interval = setInterval(tick, 200);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', tick); };
  }, [phase, startPlaying, dialog]);

  useEffect(() => {
    if (phase !== 'playing' || gameInterrupted || game?.status !== 'playing') return;
    const tick = () => setElapsed(Math.floor(readGameElapsedMs() / 1000));
    tick();
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [phase, gameInterrupted, game?.status, readGameElapsedMs]);

  const matchCount = game?.matchedWordIds.length ?? 0;
  const score = Math.max(0, matchCount * 100 - assistCount * 30);
  const stars = assistCount === 0 ? 3 : assistCount <= 2 ? 2 : 1;

  useEffect(() => {
    if (phase !== 'playing' || !game || game.status === 'playing') return;
    if (!gameFinishedAt.current) {
      gameElapsedMs.current = readGameElapsedMs();
      gameFinishedAt.current = new Date().toISOString();
    }
    const finishTime = Math.floor(gameElapsedMs.current / 1000);
    setElapsed(finishTime);
    if (!fusion) setPhase('result');
    if (game.status === 'won' && !resultSaved.current) {
      resultSaved.current = true;
      const completedAt = gameFinishedAt.current;
      const preciseGameSeconds = Math.round(gameElapsedMs.current) / 1000;
      setProgress(current => recordResult(current, { id: runId, levelId: level.id, stars, score, timeSeconds: finishTime, wordIds: level.words.map(word => word.id) }));
      setHistorySaveState('saving');
      void appendCompletion({ id: runId, levelId: level.id, levelTitle: level.title, mode,
        ...(mode === 'curriculum' && courseLevel ? { stageId: courseLevel.stageId, stageTitle: courseLevel.stageTitle, round: courseLevel.round } : {}),
        wordCount: level.words.length, gameSeconds: preciseGameSeconds, studySeconds: studySeconds.current,
        totalSeconds: Math.round((preciseGameSeconds + studySeconds.current) * 1000) / 1000,
        stars, score, assists: assistCount, completedAt,
      }).then(result => {
        setHistoryRevision(value => value + 1);
        if (activeRunId.current === runId) setHistorySaveState(result.persisted ? 'saved' : 'temporary');
        if (!result.persisted) notify('本次通关记录仅保存在当前页面，请到通关足迹导出备份。');
      }).catch(() => { if (activeRunId.current === runId) setHistorySaveState('temporary'); notify('通关记录未能持久保存，请到通关足迹查看并导出备份。'); });
    }
  }, [game, phase, level, score, stars, runId, mode, courseLevel, assistCount, notify, fusion, readGameElapsedMs]);

  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;
    if (dialog && !modal.open) modal.showModal();
    if (!dialog && modal.open) modal.close();
  }, [dialog]);

  const startMemory = () => {
    if (mode === 'curriculum' && (!courseLevel || courseLoading)) return;
    clearFusion();
    const id = crypto.randomUUID();
    setRunId(id); activeRunId.current = id;
    setHistorySaveState('idle');
    memoryStarted.current = Date.now(); memoryPaused.current = 0;
    setView('game');
    setPhase('memory');
    setRemaining(memoryDuration);
    memoryDeadline.current = Date.now() + memoryDuration * 1000;
    setGame(null);
    setPaused(false);
    setHinted([]);
    setLastMatched(null);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  };

  const guardNavigation = (action: () => void) => {
    if (phase === 'memory' || (phase === 'playing' && game?.status === 'playing')) { pendingAction.current = action; setDialog('leave'); }
    else action();
  };
  const goView = (next: View) => {
    if (view === next) return;
    guardNavigation(() => { clearFusion(); setView(next); setPhase('ready'); setGame(null); setPaused(false); });
  };
  const chooseLevel = (index: number) => guardNavigation(() => { clearFusion(); courseRequest.current++; setMode('theme'); setCourseLoading(false); setLevelIndex(index); setPhase('ready'); setGame(null); setPaused(false); setMemoryDuration(LEVELS[index].memorySeconds > 60 ? 90 : 60); });
  const prepareCourse = async (stageId: StageId, round: number) => {
    clearFusion();
    const request = ++courseRequest.current;
    setMode('curriculum'); setCourseStage(stageId); setCourseRound(round); setCourseLevel(null);
    setCourseLoading(true); setCourseError(''); setPhase('ready'); setGame(null); setPaused(false);
    try {
      const [info, next] = await Promise.all([loadManifest(), loadCourseLevel(stageId, round)]);
      await loadWordIllustrations(next.words);
      if (request !== courseRequest.current) return;
      setManifest(info); setCourseLevel(next); setMemoryDuration(next.memorySeconds);
    } catch (failure) {
      if (request === courseRequest.current) setCourseError(failure instanceof Error ? failure.message : '本关词汇暂时无法读取，请重试。');
    } finally { if (request === courseRequest.current) setCourseLoading(false); }
  };
  const chooseCourse = (stageId: StageId, round: number) => guardNavigation(() => { void prepareCourse(stageId, round); });
  const nextChallenge = () => {
    if (mode === 'theme') { if (levelIndex < LEVELS.length - 1) chooseLevel(levelIndex + 1); else goView('notebook'); return; }
    if (!courseLevel) return;
    if (courseRound < courseLevel.roundCount) { chooseCourse(courseStage, courseRound + 1); return; }
    const index = STAGE_PROFILES.findIndex(stage => stage.id === courseStage);
    if (index < STAGE_PROFILES.length - 1) chooseCourse(STAGE_PROFILES[index + 1].id, 1);
    else goView('notebook');
  };

  const pickTile = (id: string) => {
    if (!game || paused || phase !== 'playing' || dialog || fusionRef.current) return;
    const next = selectTile(game, id);
    if (next === game) return;
    if (next.status !== 'playing') {
      gameElapsedMs.current = readGameElapsedMs();
      gameFinishedAt.current = new Date().toISOString();
    }
    if (next.lastMatch && matchAnimation) {
      const word = level.words.find(item => item.id === next.lastMatch)!;
      const sources = getMatchedTiles(game, next, id).map(tile => {
        const element = document.querySelector<HTMLElement>(`[data-tray-tile="${CSS.escape(tile.id)}"], [data-tile-id="${CSS.escape(tile.id)}"]`);
        const bounds = element?.getBoundingClientRect();
        return { kind: tile.kind, text: tile.text, rect: bounds ? { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height } : { left: window.innerWidth / 2 - 30, top: window.innerHeight / 2 - 35, width: 60, height: 70 } };
      });
      const presentation: FusionEvent = { id: `${runId}:${next.moves}`, word, sources };
      fusionRef.current = presentation;
      setFusion(presentation);
    }
    setGame(next);
    setHinted(ids => ids.filter(item => item !== id));
    if (next.lastMatch) {
      const word = level.words.find(item => item.id === next.lastMatch)!;
      if (!recordIllustrationPractice(word) && !illustrationStorageWarned.current) {
        illustrationStorageWarned.current = true;
        notify('待配图词单暂时只保存在本页，可在收获区展开后导出备份。');
      }
      setLastMatched(word);
      if (sound) speak(word.word);
    }
  };

  const useTool = (tool: 'undo' | 'hint' | 'shuffle') => {
    if (!game || paused || dialog || fusionRef.current || game.status === 'won' || toolsLeft[tool] === 0) return;
    if (tool === 'hint') {
      const ids = getHint(game);
      if (!ids.length) { notify('暂时找不到安全的配对。试试撤回或洗牌，本次不消耗提示。'); return; }
      setHinted(ids);
      const labels = ids.map(id => game.tiles.find(tile => tile.id === id)!).map(tile => `${KIND_LABELS[tile.kind]}「${tile.text}」`).join('、');
      notify(`可以选择${labels}，已在棋盘标出。`);
    } else if (tool === 'undo') {
      const next = undoMove(game);
      if (next === game) return;
      setGame(next);
      setHinted([]);
      if (phase === 'result') { roundStarted.current = Date.now() - gameElapsedMs.current; pauseTotal.current = 0; gamePauseStarted.current = null; gameFinishedAt.current = null; setPhase('playing'); }
      notify('已放回最后一张牌，已完成的配对会保留。');
    } else {
      const next = shuffleBoard(game);
      if (next === game) return;
      if (!next.solution.length) { notify('当前暂存槽无法通过洗牌恢复，请先撤回或重新记忆。本次不消耗道具。'); return; }
      setGame(next);
      setHinted([]);
      notify('棋盘已重新排列，暂存槽里的牌保持不变。');
    }
    setToolsLeft(current => ({ ...current, [tool]: current[tool] - 1 }));
    setAssistCount(count => count + 1);
  };

  const togglePause = () => {
    setPaused(!paused);
    if (!paused && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  };

  const ArenaHeader = ({ label }: { label: string }) => <div className="arena-header"><span className="level-label"><span>{mode === 'theme' ? String(level.id).padStart(2, '0') : <GraduationCap size={14} />}</span>{level.title}</span><span className="phase-label">{phase === 'playing' ? <Layers3 size={13} /> : <Leaf size={13} />}{label}</span></div>;
  const won = game?.status === 'won';
  const currentStreak = getCurrentStreak(progress);
  const hasWordHarvest = matchAnimation && view === 'game' && !!game && (phase === 'playing' || phase === 'result');
  const harvestedWords = (game?.matchedWordIds ?? []).filter(id => id !== fusion?.word.id).map(id => level.words.find(word => word.id === id)!);

  return <div className={`app ${hasWordHarvest ? 'has-word-harvest' : ''}`}>
    <header className="app-header">
      <button className="brand" aria-label="LingoTiles 首页" onClick={() => goView('game')}><span className="brand-icon">L</span><span className="brand-copy">LingoTiles<small>词了个词</small></span></button>
      <nav className="main-nav" aria-label="主导航">
        <button className={`nav-button ${view === 'game' ? 'active' : ''}`} aria-current={view === 'game' ? 'page' : undefined} onClick={() => goView('game')}><Layers3 size={16} />闯关练习</button>
        <button className={`nav-button ${view === 'notebook' ? 'active' : ''}`} aria-current={view === 'notebook' ? 'page' : undefined} onClick={() => goView('notebook')}><BookOpen size={16} />单词本</button>
        <button className={`nav-button ${view === 'history' ? 'active' : ''}`} aria-current={view === 'history' ? 'page' : undefined} onClick={() => goView('history')}><History size={16} />通关足迹</button>
        <button className="nav-button rules-nav" onClick={() => setDialog('rules')}><CircleHelp size={16} />玩法说明</button>
      </nav>
      <div className="header-right"><span className="streak"><Flame size={16} />{currentStreak > 0 ? `连续 ${currentStreak} 天` : '每天一点进步'}</span><button className="icon-button" aria-label={sound ? '关闭消除朗读' : '开启消除朗读'} aria-pressed={sound} title={sound ? '消除时自动朗读：已开启' : '消除时自动朗读：已关闭'} onClick={() => { setSound(!sound); if (sound && 'speechSynthesis' in window) window.speechSynthesis.cancel(); notify(sound ? '已关闭消除时的自动朗读。' : '已开启消除时的自动朗读。'); }}>{sound ? <Volume2 size={17} /> : <VolumeX size={17} />}</button></div>
    </header>

    <main className="workspace">
      {view === 'history' ? <HistoryPanel refreshKey={historyRevision} legacySessions={progress.sessions} onBack={() => goView('game')} /> : view === 'notebook' ? <VocabularyNotebook progress={progress} onSave={id => setProgress(current => toggleSaved(current, id))} speak={speak} /> : <>
        <div className="page-heading"><div><h1>{phase === 'ready' ? '玩一小局，记住一点新世界。' : phase === 'memory' ? '先记住，让单词在脑海里碰个面。' : phase === 'playing' ? '把刚刚记住的，连在一起。' : won ? '你又收获了一小片新世界。' : '没关系，再给记忆一次机会。'}</h1><p>{phase === 'ready' ? '先记忆，再消除。让每一次配对，都成为一次真正的记住。' : phase === 'memory' ? '这一关的所有单词都在这里。倒计时结束后，自动进入消除。' : phase === 'playing' ? '单词 + 对应词性 + 中文含义，三张一组，顺序不限。' : won ? '回顾一下刚刚学到的单词，再出发。' : '记住已经完成的配对，剩下的慢慢来。'}</p></div><span className="date-note"><Sprout size={16} />小小积累，也会生长</span></div>
        <div className="learning-options"><div className="learning-mode" aria-label="选择关卡模式"><button className={mode === 'theme' ? 'active' : ''} aria-pressed={mode === 'theme'} onClick={() => chooseLevel(levelIndex)}><Sprout size={16} />经典主题<span>保留原 6 关</span></button><button className={mode === 'curriculum' ? 'active' : ''} aria-pressed={mode === 'curriculum'} onClick={() => chooseCourse(courseStage, courseRound)}><GraduationCap size={17} />分级闯关<span>小学 → 大学 · 10 万词</span></button></div><div className="fusion-setting"><div className="fusion-setting-copy"><strong><Sparkles size={14} />配对合成动画</strong><p id="fusion-setting-description">三牌合成后飞入收获区 · 展示不计入用时</p></div><button type="button" role="switch" className="fusion-toggle" aria-label="配对合成动画" aria-checked={matchAnimation} aria-describedby="fusion-setting-description" onClick={toggleMatchAnimation}><span className="fusion-switch-track" aria-hidden="true"><span /></span><span aria-hidden="true">{matchAnimation ? '开启' : '关闭'}</span></button></div></div>
        {phase === 'ready' && pictureCoverage && <p className="illustration-coverage">词义配图：已内置 <strong>{pictureCoverage.ready.toLocaleString('zh-CN')}</strong> / {pictureCoverage.total.toLocaleString('zh-CN')} 词<span>待补齐 {pictureCoverage.pending.toLocaleString('zh-CN')} 词</span></p>}
        {mode === 'curriculum' && phase === 'ready' && <CurriculumPicker manifest={manifest} stageId={courseStage} round={courseRound} loading={courseLoading} error={courseError} progress={progress} onSelect={chooseCourse} onRetry={() => { void prepareCourse(courseStage, courseRound); }} />}
        {(mode === 'theme' || courseLevel) && <div className={`game-layout ${phase}`}>
          <section className="arena" aria-label="关卡游戏区">
            <ArenaHeader label={phase === 'ready' ? '准备好了吗？' : phase === 'memory' ? '记忆时间' : phase === 'playing' ? `${game?.tiles.length ?? 0} 张待取` : won ? '本关已完成' : '暂存槽已满'} />
            {phase === 'ready' && <>
              <div className="ready-scene"><h2>{mode === 'theme' && level.id === 1 ? <>在花园里，<br />种下新单词。</> : level.title}</h2><p>{level.description}</p><div className="sample-trio" aria-label="示例：bloom 加 n. 加 花朵，组成一组"><div className="sample-card word">bloom<small>单词</small></div><span className="sample-plus">+</span><div className="sample-card pos">n.<small>词性</small></div><span className="sample-plus">+</span><div className="sample-card meaning">花朵<small>含义</small></div></div><div className="match-caption"><Sparkles size={14} />三张不同的牌，同一个新记忆</div></div>
              <div className="arena-bottom"><span><Timer size={14} />限时记忆</span><span><Layers3 size={14} />三牌配对</span><span><Sprout size={14} />轻松积累</span></div>
            </>}
            {phase === 'memory' && <><div className="memory-header"><div><h2>本关词表</h2><p>试着把英文、词性和含义一起读出来。</p></div><span className="phase-label">共 {level.words.length} 个单词</span></div><div className="memory-grid">{level.words.map(word => <WordCard key={word.id} word={word} speak={speak} />)}</div></>}
            {phase === 'playing' && game && (paused ? <div className="paused-board"><Pause size={40} strokeWidth={1.3} /><h2>休息一下，记忆也需要呼吸。</h2><p>棋盘已收起，游戏计时暂停。</p><button className="primary-button" onClick={togglePause}><Play size={16} />继续游戏</button></div> : <>
              <div className="board-wrapper"><div className="board-legend"><span><i className="legend-dot" />单词</span><span><i className="legend-dot pos" />词性</span><span><i className="legend-dot meaning" />含义</span></div>
                <div aria-busy={!!fusion} className={`tile-board ${game.boardWidth === 4 ? 'compact-board' : ''}`} style={{ aspectRatio: `${game.boardWidth} / ${game.boardHeight}` }}>
                  {game.tiles.map(tile => <button key={tile.id} data-tile-id={tile.id} className={`tile ${tile.kind} ${hinted.includes(tile.id) ? 'hinted' : ''}`} disabled={!!fusion || !isTileAvailable(tile, game.tiles)} onClick={() => pickTile(tile.id)} aria-label={`${hinted.includes(tile.id) ? '提示，' : ''}${KIND_LABELS[tile.kind]}：${tile.text}${isTileAvailable(tile, game.tiles) ? '' : '，被上层遮挡'}`} style={{ left: `calc(${tile.x / game.boardWidth * 100}% + 3px)`, top: `${tile.y / game.boardHeight * 100}%`, width: `calc(${100 / game.boardWidth}% - 6px)`, height: `calc(${100 / game.boardHeight}% - 9px)`, zIndex: tile.layer + 1 } as CSSProperties}><TileFace tile={tile} /></button>)}
                </div><div className="board-caption"><LockKeyhole size={10} /> 被遮住的牌，要先移开上层才能选择</div>
              </div>
              <div className="tray-area"><div className={`tray-heading ${game.tray.length >= 5 ? 'danger' : ''}`}><strong>{game.tray.length >= 5 ? '槽位快满了，优先完成已有配对' : '暂存槽 · 凑齐一组就会自动消除'}</strong><span>{game.tray.length} / 7</span></div><div className="tray" aria-label={`暂存槽，已使用 ${game.tray.length} 个，共 7 个`}>{Array.from({ length: 7 }, (_, index) => <div className="tray-slot" key={index}>{game.tray[index] && <div className={`tile tray-tile ${game.tray[index].kind}`} data-tray-tile={game.tray[index].id} title={`${KIND_LABELS[game.tray[index].kind]}：${game.tray[index].text}`}><TileFace tile={game.tray[index]} /></div>}</div>)}</div>{game.tray.length > 0 && <p className="tray-readout">{game.tray.map(tile => tile.text).join(" · ")}</p>}</div>
            </>)}
            {phase === 'result' && game && <div className="result-content"><div className="result-medal">{won ? <Trophy size={34} strokeWidth={1.6} /> : <Sprout size={34} strokeWidth={1.6} />}</div><h2>{won ? '这些单词，你记住了！' : '差一点点，再试一次。'}</h2><p>{won ? `完成 ${level.words.length} 组配对，每一点努力都有回响。` : `这一局已配对 ${matchCount} / ${level.words.length} 个单词，继续练习会更熟悉。`}</p>{won && <div className="result-stars"><StarRating value={stars} size={30} /></div>}<p className="result-time"><Timer size={16} />本次消除 {formatTime(elapsed)}<span>记忆 {formatTime(Math.floor(studySeconds.current))}</span></p><div className="result-word-list">{level.words.filter(word => game.matchedWordIds.includes(word.id)).map(word => <span key={word.id}>{word.word} · {word.meaning}</span>)}</div><div className="result-actions">{won ? <><button className="primary-button" onClick={nextChallenge}>{mode === 'curriculum' || levelIndex < LEVELS.length - 1 ? '前往下一关' : '到单词本复习'}<ArrowRight size={16} /></button><button className="secondary-button" onClick={startMemory}><RotateCcw size={15} />再练一次</button></> : <><button className="primary-button" onClick={startMemory}><RotateCcw size={16} />重新记忆</button>{game.undo && toolsLeft.undo > 0 && <button className="secondary-button" onClick={() => useTool('undo')}><Undo2 size={16} />撤回并继续（{toolsLeft.undo}）</button>}</>}</div></div>}
          </section>

          <aside className="side-column" aria-label="本轮控制台">
            {phase === 'ready' && <div className="side-panel ready-controls"><div className="side-eyebrow"><Sprout size={14} />{mode === 'theme' ? `第 ${level.id} 关 · 经典主题` : `${stageProfile(courseStage).title} · 第 ${courseRound} 关`}</div><h2>一场小小的记忆挑战</h2><p className="side-description">先给自己一点时间记住词表，<br />再让它们在棋盘上重逢。</p><div className="round-facts"><div><strong>{level.words.length}<small>个</small></strong><label>本关单词</label></div><div><strong>{level.words.length * 3}<small>张</small></strong><label>待消除卡牌</label></div></div><div className="duration-picker"><div className="duration-label"><Timer size={13} />记忆时长</div><div className="segmented" aria-label="选择记忆时长">{(mode === 'theme' ? [30, 60, 90] : [level.memorySeconds, level.memorySeconds + 30, level.memorySeconds + 60]).map(duration => <button key={duration} className={memoryDuration === duration ? 'active' : ''} aria-pressed={memoryDuration === duration} onClick={() => setMemoryDuration(duration)}>{duration} 秒</button>)}</div></div><div className="start-group"><button className="primary-button full-width start-button" onClick={startMemory}>开始记忆<ArrowRight size={16} /></button><p className="subnote">点击后才开始计时，准备好了再出发</p></div></div>}
            {phase === 'memory' && <div className="side-panel memory-controls"><div className="side-eyebrow"><Timer size={14} />先记忆 · 再消除</div><h2>给记忆一点时间</h2><div className={`timer ${remaining <= 10 ? 'urgent' : ''}`} role="timer" aria-label={`记忆剩余 ${remaining} 秒`}><strong>{remaining}</strong><span>秒后进入消除</span></div><p className="memory-tip">把单词放进一幅画面里。<br /><strong>词性也是配对的一部分。</strong></p><button className="primary-button full-width start-button" onClick={startPlaying}>记好了，开始消除<ArrowRight size={16} /></button><p className="subnote">还没记全也没关系，结束后可以再复习</p></div>}
            {phase === 'playing' && game && <div className="side-panel play-controls"><div className="side-eyebrow"><Layers3 size={14} />回忆正在发生</div><h2>{paused ? '稍作休息' : '慢慢来，配对就好'}</h2><div className="score-row"><div><label>本轮积分</label><div><strong>{score}</strong></div></div><div><label>游戏用时</label><div><strong className="time-value">{formatTime(elapsed)}</strong></div></div></div><div className="progress-section"><div className="progress-label"><span>已记住</span><span>{matchCount} / {level.words.length}</span></div><div className="progress-bar" role="progressbar" aria-label="配对进度" aria-valuenow={matchCount} aria-valuemin={0} aria-valuemax={level.words.length}><span style={{ transform: `scaleX(${matchCount / level.words.length})` }} /></div></div><div className="match-feedback" aria-live="polite">{lastMatched ? <><div className="matched-line"><Check size={14} /><strong lang="en">{lastMatched.word}</strong></div><span>{lastMatched.pos} {lastMatched.meaning} · 配对成功 +100</span></> : <span>找到三张对应的牌，<br />收获今天的第一个单词。</span>}</div><div className="tool-row"><button className="tool-button" disabled={paused || !!fusion || game.status !== 'playing' || !game.undo || toolsLeft.undo === 0} onClick={() => useTool('undo')} aria-label={`撤回，剩余 ${toolsLeft.undo} 次`}><Undo2 size={20} /><span>撤回</span><small>{toolsLeft.undo}</small></button><button className="tool-button" disabled={paused || !!fusion || game.status !== 'playing' || toolsLeft.hint === 0} onClick={() => useTool('hint')} aria-label={`提示，剩余 ${toolsLeft.hint} 次`}><Lightbulb size={20} /><span>提示</span><small>{toolsLeft.hint}</small></button><button className="tool-button" disabled={paused || !!fusion || game.status !== 'playing' || toolsLeft.shuffle === 0} onClick={() => useTool('shuffle')} aria-label={`洗牌，剩余 ${toolsLeft.shuffle} 次`}><Shuffle size={20} /><span>洗牌</span><small>{toolsLeft.shuffle}</small></button></div>{fusion && <p className="fusion-reading-note">{game.status === 'won' ? '收好最后一张词卡，就完成本关。' : '看清这一组配对，收好后继续。'} 展示不计入用时。</p>}<div className="round-actions"><button className="text-button" onClick={togglePause}>{paused ? <Play size={13} /> : <Pause size={13} />}{paused ? '继续游戏' : '暂停一下'}</button><button className="text-button" onClick={() => guardNavigation(startMemory)}><RotateCcw size={13} />重新记忆</button></div></div>}
            {phase === 'result' && <div className="side-panel"><div className="side-eyebrow">{won ? <ShieldCheck size={14} /> : <Leaf size={14} />}{won ? historySaveState === 'saved' ? '本次通关已记录' : historySaveState === 'saving' ? '正在保存通关足迹…' : '本次记录仅保留在本页' : '每一局都在积累'}</div><h2>这一次的收获</h2><div className="round-facts"><div><strong>{score}</strong><label>本轮积分</label></div><div><strong style={{ fontSize: 26 }}>{formatTime(elapsed)}</strong><label>游戏用时</label></div></div><p className="help-text">{won ? assistCount === 0 ? '没有使用道具，独立完成所有配对。三颗星，送给专注的你。' : `使用了 ${assistCount} 次辅助。可以再练一遍，试着独立完成。` : '优先凑齐暂存槽中已有的单词。相同词性的牌可以通用，别让零散的牌占满空位。'}</p><button className="text-button full-width" style={{ marginTop: 12 }} onClick={() => goView('history')}><History size={15} />查看每次通关的用时<ChevronRight size={14} /></button><button className="text-button full-width" style={{ marginTop: 5 }} onClick={() => goView('notebook')}><BookOpen size={15} />去单词本听一听、看一看<ChevronRight size={14} /></button></div>}
            <div className="stats-strip"><div><strong>{progress.seen.length}</strong><span>已复习单词</span></div><div><strong>{Object.keys(progress.completed).filter(key => Number(key) < 100000).length}<span> / 6</span></strong><span>主题关卡</span></div><div><strong>{Object.values(progress.completed).reduce((total, item) => total + item.stars, 0)}</strong><span>收获星星</span></div></div>
            <p className="tiny-tip"><Lightbulb size={16} /><span>{phase === 'playing' ? '每次使用道具扣 30 分。无辅助通关可获得 3 颗星。' : '不用一次记住所有。每次主动回想，都是在加深记忆。'}</span></p>
          </aside>
        </div>}

        <section className="journey" aria-labelledby="journey-title"><div className="section-heading"><h2 id="journey-title"><Compass size={17} strokeWidth={1.7} />你的单词旅程</h2><p>原有 6 个主题完整保留 · 54 个精选词</p></div><div className="level-grid">{LEVELS.map((item, index) => { const Icon = LEVEL_ICONS[index]; const completed = progress.completed[item.id]; return <button className={`level-card ${mode === 'theme' && index === levelIndex ? 'selected' : ''}`} key={item.id} aria-pressed={mode === 'theme' && index === levelIndex} aria-label={`第 ${item.id} 关 ${item.title}，${item.words.length} 个单词${completed ? `，已获得 ${completed.stars} 颗星` : ''}`} onClick={() => chooseLevel(index)}><div className="level-card-top"><span>0{item.id}</span>{completed ? <StarRating value={completed.stars} size={10} /> : mode === 'theme' && index === levelIndex ? <span style={{ color: 'var(--green)' }}>当前关卡</span> : <ChevronRight size={12} />}</div><div className="level-symbol"><Icon size={19} strokeWidth={1.6} /></div><h3>{item.title}</h3><p>{item.words.length} 个单词 · {item.words.length * 3} 张卡牌</p></button>; })}</div></section>
      </>}
    </main>

    <footer className="app-footer"><div className="footer-left">Made with <Heart size={11} className="heart" /> by <a href="https://brclio.com" target="_blank" rel="noreferrer">Brclio</a><span>· 让学习多一点好玩</span></div><span>{storageAvailable ? '收藏与关卡最佳成绩保存在当前浏览器 · 无需登录' : '学习进度暂未保存 · 刷新可能丢失'}</span></footer>
    <div className="sr-only" aria-live="polite">{phase === 'memory' && remaining === 10 ? '还剩 10 秒记忆时间' : phase === 'playing' ? '消除阶段已开始' : phase === 'result' ? won ? '恭喜通关' : '暂存槽已满，可以撤回或重试' : ''}</div>
    {hasWordHarvest && <WordHarvest key={runId} words={harvestedWords} total={level.words.length} targetRef={harvestTargetRef} />}
    {fusion && matchAnimation && view === 'game' && <MatchFusion key={fusion.id} event={fusion} targetRef={harvestTargetRef} paused={paused || !!dialog} onComplete={finishFusion} />}
    {phase === 'result' && won && view === 'game' && <VictoryCelebration runId={runId} stars={stars} />}
    {toast && <div className="toast" role="status">{toast}</div>}
    <dialog ref={modalRef} onCancel={() => setDialog(null)} onClick={event => { if (event.target === event.currentTarget) setDialog(null); }} aria-labelledby="dialog-title"><div className="dialog-content"><div className="dialog-top"><h2 id="dialog-title">{dialog === 'rules' ? '小小三张牌，大大新世界。' : '离开这一局？'}</h2><button className="icon-button" aria-label="关闭对话框" onClick={() => setDialog(null)}><X size={18} /></button></div>{dialog === 'rules' ? <><ol className="rule-list"><li><span className="rule-number">1</span><div><h3>先记住整关词表</h3><p>选择 30、60 或 90 秒记忆时间。开始后可看到本关所有单词、词性和含义，也可以点击喇叭听发音。时间到自动进入游戏，记好了也可以提前开始。</p></div></li><li><span className="rule-number">2</span><div><h3>把三个部分配成一组</h3><p>点击未被遮住的牌放入暂存槽。一个单词、它的词性、对应的中文含义凑齐后自动消除，点击顺序不限。可开启「配对合成动画」，先看清英文、词性、中文组成的完整词卡，再收入本关收获区；默认关闭，展示时间不计入游戏用时。</p><div className="rule-example"><span>apple</span>+<span>n.</span>+<span>苹果</span>=<Check size={16} /></div><p style={{ marginTop: 8 }}>相同词性和相同中文含义的牌都可通用：任何一张 n. 都能配名词。n. 名词 · v. 动词 · adj. 形容词 · adv. 副词。</p></div></li><li><span className="rule-number">3</span><div><h3>留意你的 7 个空位</h3><p>暂存槽有 7 格，装满且无法消除时本局结束。可以撤回最后一张未消除的牌。洗牌只改变棋盘，槽中的牌不会被移走。</p></div></li><li><span className="rule-number">4</span><div><h3>收获星星，也收获单词</h3><p>分级模式从小学到大学逐步增加词汇难度、每关词数和记忆强度。主题模式保留原有六关。每次通关都会单独记录用时，可在「通关足迹」查看和导出。每配对一组得 100 分；每次撤回、提示或洗牌扣 30 分。无辅助通关得 3 星，使用 1–2 次得 2 星，更多得 1 星。消除阶段不限时，星级不看速度。</p></div></li></ol><button className="primary-button full-width" onClick={() => setDialog(null)}>明白了，去试试<ArrowRight size={16} /></button></> : <><p className="help-text">当前棋盘和计时不会保留。已经完成的关卡、收藏和学习记录会保留。</p><div className="result-actions" style={{ marginTop: 24 }}><button className="secondary-button" onClick={() => setDialog(null)}>继续这一局</button><button className="primary-button" onClick={() => { setDialog(null); if ('speechSynthesis' in window) window.speechSynthesis.cancel(); pendingAction.current?.(); pendingAction.current = null; }}>离开并继续</button></div></>}</div></dialog>
  </div>;
}
