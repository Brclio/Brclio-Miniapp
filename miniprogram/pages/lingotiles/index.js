'use strict';
// Brclio · CC BY-NC-SA 4.0. Native mobile presentation of LingoTiles.
const model = require('../../lib/lingotiles');
const config = require('../../config');
const accountSync = require('../../lib/account-sync');
const PAGE_SIZE = 18;
const HISTORY_SIZE = 12;
const KIND_LABELS = { word: '单词', pos: '词性', meaning: '含义' };
const THEME_MARKS = ['01', '02', '03', '04', '05', '06'];
const MOTION_KEY = 'lingotiles.native.reduce-motion.v1';
const time = seconds => {
  const whole = Math.max(0, Math.floor(seconds || 0));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
};
const stars = count => '★'.repeat(Math.min(3, Math.max(0, count || 0))) + '☆'.repeat(3 - Math.min(3, Math.max(0, count || 0)));
const dateTime = value => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  // A fixed display timezone makes exports and the on-screen history unambiguous.
  return new Date(date.getTime() + 8 * 3600000).toISOString().replace('T', ' ').slice(0, 19);
};

Page({
  data: {
    view: 'game', phase: 'ready', mode: 'theme', selectedTheme: 0,
    level: null, themes: [], stages: [], stageOptions: [], stageId: 'primary', stageTitle: '小学基础',
    courseRound: 1, roundInput: '1', roundCount: 1, courseLoading: false, courseError: '',
    stageDescription: '', wordCount: 0, cardCount: 0, totalVocabulary: '100,000',
    memoryDuration: 60, memoryOptions: [30, 60, 90], remaining: 60, remainingText: '01:00',
    elapsedText: '00:00', studyText: '00:00', totalText: '00:00', streak: 0, seenCount: 0,
    memoryWords: [], tiles: [], tray: [{}, {}, {}, {}, {}, {}, {}], trayCount: 0, trayReadout: '',
    boardStyle: 'height:810rpx;', paused: false, matchAnimation: false, reduceMotion: false,
    sound: false, fusionWord: null, fusionDuration: 2180, toolsLeft: { undo: 3, hint: 2, shuffle: 2 },
    canUndo: false, matchCount: 0, score: 0, starsText: '★★★', won: false,
    harvestWords: [], harvestCount: 0, harvestExpanded: false, pendingIllustrations: 0,
    latestHarvest: null, coverage: null, rulesOpen: false, notice: '', storageAvailable: true,
    historySaveState: '', notebookFilter: 'all', notebookStage: 0, notebookQuery: '', notebookWords: [],
    notebookPage: 0, notebookPageNumber: 1, notebookPages: 1, notebookTotal: 0,
    notebookLoading: false, notebookError: '', notebookScan: 0, savedCount: 0,
    historyRecords: [], historyPage: 1, historyPages: 1, historyTotal: 0, historyLoading: false,
    historyError: '', historyLatest: '—', historyFastest: '—', historyPersisted: true,
    exporting: false, legacySessions: 0
  },

  update(value, callback) { if (!this.closed) this.setData(value, callback); },
  onLoad() {
    this.closed = false;
    this.progress = model.loadProgress();
    this._level = model.LEVELS[0];
    this._game = null;
    this._courseToken = 0;
    this._notebookToken = 0;
    this._historyToken = 0;
    this._clock = null;
    this._dialog = false;
    this._hints = [];
    this._assistCount = 0;
    this._studySeconds = 0;
    this._finishedSeconds = null;
    this._savedRun = false;
    let reduceMotion = false;
    try { reduceMotion = accountSync.storage.getStorageSync(MOTION_KEY) === true; } catch (_) { /* Session preferences remain usable. */ }
    this.update({ matchAnimation: model.loadMatchAnimation(), reduceMotion,
      stageOptions: ['所有阶段'].concat(model.STAGE_PROFILES.map(item => item.title)) });
    this.refreshProgress();
    this.prepareTheme(0);
    this.loadLibraryInfo();
    if (wx.showShareMenu) wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
  },
  onShow() {
    if (this.closed) return;
    this.tick();
    this.startTicker();
    this.keepAwake(this.data.phase === 'memory' || this.data.phase === 'playing');
  },
  onHide() {
    accountSync.onHide();
    clearInterval(this._ticker);
    this._ticker = null;
    this.stopAudio();
    this.keepAwake(false);
    // Finish a presentation before backgrounding; hidden time must not become a long animation pause.
    if (this.data.fusionWord) this.finishFusion();
  },
  onUnload() {
    this.closed = true;
    this._courseToken++;
    this._notebookToken++;
    this._historyToken++;
    clearInterval(this._ticker);
    clearTimeout(this._searchTimer);
    clearTimeout(this._fusionTimer);
    clearTimeout(this._noticeTimer);
    this.stopAudio();
    if (this._audio) this._audio.destroy();
    this.keepAwake(false);
    if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
  },
  onShareAppMessage() { return { title: '词了个词 · 玩一小局，记住一点新世界', path: '/pages/lingotiles/index' }; },
  onShareTimeline() { return { title: '词了个词 · 在悦学一起记单词' }; },
  noop() {},
  keepAwake(value) { if (wx.setKeepScreenOn) wx.setKeepScreenOn({ keepScreenOn: value, fail() {} }); },
  notify(notice) {
    if (this.closed) return;
    this.update({ notice });
    clearTimeout(this._noticeTimer);
    this._noticeTimer = setTimeout(() => this.update({ notice: '' }), 4800);
  },
  async loadLibraryInfo() {
    try {
      const manifest = await model.loadManifest();
      if (this.closed) return;
      this._manifest = manifest;
      this.update({ totalVocabulary: manifest.total.toLocaleString('en-US') });
      this.refreshStages();
    } catch (_) { /* Classic themes work offline; curriculum shows a retryable error when selected. */ }
    if (model.loadIllustrationManifest) {
      try {
        const coverage = await model.loadIllustrationManifest();
        this.update({ coverage: { ready: coverage.ready, total: coverage.total, pending: coverage.pending } });
      } catch (_) { /* Illustration counts are optional and never fabricated. */ }
    }
  },
  refreshProgress() {
    this.update({ seenCount: this.progress.seen.length, savedCount: this.progress.saved.length,
      streak: model.getCurrentStreak(this.progress),
      themes: model.LEVELS.map((level, index) => ({ index, title: level.title, subtitle: level.subtitle,
        count: level.words.length, mark: THEME_MARKS[index], stars: this.progress.completed[level.id] ? stars(this.progress.completed[level.id].stars) : '待探索' })) });
    this.refreshStages();
  },
  refreshStages() {
    const stages = model.STAGE_PROFILES.map((profile, index) => {
      const stage = this._manifest && this._manifest.stages.find(item => item.id === profile.id);
      return { id: profile.id, title: profile.title, short: profile.short, index: index + 1,
        wordCount: profile.wordCount, count: stage ? stage.count.toLocaleString('en-US') : '—' };
    });
    this.update({ stages });
  },
  persistProgress() {
    const available = model.saveProgress(this.progress);
    this.update({ storageAvailable: available });
    this.refreshProgress();
    if (!available) this.notify('学习进度暂时无法保存到本机。本次仍可练习，通关后请导出足迹。');
  },
  wordView(word) {
    const illustration = model.getWordIllustration(word);
    const profile = model.STAGE_PROFILES.find(item => item.id === word.stageId);
    return Object.assign({}, word, { image: illustration ? illustration.src : '', imageAlt: illustration ? illustration.alt : '',
      saved: this.progress.saved.includes(word.id), seen: this.progress.seen.includes(word.id),
      stageTitle: profile ? profile.title : '主题词汇', expanded: false });
  },
  showLevel(level, memoryDuration) {
    this._level = level;
    this.update({ level: { id: level.id, title: level.title, description: level.description, subtitle: level.subtitle },
      wordCount: level.words.length, cardCount: level.words.length * 3,
      memoryDuration, memoryOptions: this.data.mode === 'theme' ? [30, 60, 90] : [level.memorySeconds, level.memorySeconds + 30, level.memorySeconds + 60],
      memoryWords: level.words.map(word => this.wordView(word)), phase: 'ready', paused: false,
      harvestWords: [], harvestCount: 0, latestHarvest: null, harvestExpanded: false });
    const expected = level;
    Promise.resolve(model.loadWordIllustrations(level.words)).then(() => {
      if (this._level === expected) this.update({ memoryWords: level.words.map(word => this.wordView(word)) });
    }).catch(() => {});
    this.setUnloadWarning(false);
  },
  prepareTheme(index) {
    this._courseToken++;
    this.clearRound();
    const level = model.LEVELS[index];
    if (!level) return;
    this.update({ mode: 'theme', selectedTheme: index, courseLoading: false, courseError: '' });
    this.showLevel(level, level.memorySeconds > 60 ? 90 : 60);
  },
  async prepareCourse(stageId, round) {
    const token = ++this._courseToken;
    this.clearRound();
    const profile = model.stageProfile(stageId);
    this._level = null;
    this.update({ mode: 'curriculum', stageId, stageTitle: profile.title, stageDescription: profile.description,
      courseRound: round, roundInput: String(round), courseLoading: true, courseError: '', phase: 'ready', level: null });
    try {
      const [manifest, level] = await Promise.all([model.loadManifest(), model.loadCourseLevel(stageId, round)]);
      if (this.closed || token !== this._courseToken) return;
      this._manifest = manifest;
      this.update({ roundCount: level.roundCount, courseLoading: false });
      this.refreshStages();
      this.showLevel(level, level.memorySeconds);
    } catch (error) {
      if (token === this._courseToken) this.update({ courseLoading: false, courseError: error.message || '本关词汇暂时无法读取，请重试。' });
    }
  },
  clearRound() {
    clearTimeout(this._fusionTimer);
    this._game = null;
    this._clock = null;
    this._dialog = false;
    this.stopAudio();
    this.update({ fusionWord: null, paused: false, rulesOpen: false });
    this.keepAwake(false);
    this.setUnloadWarning(false);
  },
  chooseTheme(event) { this.guardNavigation(() => this.prepareTheme(Number(event.currentTarget.dataset.index))); },
  changeMode(event) {
    const mode = event.currentTarget.dataset.mode;
    if (mode === this.data.mode) return;
    this.guardNavigation(() => mode === 'curriculum' ? this.prepareCourse(this.data.stageId, this.data.courseRound) : this.prepareTheme(this.data.selectedTheme));
  },
  chooseStage(event) {
    const id = event.currentTarget.dataset.id;
    const stage = this._manifest && this._manifest.stages.find(item => item.id === id);
    let round = 1;
    if (stage) {
      const count = model.totalRounds(stage);
      for (let candidate = 1; candidate <= count; candidate++) {
        if (!this.progress.completed[model.courseLevelId(id, candidate)]) { round = candidate; break; }
      }
    }
    this.guardNavigation(() => this.prepareCourse(id, round));
  },
  roundInput(event) { this.update({ roundInput: event.detail.value }); },
  goRound(event) {
    const direction = Number(event.currentTarget.dataset.direction || 0);
    const round = direction ? this.data.courseRound + direction : Number(this.data.roundInput);
    if (!Number.isInteger(round) || round < 1 || round > this.data.roundCount) { this.notify(`请输入 1 到 ${this.data.roundCount} 之间的关卡编号。`); return; }
    this.guardNavigation(() => this.prepareCourse(this.data.stageId, round));
  },
  retryCourse() { this.prepareCourse(this.data.stageId, this.data.courseRound); },
  chooseDuration(event) { this.update({ memoryDuration: Number(event.currentTarget.dataset.seconds) }); },
  goView(event) {
    const view = typeof event === 'string' ? event : event.currentTarget.dataset.view;
    if (view === this.data.view) return;
    this.guardNavigation(() => {
      if (this.data.view === 'notebook') {
        this._notebookToken++;
        clearTimeout(this._searchTimer);
      }
      this.clearRound();
      this.update({ view, phase: 'ready' });
      if (view === 'notebook') this.loadNotebook();
      else if (view === 'history') this.loadHistory();
      else if (this._level) this.showLevel(this._level, this.data.memoryDuration);
    });
  },
  guardNavigation(action) {
    if (this._dialog) return;
    const running = this.data.phase === 'memory' || this.data.phase === 'playing' && this._game && this._game.status === 'playing';
    if (!running) { action(); return; }
    this._dialog = true;
    this.syncInterruption();
    this.stopAudio();
    wx.showModal({ title: '离开本次练习？', content: '本局进度将结束，已经保存的单词和通关足迹会保留。', confirmText: '离开练习', cancelText: '继续练习', confirmColor: '#2b7fd8',
      success: result => { if (this.closed) return; this._dialog = false; this.syncInterruption(); if (result.confirm) action(); },
      fail: () => { this._dialog = false; this.syncInterruption(); } });
  },
  setUnloadWarning(enabled) {
    if (enabled && wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: '离开会结束本次词汇练习。', fail() {} });
    else if (!enabled && wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload({ fail() {} });
  },
  newClock(elapsedSeconds = 0) { this._clock = { started: Date.now() - elapsedSeconds * 1000, pausedTotal: 0, interruptedAt: null }; },
  syncInterruption() {
    if (!this._clock) return;
    const interrupted = this.data.paused || this.data.rulesOpen || this._dialog || !!this.data.fusionWord;
    if (interrupted && this._clock.interruptedAt === null) this._clock.interruptedAt = Date.now();
    else if (!interrupted && this._clock.interruptedAt !== null) {
      this._clock.pausedTotal += Date.now() - this._clock.interruptedAt;
      this._clock.interruptedAt = null;
    }
  },
  clockSeconds() {
    if (!this._clock) return 0;
    const now = this._clock.interruptedAt === null ? Date.now() : this._clock.interruptedAt;
    return Math.max(0, (now - this._clock.started - this._clock.pausedTotal) / 1000);
  },
  startTicker() {
    clearInterval(this._ticker);
    this._ticker = setInterval(() => this.tick(), 250);
  },
  tick() {
    if (this.closed || !this._clock) return;
    if (this.data.phase === 'memory') {
      const remaining = Math.max(0, Math.ceil(this.data.memoryDuration - this.clockSeconds()));
      if (remaining !== this.data.remaining) this.update({ remaining, remainingText: time(remaining) });
      if (!remaining && !this.data.rulesOpen && !this._dialog && !this.data.paused) this.startPlaying();
    } else if (this.data.phase === 'playing') {
      const elapsedText = time(this._finishedSeconds === null ? this.clockSeconds() : this._finishedSeconds);
      if (elapsedText !== this.data.elapsedText) this.update({ elapsedText });
    }
  },
  startMemory() {
    if (!this._level || this.data.courseLoading) return;
    this.stopAudio();
    clearTimeout(this._fusionTimer);
    this._game = null;
    this._hints = [];
    this._assistCount = 0;
    this._finishedSeconds = null;
    this._savedRun = false;
    this._studySeconds = 0;
    this._runId = `native-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    this.newClock();
    this.update({ view: 'game', phase: 'memory', paused: false, fusionWord: null,
      remaining: this.data.memoryDuration, remainingText: time(this.data.memoryDuration), elapsedText: '00:00',
      historySaveState: '', toolsLeft: { undo: 3, hint: 2, shuffle: 2 }, matchCount: 0, score: 0,
      harvestWords: [], harvestCount: 0, latestHarvest: null, harvestExpanded: false, starsText: '★★★',
      memoryWords: this._level.words.map(word => this.wordView(word)) });
    this.startTicker();
    this.keepAwake(true);
    this.setUnloadWarning(true);
  },
  startPlaying() {
    if (this.data.phase !== 'memory' || this.data.rulesOpen || this.data.paused || this._dialog) return;
    this._studySeconds = Math.round(Math.min(this.data.memoryDuration, this.clockSeconds()) * 1000) / 1000;
    this.stopAudio();
    this._game = model.createGame(this._level.words, Date.now(), true);
    this.progress = model.markSeen(this.progress, this._level.words.map(word => word.id));
    this.persistProgress();
    this.newClock();
    this.update({ phase: 'playing', remaining: 0, elapsedText: '00:00', studyText: time(this._studySeconds), paused: false });
    this.renderGame();
    if (wx.pageScrollTo) wx.pageScrollTo({ scrollTop: 0, duration: this.data.reduceMotion ? 0 : 180 });
  },
  renderGame() {
    const game = this._game;
    if (!game) return;
    const tiles = game.tiles.map(tile => Object.assign({}, tile, {
      available: model.isTileAvailable(tile, game.tiles), hinted: this._hints.includes(tile.id),
      kindLabel: KIND_LABELS[tile.kind], long: tile.text.length > 10,
      ariaLabel: `${KIND_LABELS[tile.kind]}：${tile.text}${model.isTileAvailable(tile, game.tiles) ? '' : '，被上层遮挡'}`,
      style: `left:calc(${tile.x / game.boardWidth * 100}% + 5rpx);top:${tile.y / game.boardHeight * 100}%;width:calc(${100 / game.boardWidth}% - 10rpx);height:calc(${100 / game.boardHeight}% - 16rpx);z-index:${tile.layer + 1};`
    }));
    const visibleMatches = game.matchedWordIds.filter(id => !this.data.fusionWord || id !== this.data.fusionWord.id);
    const harvestWords = visibleMatches.map(id => this.wordView(this._level.words.find(word => word.id === id))).filter(Boolean);
    const score = Math.max(0, game.matchedWordIds.length * 100 - this._assistCount * 30);
    const rating = this._assistCount === 0 ? 3 : this._assistCount <= 2 ? 2 : 1;
    const tray = Array.from({ length: 7 }, (_, index) => game.tray[index] ? Object.assign({}, game.tray[index], { kindLabel: KIND_LABELS[game.tray[index].kind] }) : { empty: true });
    this.update({ tiles, boardStyle: `height:${(648 * game.boardHeight / game.boardWidth).toFixed(1)}rpx;`,
      tray, trayCount: game.tray.length, trayReadout: game.tray.map(tile => tile.text).join(' · '),
      matchCount: game.matchedWordIds.length, score, starsText: stars(rating),
      canUndo: !!game.undo && this.data.toolsLeft.undo > 0, harvestWords, harvestCount: harvestWords.length,
      latestHarvest: harvestWords.length ? harvestWords[harvestWords.length - 1] : null,
      pendingIllustrations: model.getMissingIllustrations().length });
  },
  pickTile(event) {
    if (!this._game || this.data.phase !== 'playing' || this.data.paused || this.data.rulesOpen || this._dialog || this.data.fusionWord) return;
    const id = event.currentTarget.dataset.id;
    const next = model.selectTile(this._game, id);
    if (next === this._game) return;
    this._game = next;
    this._hints = this._hints.filter(value => value !== id);
    if (next.status !== 'playing') {
      this._finishedSeconds = Math.round(this.clockSeconds() * 1000) / 1000;
      this._finishedAt = new Date().toISOString();
    }
    if (next.lastMatch) {
      const word = this._level.words.find(item => item.id === next.lastMatch);
      if (word) {
        if (!model.recordIllustrationPractice(word) && !this._illustrationWarning) {
          this._illustrationWarning = true;
          this.notify('待配图词单目前仅临时保存，可在本关收获中导出备份。');
        }
        if (this.data.sound) this.playWord(word.word);
        if (this.data.matchAnimation) {
          const illustrated = model.getWordIllustration(word);
          const duration = this.data.reduceMotion ? 1700 : illustrated ? 2700 : 2180;
          this.update({ fusionWord: this.wordView(word), fusionDuration: duration });
          this.syncInterruption();
          clearTimeout(this._fusionTimer);
          this._fusionTimer = setTimeout(() => this.finishFusion(), duration);
        }
      }
    }
    this.renderGame();
    if (next.status === 'won') this.saveCompletion();
    if (next.status !== 'playing' && !this.data.fusionWord) this.showResult();
  },
  finishFusion() {
    clearTimeout(this._fusionTimer);
    this.update({ fusionWord: null });
    this.syncInterruption();
    this.renderGame();
    if (this._game && this._game.status !== 'playing') this.showResult();
  },
  showResult() {
    if (!this._game) return;
    this.update({ phase: 'result', won: this._game.status === 'won', elapsedText: time(this._finishedSeconds),
      studyText: time(this._studySeconds), totalText: time(this._studySeconds + this._finishedSeconds), paused: false });
    this.keepAwake(false);
    this.setUnloadWarning(false);
  },
  async saveCompletion() {
    if (this._savedRun) return;
    this._savedRun = true;
    const rating = this._assistCount === 0 ? 3 : this._assistCount <= 2 ? 2 : 1;
    const score = Math.max(0, this._game.matchedWordIds.length * 100 - this._assistCount * 30);
    const id = this._runId;
    const level = this._level;
    const mode = this.data.mode;
    const record = { id, levelId: level.id, levelTitle: level.title, mode,
      wordCount: level.words.length, gameSeconds: this._finishedSeconds, studySeconds: this._studySeconds,
      totalSeconds: Math.round((this._finishedSeconds + this._studySeconds) * 1000) / 1000,
      stars: rating, score, assists: this._assistCount, completedAt: this._finishedAt };
    if (mode === 'curriculum') Object.assign(record, { stageId: level.stageId, stageTitle: level.stageTitle, round: level.round });
    this.progress = model.recordResult(this.progress, { id, levelId: level.id, stars: rating, score,
      timeSeconds: Math.floor(this._finishedSeconds), wordIds: level.words.map(word => word.id) });
    this.persistProgress();
    this.update({ historySaveState: '正在保存本次通关…' });
    try {
      const result = await model.appendCompletion(record);
      if (this._runId === id) this.update({ historySaveState: result.persisted ? '本次通关已保存在本机' : '本次通关暂时保存在本页，请导出足迹备份' });
      if (!result.persisted) this.notify(result.error || '本次通关仅临时保存，请到通关足迹导出备份。');
    } catch (_) {
      if (this._runId === id) this.update({ historySaveState: '通关记录未能保存，请到通关足迹查看并导出备份' });
    }
  },
  useTool(event) {
    const tool = event.currentTarget.dataset.tool;
    const game = this._game;
    if (!game || this.data.paused || this.data.rulesOpen || this._dialog || this.data.fusionWord || game.status === 'won' || !this.data.toolsLeft[tool]) return;
    if (this.data.phase === 'result' && tool !== 'undo') return;
    if (tool === 'hint') {
      const ids = model.getHint(game);
      if (!ids.length) { this.notify('暂时找不到安全的配对。可以试试撤回或洗牌，本次不消耗提示。'); return; }
      this._hints = ids;
      const labels = ids.map(id => game.tiles.find(tile => tile.id === id)).filter(Boolean).map(tile => `${KIND_LABELS[tile.kind]}「${tile.text}」`).join('、');
      this.notify(`可以选择${labels}，已在棋盘上标出。`);
    } else if (tool === 'undo') {
      const next = model.undoMove(game);
      if (next === game) { this.notify('上一组配对已经完成，暂时没有可以撤回的牌。'); return; }
      this._game = next;
      this._hints = [];
      if (this.data.phase === 'result') {
        this.newClock(this._finishedSeconds || 0);
        this._finishedSeconds = null;
        this.update({ phase: 'playing', paused: false });
        this.keepAwake(true);
        this.setUnloadWarning(true);
      }
      this.notify('最后一张牌已放回，已完成的配对会保留。');
    } else if (tool === 'shuffle') {
      const next = model.shuffleBoard(game);
      if (next === game) return;
      if (!next.solution.length) { this.notify('本次洗牌无法恢复安全路线。请先撤回或重新记忆，本次不消耗道具。'); return; }
      this._game = next;
      this._hints = [];
      this.notify('棋盘已重新排列，暂存槽里的牌保持原样。');
    } else return;
    this._assistCount++;
    this.update({ toolsLeft: Object.assign({}, this.data.toolsLeft, { [tool]: this.data.toolsLeft[tool] - 1 }) });
    this.renderGame();
  },
  togglePause() {
    if (this.data.phase !== 'memory' && this.data.phase !== 'playing') return;
    this.update({ paused: !this.data.paused });
    this.syncInterruption();
    this.stopAudio();
    this.tick();
  },
  toggleAnimation(event) {
    const enabled = event && event.detail ? event.detail.value : !this.data.matchAnimation;
    this.update({ matchAnimation: enabled });
    if (!model.saveMatchAnimation(enabled)) this.notify('合成设置本次已生效，但未能保存到本机。');
    if (!enabled && this.data.fusionWord) this.finishFusion();
  },
  toggleReducedMotion(event) {
    this.update({ reduceMotion: event.detail.value });
    try { accountSync.storage.setStorageSync(MOTION_KEY, event.detail.value); } catch (_) { this.notify('减少动效设置仅在本次生效。'); }
  },
  toggleSound(event) {
    const enabled = event && event.detail ? event.detail.value : !this.data.sound;
    this.update({ sound: enabled });
    if (!enabled) this.stopAudio();
  },
  showRules() { this.update({ rulesOpen: true }); this.syncInterruption(); this.stopAudio(); },
  closeRules() { this.update({ rulesOpen: false }); this.syncInterruption(); this.tick(); },
  restart() { this.guardNavigation(() => this.startMemory()); },
  backToSelection() {
    this.guardNavigation(() => { this.clearRound(); if (this._level) this.showLevel(this._level, this.data.memoryDuration); });
  },
  nextChallenge() {
    if (this.data.mode === 'theme') {
      if (this.data.selectedTheme + 1 < model.LEVELS.length) this.prepareTheme(this.data.selectedTheme + 1);
      else this.goView('notebook');
    } else if (this._level) {
      if (this.data.courseRound < this._level.roundCount) this.prepareCourse(this.data.stageId, this.data.courseRound + 1);
      else {
        const next = model.STAGE_PROFILES.findIndex(stage => stage.id === this.data.stageId) + 1;
        if (next < model.STAGE_PROFILES.length) this.prepareCourse(model.STAGE_PROFILES[next].id, 1);
        else this.goView('notebook');
      }
    }
  },
  stopAudio() { if (this._audio) { this._audioActive = false; this._audio.stop(); } },
  speak(event) { this.playWord(event.currentTarget.dataset.word); },
  playWord(word) {
    if (typeof word !== 'string' || !word.trim()) return;
    if (!wx.createInnerAudioContext) { this.notify('当前环境暂不支持音频播放，可以参考单词音标。'); return; }
    if (!this._audio) {
      this._audio = wx.createInnerAudioContext();
      this._audio.obeyMuteSwitch = false;
      this._audio.onError(() => { if (this._audioActive) this.notify('暂时无法播放发音，请检查网络，或参考单词音标。'); this._audioActive = false; });
      if (this._audio.onEnded) this._audio.onEnded(() => { this._audioActive = false; });
    }
    this.stopAudio();
    this._audioActive = true;
    this._audio.src = `${config.webOrigin.replace(/\/$/, '')}/api/lingotiles/pronounce?word=${encodeURIComponent(word)}`;
    this._audio.play();
  },
  toggleSave(event) {
    const id = event.currentTarget.dataset.id;
    this.progress = model.toggleSaved(this.progress, id);
    this.persistProgress();
    this.update({ memoryWords: this.data.memoryWords.map(word => Object.assign({}, word, { saved: this.progress.saved.includes(word.id) })),
      notebookWords: this.data.notebookWords.map(word => Object.assign({}, word, { saved: this.progress.saved.includes(word.id) })) });
    this.renderGame();
    if (this.data.view === 'notebook' && this.data.notebookFilter === 'saved') this.loadNotebook();
  },
  toggleDefinition(event) {
    const id = event.currentTarget.dataset.id;
    this.update({ notebookWords: this.data.notebookWords.map(word => word.id === id ? Object.assign({}, word, { expanded: !word.expanded }) : word) });
  },
  toggleHarvest() { this.update({ harvestExpanded: !this.data.harvestExpanded }); },
  imageError(event) {
    const id = event.currentTarget.dataset.id;
    ['memoryWords', 'notebookWords', 'harvestWords'].forEach(field => {
      this.update({ [field]: this.data[field].map(word => word.id === id ? Object.assign({}, word, { image: '' }) : word) });
    });
    if (this.data.fusionWord && this.data.fusionWord.id === id) this.update({ fusionWord: Object.assign({}, this.data.fusionWord, { image: '' }) });
  },
  notebookFilter(event) { this.update({ notebookFilter: event.currentTarget.dataset.filter, notebookPage: 0 }); this.loadNotebook(); },
  notebookStage(event) { this.update({ notebookStage: Number(event.detail.value), notebookPage: 0 }); this.loadNotebook(); },
  notebookSearch(event) {
    this._notebookToken++;
    this.update({ notebookQuery: event.detail.value, notebookPage: 0 });
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.loadNotebook(), 350);
  },
  searchNow() { clearTimeout(this._searchTimer); this.loadNotebook(); },
  notebookPage(event) {
    const page = this.data.notebookPage + Number(event.currentTarget.dataset.direction);
    if (page < 0 || page >= this.data.notebookPages || this.data.notebookLoading) return;
    this.update({ notebookPage: page });
    this.loadNotebook();
    if (wx.pageScrollTo) wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  async loadNotebook() {
    const token = ++this._notebookToken;
    this.update({ notebookLoading: true, notebookError: '', notebookScan: 0 });
    const stage = this.data.notebookStage ? model.STAGE_PROFILES[this.data.notebookStage - 1].id : undefined;
    const query = this.data.notebookQuery.trim();
    const filter = this.data.notebookFilter;
    const page = this.data.notebookPage;
    try {
      let result;
      if (query || filter !== 'all' && stage) {
        result = await model.searchVocabulary(query, { page, pageSize: PAGE_SIZE, stageId: stage,
          allowedIds: filter === 'all' ? undefined : this.progress[filter],
          signal: { throwIfAborted: () => { if (this.closed || token !== this._notebookToken) throw new Error('检索已取消'); } },
          onProgress: (done, count) => { if (token === this._notebookToken) this.update({ notebookScan: Math.round(done / Math.max(1, count) * 100) }); } });
      } else if (filter !== 'all') {
        const ids = this.progress[filter];
        result = { words: await model.wordsByIds(ids.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)), total: ids.length };
      } else result = await model.readVocabularyPage({ page, pageSize: PAGE_SIZE, stageId: stage });
      if (this.closed || token !== this._notebookToken) return;
      const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
      if (page >= pages) { this.update({ notebookPage: pages - 1 }); this.loadNotebook(); return; }
      this.update({ notebookWords: result.words.map(word => this.wordView(word)), notebookTotal: result.total,
        notebookPages: pages, notebookPageNumber: page + 1, notebookLoading: false });
      await model.loadWordIllustrations(result.words);
      if (token === this._notebookToken) this.update({ notebookWords: result.words.map(word => this.wordView(word)) });
    } catch (error) {
      if (token === this._notebookToken) this.update({ notebookLoading: false, notebookError: error.message || '词库暂时无法读取，请重试。' });
    }
  },
  async loadHistory() {
    const token = ++this._historyToken;
    this.update({ historyLoading: true, historyError: '' });
    try {
      const [page, summary] = await Promise.all([model.getCompletionPage({ page: this.data.historyPage, pageSize: HISTORY_SIZE }), model.getCompletionSummary()]);
      if (this.closed || token !== this._historyToken) return;
      this.update({ historyRecords: page.records.map(record => Object.assign({}, record, {
        dateLabel: dateTime(record.completedAt), gameTime: time(record.gameSeconds), studyTime: time(record.studySeconds),
        totalTime: time(record.totalSeconds), starsLabel: stars(record.stars), modeLabel: record.mode === 'theme' ? '经典主题' : `${record.stageTitle || '分级课程'} · 第 ${record.round} 关`
      })), historyTotal: page.total, historyPages: Math.max(1, Math.ceil(page.total / HISTORY_SIZE)),
      historyLatest: summary.latest ? time(summary.latest.gameSeconds) : '—', historyFastest: summary.fastest ? time(summary.fastest.gameSeconds) : '—',
      historyPersisted: page.persisted !== false && summary.persisted !== false,
      historyError: page.error || summary.error || '', historyLoading: false, legacySessions: Math.max(0, this.progress.sessions - summary.total) });
    } catch (error) {
      if (token === this._historyToken) this.update({ historyLoading: false, historyError: error.message || '通关足迹暂时无法读取，请重试。' });
    }
  },
  historyPage(event) {
    const page = this.data.historyPage + Number(event.currentTarget.dataset.direction);
    if (page < 1 || page > this.data.historyPages || this.data.historyLoading) return;
    this.update({ historyPage: page }); this.loadHistory();
    if (wx.pageScrollTo) wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  async shareFile(filePath, fileName) {
    if (!wx.shareFileMessage) { this.notify('当前微信版本无法分享文件，请升级微信后再次导出。'); return; }
    await new Promise((resolve, reject) => wx.shareFileMessage({ filePath, fileName, success: resolve,
      fail: error => /cancel/.test(error.errMsg || '') ? resolve() : reject(new Error('文件已生成，但未能打开分享。请重试。')) }));
  },
  async exportHistory() {
    if (this.data.exporting) return;
    this.update({ exporting: true });
    try {
      const result = await model.exportCsvFile();
      if (!this.closed) await this.shareFile(result.filePath, `LingoTiles-通关足迹-${new Date().toISOString().slice(0, 10)}.csv`);
      if (!result.persisted) this.notify(result.error || '已导出，包含本页临时保存的通关记录。');
    } catch (error) { this.notify(error.message || '导出未完成，请重试。'); }
    finally { this.update({ exporting: false }); }
  },
  async exportMissing() {
    if (this.data.exporting) return;
    this.update({ exporting: true });
    try {
      const result = await model.exportMissingIllustrationsFile();
      if (!this.closed) await this.shareFile(typeof result === 'string' ? result : result.filePath, 'LingoTiles-待配图词单.json');
    } catch (error) { this.notify(error.message || '词单未能导出，请重试。'); }
    finally { this.update({ exporting: false }); }
  }
});
