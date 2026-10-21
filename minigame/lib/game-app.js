'use strict';

const { createDuel } = require('./duel-engine');
const { createDuelAudio } = require('./duel-audio');
const storage = require('./storage');
const catalog = require('../data/catalog');

// Canvas layout adapts the Brclio app template's warm paper, typography,
// header, feature card, and primary controls to a native game runtime.
const C = { cream: '#fefcf6', ink: '#1a1a2e', muted: '#64646e', blue: '#2b7fd8', red: '#e84a5f', yellow: '#f4d758', paper: '#f7efd1', line: '#e5dfd1', soft: '#f2eee3', blueSoft: '#e9f1f9', redSoft: '#fbeaed' };
const FONT = "'PingFang SC', 'Noto Sans SC', sans-serif";
const SERIF = "'Songti SC', 'Noto Serif SC', serif";

function createGameApp(platform, options) {
  const wx = platform;
  const opt = options || {};
  const requestFrame = typeof wx.requestAnimationFrame === 'function' ? wx.requestAnimationFrame.bind(wx) : typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;
  const cancelFrame = typeof wx.cancelAnimationFrame === 'function' ? wx.cancelAnimationFrame.bind(wx) : typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : null;
  const canvas = wx.createCanvas();
  const ctx = canvas.getContext('2d');
  const performance = typeof wx.getPerformance === 'function' ? wx.getPerformance() : null;
  // WeChat Performance.now() is microseconds; the engine and timers use ms.
  const now = performance && typeof performance.now === 'function' ? function () { return performance.now() / 1000; } : Date.now;
  let prefs = storage.read();
  const audio = createDuelAudio(wx, { enabled: prefs.soundEnabled, assetBase: opt.audioAssetBase });
  let engine = createDuel({ targetScore: prefs.targetScore, now });
  let screen = 'home';
  let controls = [];
  let width, height, scale, offsetX, offsetY;
  let timer = null;
  let frameId = null;
  let hidden = false;
  let disposed = false;
  let signaling = false;
  let message = '';
  let toast = '';
  let toastTimer = null;
  let sessionId = '';
  let savedSession = '';
  let avatar = null;
  const names = function () { return prefs.names; };

  function rounded(x, y, w, h, r, fill, stroke) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }

  function text(value, x, y, size, color, weight, align, serif) {
    ctx.fillStyle = color || C.ink;
    ctx.font = (weight || 400) + ' ' + size + 'px ' + (serif ? SERIF : FONT);
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value), x, y);
  }

  function line(x1, y1, x2, y2, color) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.lineWidth = 1; ctx.strokeStyle = color || C.line; ctx.stroke();
  }

  function circle(x, y, radius, fill) {
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
  }

  function hand(cx, cy, size, color, rotate) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rotate || 0); ctx.scale(size / 80, size / 80);
    rounded(-23, -3, 47, 43, 18, color);
    rounded(-24, -37, 11, 47, 6, color);
    rounded(-11, -48, 11, 54, 6, color);
    rounded(2, -45, 11, 51, 6, color);
    rounded(15, -34, 10, 43, 5, color);
    ctx.save(); ctx.translate(-23, 6); ctx.rotate(-.6); rounded(-7, -19, 14, 35, 7, color); ctx.restore();
    ctx.restore();
  }

  function button(x, y, w, h, label, action, options) {
    const opt = options || {};
    rounded(x, y, w, h, opt.radius || 12, opt.fill || C.blue, opt.stroke);
    text(label, opt.left ? x + 18 : x + w / 2, y + h / 2, opt.size || 16, opt.color || C.cream, 600, opt.left ? 'left' : 'center');
    if (opt.arrow) text('↗', x + w - 26, y + h / 2, 25, opt.color || C.cream, 400, 'center');
    if (action) controls.push({ x, y, w, h, action });
  }

  function notify(value) {
    if (disposed) return;
    toast = value;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast = ''; draw(); }, 2200);
    draw();
  }

  function persist(patch) {
    const success = storage.save(patch);
    prefs = Object.assign({}, prefs, patch);
    if (!success) notify('本机存储空间不足，本次设置未保存');
    return success;
  }

  function resize() {
    if (disposed) return;
    const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
    width = info.windowWidth; height = info.windowHeight;
    const dpr = Math.min(info.pixelRatio || 2, 3);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    const safe = info.safeArea || { top: 0, bottom: height };
    let top = safe.top || 0;
    if (typeof wx.getMenuButtonBoundingClientRect === 'function') {
      const menu = wx.getMenuButtonBoundingClientRect();
      if (menu && menu.bottom > 0) top = Math.max(top, menu.bottom + 4);
    }
    const bottom = Math.max(0, height - (safe.bottom || height));
    scale = Math.min(width / 390, Math.max(200, height - top - bottom) / 740);
    offsetX = (width - 390 * scale) / 2;
    offsetY = top + Math.max(0, (height - top - bottom - 740 * scale) / 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function header(title, subtitle) {
    button(24, 12, 40, 40, '‹', leaveScreen, { fill: C.soft, color: C.ink, radius: 20, size: 30 });
    text(title, 78, 25, 18, C.ink, 700, 'left', true);
    text(subtitle, 78, 45, 9, C.muted);
  }

  function footer() { text('MADE FOR LITTLE MOMENTS · Brclio', 195, 718, 9, C.muted, 500, 'center'); }

  function home() {
    if (avatar && avatar.width) {
      ctx.save(); ctx.beginPath(); ctx.arc(45, 32, 21, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(avatar, 24, 11, 42, 42); ctx.restore();
    } else { circle(45, 32, 21, C.blue); text('B', 45, 32, 24, C.cream, 700, 'center', true); }
    text('Brclio 悦创', 78, 24, 19, C.ink, 800);
    text('随手打开，发现一点有趣。', 78, 45, 10, C.muted);
    button(306, 16, 60, 32, '关于 ↗', function () { screen = 'about'; draw(); }, { fill: C.cream, color: C.muted, stroke: C.line, size: 11, radius: 16 });
    text('THE BRCLIO COLLECTION', 24, 91, 10, C.blue, 700);
    text('把有趣，', 24, 133, 38, C.ink, 800, 'left', true);
    text('带进生活。', 24, 181, 38, C.blue, 800, 'left', true);
    text('随手打开，发现一点有趣。', 25, 224, 13, C.muted);
    text('✳', 25, 259, 20, C.blue);
    text('今天，从双人反应挑战开始。', 51, 259, 12, C.ink);
    text('今日推荐', 24, 300, 18, C.ink, 700, 'left', true);
    text('NO. 001', 366, 300, 10, C.muted, 500, 'right');
    rounded(24, 325, 342, 263, 18, C.paper);
    rounded(42, 342, 62, 22, 5, C.cream); text(catalog[0].players, 73, 353, 10, C.blue, 600, 'center');
    text(catalog[0].duration, 348, 353, 10, C.muted, 400, 'right');
    circle(132, 420, 39, C.red); hand(132, 421, 51, C.cream, -.2);
    text('vs.', 195, 422, 25, C.ink, 600, 'center', true);
    circle(258, 420, 39, C.blue); hand(258, 421, 51, C.cream, .2);
    text('✦', 306, 391, 18, C.blue); text('+', 75, 448, 22, C.red);
    text('READY / GO / DUEL', 42, 477, 9, C.muted, 600);
    text(catalog[0].title, 42, 508, 29, C.ink, 800, 'left', true); text('！', 160, 508, 30, C.red, 800);
    button(42, 534, 306, 44, '来一场对决', enterDuel, { size: 14, left: true, arrow: true, radius: 8 });
    const matches = storage.read().matches;
    const times = matches.map(function (match) { return match.bestMs; }).filter(function (ms) { return typeof ms === 'number'; });
    text('01', 81, 630, 27, C.blue, 700, 'center', true);
    text(matches.length, 195, 630, 27, C.blue, 700, 'center', true);
    text(times.length ? Math.min.apply(null, times) : '—', 309, 630, 27, C.blue, 700, 'center', true);
    text('个功能', 81, 657, 10, C.muted, 400, 'center');
    text('场本机对决', 195, 657, 10, C.muted, 400, 'center');
    text('本机最佳 / ms', 309, 657, 10, C.muted, 400, 'center');
    line(138, 617, 138, 662); line(252, 617, 252, 662);
    footer();
  }

  function enterDuel() {
    prefs = storage.read();
    engine = createDuel({ targetScore: prefs.targetScore, now });
    sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    savedSession = ''; message = ''; screen = 'duel';
    if (typeof wx.setKeepScreenOn === 'function') wx.setKeepScreenOn({ keepScreenOn: true });
    draw();
  }

  function duel() {
    const s = engine.snapshot();
    const active = s.phase === 'waiting' || s.phase === 'go' || s.phase === 'judging';
    header('举手决斗', 'READY GO DUEL · 同屏反应挑战');
    button(254, 14, 48, 34, prefs.soundEnabled ? '声音 ●' : '声音 ○', toggleSound, { fill: C.soft, color: C.muted, size: 10, radius: 17 });
    button(310, 14, 56, 34, '玩法', showRules, { fill: C.soft, color: C.muted, size: 12, radius: 17 });
    rounded(24, 85, 342, 92, 16, C.soft);
    text(names()[0], 85, 109, 13, C.red, 600, 'center');
    text(names()[1], 305, 109, 13, C.blue, 600, 'center');
    text(s.scores.p1, 85, 143, 34, C.red, 700, 'center', true);
    text(s.scores.p2, 305, 143, 34, C.blue, 700, 'center', true);
    text('先得 ' + s.targetScore + ' 分', 195, 113, 11, C.muted, 500, 'center');
    text('第 ' + s.roundNumber + ' 回合', 195, 144, 12, C.ink, 600, 'center');

    let title = '准备好了吗？';
    let caption = '两人各守一边，看到 GO 再点下。';
    let big = '', color = C.ink;
    if (signaling || s.phase === 'go' || s.phase === 'judging') {
      title = '就是现在！'; big = 'GO!'; caption = '快点下自己的手掌'; color = C.blue;
    } else if (s.phase === 'waiting') {
      title = '稳住，先别点'; big = 'Ready…'; caption = 'GO 随时出现 · 抢跑会送对方 1 分';
    } else if (s.phase === 'result' || s.phase === 'complete') {
      const r = s.result;
      if (r.reason === 'false-start') { title = names()[r.loser === 'p1' ? 0 : 1] + '抢跑了'; big = '抢跑！'; caption = names()[r.winner === 'p1' ? 0 : 1] + ' +1 分 · 等 GO 出现再点哦'; color = C.red; }
      else if (r.reason === 'tie') { title = '默契得不分上下'; big = '平局'; caption = '两人相差不足 35 ms，本回合不计分'; }
      else if (r.reason === 'timeout') { title = '这回合先歇一下'; big = '平局'; caption = '5 秒内无人点下，本回合不计分'; }
      else { title = names()[r.winner === 'p1' ? 0 : 1] + '快人一步'; big = r.reactionMs + ' ms'; caption = names()[r.winner === 'p1' ? 0 : 1] + ' +1 分 · 好反应！'; color = r.winner === 'p1' ? C.red : C.blue; }
      if (s.phase === 'complete') title = names()[s.matchWinner === 'p1' ? 0 : 1] + '赢下整场！';
    }
    text(title, 195, 211, 19, color, 700, 'center', true);
    if (big) text(big, 195, 271, big.length > 7 ? 45 : 55, color, 800, 'center', true);
    else {
      text('READY', 195, 264, 44, C.blue, 700, 'center', true);
      line(146, 296, 244, 296, C.yellow);
    }
    text(caption, 195, 322, 11, C.muted, 400, 'center');

    ['p1', 'p2'].forEach(function (player, i) {
      const x = i === 0 ? 24 : 203;
      const pc = i === 0 ? C.red : C.blue;
      const resultWinner = s.result && s.result.winner === player;
      rounded(x, 359, 163, 229, 20, resultWinner ? pc : i === 0 ? C.redSoft : C.blueSoft);
      text(names()[i], x + 81.5, 388, 15, resultWinner ? C.cream : pc, 700, 'center');
      circle(x + 81.5, 462, 46, resultWinner ? C.cream : pc);
      hand(x + 81.5, 465, 61, resultWinner ? pc : C.cream, i === 0 ? -.1 : .1);
      text(active ? '点这里' : '你的区域', x + 81.5, 537, 14, resultWinner ? C.cream : pc, 600, 'center');
      const best = s.bestTimes[player];
      text(best === null ? '等待你的好反应' : '本场最快 ' + best + ' ms', x + 81.5, 565, 10, resultWinner ? C.cream : C.muted, 400, 'center');
      controls.push({ x, y: 359, w: 163, h: 229, action: function () { press(player); }, player });
    });

    if (s.phase === 'ready') {
      if (!s.roundsPlayed) {
        text('赛制', 25, 615, 11, C.muted);
        [1, 3, 5].forEach(function (score, i) {
          button(76 + i * 97, 599, 90, 32, score === 1 ? '一局定胜负' : '先得 ' + score + ' 分', function () { engine.resetMatch(score); persist({ targetScore: score }); draw(); }, { fill: s.targetScore === score ? C.yellow : C.soft, color: C.ink, size: 11, radius: 8 });
        });
      } else text(message || '本回合已暂停，比分保留。', 195, 616, 11, C.muted, 400, 'center');
      button(24, 647, 342, 46, s.roundsPlayed ? '重新开始本回合' : '准备好了，开始', startRound);
    } else if (active) {
      text('随机等待 2–6 秒 · 不要预判', 195, 624, 12, C.muted, 400, 'center');
      button(126, 653, 138, 36, '暂停这一回合', pauseRound, { fill: C.soft, color: C.muted, size: 12 });
    } else {
      text(s.phase === 'complete' ? '本场比分  ' + s.scores.p1 + ' : ' + s.scores.p2 : '再来一回合，胜负还没定。', 195, 617, 12, C.muted, 400, 'center');
      button(24, 647, 342, 46, s.phase === 'complete' ? '再比一场' : '下一回合', s.phase === 'complete' ? rematch : startRound);
    }
    text('计时受设备和触控延迟影响，成绩仅供娱乐。', 195, 722, 9, C.muted, 400, 'center');
  }

  function showRules() {
    if (screen === 'duel') pauseRound();
    wx.showModal({ title: '举手决斗 · 怎么玩', content: '1. 两人各守红、蓝一边，点开始。\n2. 随机等待 2–6 秒，看到 GO 才能点手掌。\n3. 抢跑则对方得 1 分；反应快的一方得 1 分。\n4. 两次触摸相差不足 35 ms 算平局；5 秒无人响应也算平局。\n5. 先达到目标分数的一方获胜。切后台或暂停会取消当前回合，保留比分。', showCancel: false, confirmText: '明白了' });
  }

  function about() {
    header('关于悦创', 'ABOUT THE COLLECTION');
    text('两个人，一部手机。', 24, 111, 26, C.ink, 800, 'left', true);
    text('不用复杂的准备，好玩现在开始。', 24, 152, 13, C.muted);
    rounded(24, 187, 342, 87, 14, C.paper);
    text('首个功能：举手决斗', 42, 212, 16, C.ink, 700);
    text('源自 ReadyGoDuel，由 Brclio 原生适配。', 42, 243, 11, C.muted);
    button(24, 299, 342, 48, '玩法说明', showRules, { fill: C.soft, color: C.ink, left: true, arrow: true });
    button(24, 359, 342, 48, '本机战绩', function () { screen = 'history'; draw(); }, { fill: C.soft, color: C.ink, left: true, arrow: true });
    button(24, 419, 342, 48, '触感反馈', function () { persist({ haptics: !prefs.haptics }); if (prefs.haptics) vibrate(); draw(); }, { fill: C.soft, color: C.ink, left: true });
    text(prefs.haptics ? '已开启 ●' : '已关闭 ○', 344, 443, 12, C.blue, 600, 'right');
    button(24, 479, 342, 48, '隐私与数据', function () { screen = 'privacy'; draw(); }, { fill: C.soft, color: C.ink, left: true, arrow: true });
    button(24, 539, 342, 48, '原作与来源', function () { wx.setClipboardData({ data: 'https://github.com/AndersonHJB/ReadyGoDuel', success: function () { notify('原作链接已复制'); } }); }, { fill: C.soft, color: C.ink, left: true, arrow: true });
    button(24, 599, 342, 26, prefs.soundEnabled ? '游戏音效 · 已开启' : '游戏音效 · 已关闭', toggleSound, { fill: C.soft, color: C.muted, size: 11 });
    text('Brclio · 写代码，教编程，做产品', 24, 632, 12, C.muted);
    text('举手决斗  v0.1.0', 24, 659, 11, C.muted);
    footer();
  }

  function history() {
    header('本机战绩', 'LITTLE WINS, GOOD TIMES');
    const matches = storage.read().matches;
    text(matches.length ? '每一次快人一步。' : '第一场，等你开局。', 24, 113, 25, C.ink, 700, 'left', true);
    text('本机保留最近 20 场完整对决，展示最近 5 场。', 24, 153, 11, C.muted);
    if (!matches.length) {
      circle(195, 325, 70, C.paper); hand(195, 330, 82, C.blue, -.1);
      text('拉上朋友，去创造第一个好成绩。', 195, 436, 13, C.muted, 400, 'center');
    }
    matches.slice(0, 5).forEach(function (match, i) {
      const y = 192 + i * 85;
      const at = new Date(match.at);
      rounded(24, y, 342, 72, 12, i === 0 ? C.paper : C.soft);
      text(match.names[match.winner] + '获胜', 42, y + 23, 14, match.winner === 0 ? C.red : C.blue, 600);
      text((at.getMonth() + 1) + '/' + at.getDate() + '  ' + match.scores.join(' : '), 42, y + 49, 11, C.muted);
      text(match.bestMs === null ? '抢跑决胜' : match.bestMs + ' ms', 348, y + 32, 21, C.blue, 700, 'right', true);
    });
    button(24, 647, 342, 46, matches.length ? '清除本机战绩' : '来一场对决', matches.length ? clearRecords : enterDuel, { fill: matches.length ? C.soft : C.blue, color: matches.length ? C.muted : C.cream });
    footer();
  }

  function privacy() {
    header('隐私与数据', 'YOUR DEVICE, YOUR LITTLE MOMENTS');
    text('好玩，轻一点。', 24, 116, 30, C.ink, 800, 'left', true);
    const cloudBackup = wx.cloudBackupSupported === true;
    const sections = [
      ['01', '只在本机记住', ['赛制、声音、触感与最近 20 场战绩，', '保存在这台设备的本地缓存中。']],
      ['02', '不需要个人信息', ['当前版本不请求登录、摄像头、麦克风、', '定位或通讯录，也不接入广告与统计 SDK。']],
      cloudBackup ? ['03', '云端备份由你决定', ['默认关闭；开启后经 Cloudflare 将匿名', '对局记录保存到 GitHub 私有仓库。']] :
        ['03', '没有服务器上传', ['当前版本不主动发送网络请求。', '手动分享时，将使用微信提供的分享功能。']],
      cloudBackup ? ['04', '本机与云端分别管理', ['清除本机记录不影响云端当前备份。', '可在「云备份」中关闭或移除当前备份。']] :
        ['04', '想清除，随时可以', ['可一键清除本机战绩；删除本应用或清理', '微信缓存也可能清除记录，记录不会云同步。']]
    ];
    sections.forEach(function (section, i) {
      const y = 188 + i * 106;
      text(section[0], 25, y + 3, 23, C.blue, 600, 'left', true);
      text(section[1], 69, y, 16, C.ink, 700);
      text(section[2][0], 69, y + 29, 11, C.muted);
      text(section[2][1], 69, y + 49, 11, C.muted);
    });
    button(24, 647, 342, 46, '清除本机战绩', clearRecords, { fill: C.soft, color: C.muted });
    footer();
  }

  function clearRecords() {
    wx.showModal({ title: '清除本机战绩？', content: '将删除本机保存的对决记录。赛制、声音和触感设置会保留。', confirmText: '清除', confirmColor: C.red, success: function (response) {
      if (disposed || !response.confirm) return;
      if (persist({ matches: [] })) notify('本机战绩已清除');
      draw();
    } });
  }

  function draw() {
    if (disposed || hidden || !width) return;
    controls = [];
    ctx.save();
    ctx.fillStyle = C.cream; ctx.fillRect(0, 0, width, height);
    ctx.translate(offsetX, offsetY); ctx.scale(scale, scale);
    if (screen === 'home') home();
    else if (screen === 'duel') duel();
    else if (screen === 'history') history();
    else if (screen === 'privacy') privacy();
    else about();
    if (toast) { rounded(30, 570, 330, 47, 12, C.ink); text(toast, 195, 594, 11, C.cream, 500, 'center'); }
    ctx.restore();
  }

  function clearRoundTimers() {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (frameId !== null) { if (cancelFrame) cancelFrame(frameId); frameId = null; }
  }

  function schedule(s) {
    clearRoundTimers();
    const roundId = s.roundId;
    if (s.phase === 'waiting') {
      timer = setTimeout(function signal() {
        if (hidden || screen !== 'duel' || engine.snapshot().roundId !== roundId || engine.snapshot().phase !== 'waiting') return;
        const drawGo = function () {
          frameId = null;
          if (hidden || screen !== 'duel' || engine.snapshot().roundId !== roundId || engine.snapshot().phase !== 'waiting') return;
          if (now() < s.signalDueAt) { schedule(engine.snapshot()); return; }
          signaling = true; draw();
          const next = engine.go(roundId);
          signaling = false;
          if (next.phase === 'go') audio.play('go');
          draw(); schedule(next);
        };
        if (requestFrame) frameId = requestFrame(drawGo);
        else drawGo();
      }, Math.max(0, s.signalDueAt - now()));
    } else if (s.phase === 'go' || s.phase === 'judging') {
      const due = s.phase === 'go' ? s.reactionDeadlineAt : s.settleAt;
      timer = setTimeout(function () { if (hidden || screen !== 'duel') return; const next = engine.tick(roundId); afterAction(next); }, Math.max(0, due - now()));
    }
  }

  function vibrate() {
    if (prefs.haptics && typeof wx.vibrateShort === 'function') wx.vibrateShort({ type: 'light', fail: function () {} });
  }

  function toggleSound() {
    persist({ soundEnabled: !prefs.soundEnabled });
    audio.setEnabled(prefs.soundEnabled);
    if (prefs.soundEnabled) audio.play('test');
    draw();
  }

  function startRound() {
    message = '';
    const before = engine.snapshot();
    const s = engine.startRound();
    if (s.roundId !== before.roundId) audio.play('start');
    draw(); schedule(s);
  }

  function press(player) {
    const before = engine.snapshot();
    if (before.phase !== 'waiting' && before.phase !== 'go' && before.phase !== 'judging') return;
    afterAction(engine.touch(player));
  }

  function afterAction(s) {
    if (s.phase === 'result' || s.phase === 'complete') {
      clearRoundTimers(); vibrate();
      if (s.result.reason === 'false-start') audio.play('false');
      else if (s.result.reason === 'reaction') audio.play('win');
      if (s.phase === 'complete' && savedSession !== sessionId) {
        const bests = [s.bestTimes.p1, s.bestTimes.p2].filter(function (ms) { return typeof ms === 'number'; });
        const saved = storage.recordMatch({ id: sessionId, at: Date.now(), names: names().slice(), winner: s.matchWinner === 'p1' ? 0 : 1, scores: [s.scores.p1, s.scores.p2], bestMs: bests.length ? Math.min.apply(null, bests) : null });
        savedSession = sessionId;
        if (!saved) notify('存储空间不足，本场战绩未保存');
      }
    } else schedule(s);
    draw();
  }

  function pauseRound() {
    clearRoundTimers(); signaling = false;
    audio.stop();
    engine.cancelRound(); message = '本回合已暂停，比分保留。'; draw();
  }

  function rematch() { engine.resetMatch(prefs.targetScore); sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); savedSession = ''; draw(); }

  function leaveScreen() {
    if (screen === 'duel') {
      pauseRound();
      const s = engine.snapshot();
      if (s.roundsPlayed && s.phase !== 'complete') {
        wx.showModal({ title: '离开这场对决？', content: '这场还没有分出胜负，离开后将重新计分。', confirmText: '离开', cancelText: '继续玩', success: function (response) { if (!disposed && response.confirm) goHome(); } });
      } else goHome();
    } else { screen = screen === 'history' || screen === 'privacy' ? 'about' : 'home'; draw(); }
  }

  function goHome() { clearRoundTimers(); audio.stop(); screen = 'home'; if (typeof wx.setKeepScreenOn === 'function') wx.setKeepScreenOn({ keepScreenOn: false }); draw(); }

  function handleTouch(event) {
    if (disposed || hidden) return;
    audio.unlock();
    // Capture all hits before a redraw replaces controls; simultaneous touches
    // are both passed to the engine and can produce a fair tie.
    const targets = (event.changedTouches || event.touches || []).map(function (touch) {
      const x = ((touch.clientX === undefined ? touch.x : touch.clientX) - offsetX) / scale;
      const y = ((touch.clientY === undefined ? touch.y : touch.clientY) - offsetY) / scale;
      return controls.slice().reverse().find(function (control) { return x >= control.x && x <= control.x + control.w && y >= control.y && y <= control.y + control.h; });
    }).filter(Boolean);
    const players = targets.filter(function (target) { return target.player; });
    if (players.length) {
      const phase = engine.snapshot().phase;
      if (phase !== 'waiting' && phase !== 'go' && phase !== 'judging') return;
      // Resolve all contacts before drawing; a slow Canvas redraw must not
      // turn one simultaneous native touch event into two separated inputs.
      players.forEach(function (target) { engine.touch(target.player); });
      afterAction(engine.snapshot());
    }
    else if (targets[0]) targets[0].action();
  }
  wx.onTouchStart(handleTouch);

  function handleHide() { if (disposed) return; hidden = true; clearRoundTimers(); audio.stop(); engine.cancelRound(); signaling = false; message = '刚才离开了一下，本回合重新开始。'; }
  function handleShow() { if (disposed) return; hidden = false; prefs = storage.read(); audio.setEnabled(prefs.soundEnabled); resize(); }
  function handleResize() { if (disposed) return; pauseRound(); resize(); }
  if (typeof wx.onHide === 'function') wx.onHide(handleHide);
  if (typeof wx.onShow === 'function') wx.onShow(handleShow);
  if (typeof wx.onWindowResize === 'function') wx.onWindowResize(handleResize);
  if (typeof wx.showShareMenu === 'function') wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
  if (typeof wx.onShareAppMessage === 'function') wx.onShareAppMessage(function () { return { title: '来一局举手决斗，看看谁的反应更快！', query: 'from=share' }; });
  if (typeof wx.onShareTimeline === 'function') wx.onShareTimeline(function () { return { title: '举手决斗 · 两个人，一部手机。' }; });
  if (typeof wx.createImage === 'function') {
    avatar = wx.createImage();
    avatar.onload = draw; avatar.onerror = function () { avatar = null; draw(); }; avatar.src = opt.avatarSrc || 'assets/avatar.png';
  }
  if (opt.initialScreen === 'duel') enterDuel();
  resize();
  function dispose() {
    if (disposed) return;
    disposed = true; hidden = true; signaling = false;
    clearRoundTimers();
    audio.dispose();
    if (toastTimer !== null) { clearTimeout(toastTimer); toastTimer = null; }
    engine.cancelRound(); controls = [];
    if (avatar) { avatar.onload = null; avatar.onerror = null; avatar = null; }
    [['offTouchStart', handleTouch], ['offHide', handleHide], ['offShow', handleShow], ['offWindowResize', handleResize]].forEach(function (entry) {
      if (typeof wx[entry[0]] === 'function') wx[entry[0]](entry[1]);
    });
    if (typeof wx.setKeepScreenOn === 'function') wx.setKeepScreenOn({ keepScreenOn: false });
  }
  return { canvas, draw, dispose, snapshot: function () { return { screen, duel: engine.snapshot() }; } };
}

module.exports = { createGameApp, createDuelAudio };
