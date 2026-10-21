'use strict';

// Brclio app-template palette and type rhythm, adapted to an exported keepsake.
// The only scannable asset allowed here is the real, app-specific mini-program
// code. A missing code is an explicit share invitation, never a website QR.
const C = { cream: '#fefcf6', paper: '#faf6eb', ink: '#1a1a2e', muted: '#72717b', blue: '#2b7fd8', yellow: '#f4d758', red: '#e84a5f', line: '#e7e2d7', paleBlue: '#edf3f8' };
const SANS = '"PingFang SC", "Noto Sans SC", sans-serif';
const SERIF = '"Songti SC", "Noto Serif SC", serif';
const NUMERAL = '"Fraunces", Georgia, serif';
const CODE_ASSET = '/assets/duel-miniprogram-code.jpg';

function rounded(ctx, x, y, width, height, radius, color) {
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y); ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius); ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height); ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius); ctx.quadraticCurveTo(x, y, x + radius, y); ctx.closePath(); ctx.fill();
}

function text(ctx, value, x, y, size, color, family, weight, align) {
  ctx.fillStyle = color || C.ink;
  ctx.font = (weight || 400) + ' ' + size + 'px ' + (family || SANS);
  ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(String(value), x, y);
}

function fit(ctx, value, maxWidth) {
  const original = String(value === null || value === undefined ? '' : value).replace(/[\r\n]+/g, ' ');
  if (ctx.measureText(original).width <= maxWidth) return original;
  const characters = Array.from(original);
  while (characters.length && ctx.measureText(characters.join('') + '…').width > maxWidth) characters.pop();
  return characters.join('') + '…';
}

function lines(ctx, value, maxWidth, maxLines) {
  const characters = Array.from(String(value || '').replace(/[\r\n]+/g, ' '));
  const result = []; let line = '';
  while (characters.length) {
    const next = characters.shift();
    if (line && ctx.measureText(line + next).width > maxWidth) {
      result.push(line); line = next;
      if (result.length === maxLines - 1) { result.push(fit(ctx, line + characters.join(''), maxWidth)); return result; }
    } else line += next;
  }
  if (line) result.push(line);
  return result;
}

function rule(ctx, y) { ctx.fillStyle = C.line; ctx.fillRect(44, y, 512, 1); }
function dot(ctx, x, y, color, radius) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, radius || 4, 0, Math.PI * 2); ctx.fill(); }
function spark(ctx, x, y) {
  ctx.strokeStyle = C.blue; ctx.lineWidth = 2.5;
  for (let i = 0; i < 4; i += 1) { const angle = i * Math.PI / 4; ctx.beginPath(); ctx.moveTo(x + Math.cos(angle) * 5, y + Math.sin(angle) * 5); ctx.lineTo(x + Math.cos(angle) * 13, y + Math.sin(angle) * 13); ctx.moveTo(x - Math.cos(angle) * 5, y - Math.sin(angle) * 5); ctx.lineTo(x - Math.cos(angle) * 13, y - Math.sin(angle) * 13); ctx.stroke(); }
}

function header(ctx, state, summary) {
  text(ctx, 'Brclio 悦创', 44, 61, 29, C.blue, SERIF, 700);
  text(ctx, 'READY / GO / DUEL', 44, 85, 11, C.muted, SANS, 600);
  dot(ctx, 534, 57, C.yellow, 22); spark(ctx, 534, 57);
  rule(ctx, 106);
  text(ctx, summary ? '无限挑战 · 本次战绩' : '双人反应 · 本局战报', 44, 143, 13, C.blue, SANS, 600);
  if (state.customTitle) {
    ctx.font = '500 13px ' + SANS;
    text(ctx, fit(ctx, state.customTitle, 230), 556, 143, 13, C.muted, SANS, 500, 'right');
  }
}

function winnerName(ctx, value) {
  let size = 57;
  ctx.font = '700 ' + size + 'px ' + SERIF;
  if (ctx.measureText(value).width > 512) size = 45;
  ctx.font = '700 ' + size + 'px ' + SERIF;
  text(ctx, fit(ctx, value, 512), 44, 210, size, C.ink, SERIF, 700);
}

function playerStrip(ctx, p1, p2, winner) {
  rule(ctx, 385); rule(ctx, 462);
  dot(ctx, 49, 412, C.red); dot(ctx, 325, 412, C.blue);
  ctx.font = '600 17px ' + SANS;
  text(ctx, fit(ctx, p1, 197), 63, 418, 17, C.ink, SANS, 600);
  text(ctx, fit(ctx, p2, 217), 339, 418, 17, C.ink, SANS, 600);
  text(ctx, winner === 'p1' ? '本局获胜' : '红方', 63, 443, 12, winner === 'p1' ? C.blue : C.muted, SANS, 500);
  text(ctx, winner === 'p2' ? '本局获胜' : '蓝方', 339, 443, 12, winner === 'p2' ? C.blue : C.muted, SANS, 500);
  text(ctx, 'vs.', 289, 428, 20, C.muted, NUMERAL, 400, 'center');
}

function single(ctx, state, p1, p2) {
  const name = state.winner === 'p1' ? p1 : state.winner === 'p2' ? p2 : '这局不分高下';
  winnerName(ctx, name);
  text(ctx, state.winner ? '赢了这一局。' : '默契，也值得记住。', 44, 251, 25, C.ink, SERIF, 600);
  const foul = state.winReason === 'FALSE_START';
  text(ctx, foul ? '获胜原因' : '反应时间', 44, 294, 13, C.muted, SANS, 500);
  if (foul) text(ctx, '对方抢跑', 44, 359, 49, C.blue, SERIF, 700);
  else {
    const value = Number.isFinite(state.reactionTime) && state.reactionTime >= 0 ? String(Math.round(state.reactionTime)) : '—';
    const size = value.length > 6 ? 71 : 89;
    ctx.font = '700 ' + size + 'px ' + NUMERAL;
    const rendered = fit(ctx, value, 440);
    const span = ctx.measureText(rendered).width;
    text(ctx, rendered, 40, 364, size, C.blue, NUMERAL, 700);
    text(ctx, 'ms', Math.min(514, 51 + span), 358, 21, C.blue, SANS, 500);
  }
  playerStrip(ctx, p1, p2, state.winner);
  text(ctx, '这一局的彩头', 44, 503, 17, C.ink, SERIF, 700);
  text(ctx, 'THE LITTLE PRIZE', 556, 502, 10, C.muted, SANS, 500, 'right');
  rounded(ctx, 44, 521, 512, 102, 14, C.paper);
  const reward = state.winner === 'p1' ? state.p1Reward : state.winner === 'p2' ? state.p2Reward : '';
  ctx.font = '600 23px ' + SANS;
  const copy = lines(ctx, reward || '本局未设彩头，好反应也值得被记住。', 464, 2);
  const firstY = copy.length > 1 ? 561 : 581;
  copy.forEach((part, index) => text(ctx, part, 68, firstY + index * 32, 23, reward ? C.ink : C.muted, SANS, 600));
}

function summaryReport(ctx, state, p1, p2) {
  const rounds = Array.isArray(state.infiniteStats) ? state.infiniteStats : [];
  const p1Wins = rounds.filter((round) => round.winner === 'p1').length;
  const p2Wins = rounds.filter((round) => round.winner === 'p2').length;
  winnerName(ctx, p1Wins === p2Wins ? '势均力敌。' : (p1Wins > p2Wins ? p1 : p2));
  text(ctx, p1Wins === p2Wins ? '这一场，不分上下。' : '赢下这场好时光。', 44, 251, 25, C.ink, SERIF, 600);
  dot(ctx, 49, 295, C.red); dot(ctx, 551, 295, C.blue);
  ctx.font = '600 17px ' + SANS;
  text(ctx, fit(ctx, p1, 193), 64, 302, 17, C.ink, SANS, 600);
  text(ctx, fit(ctx, p2, 193), 536, 302, 17, C.ink, SANS, 600, 'right');
  [[p1Wins, 44, C.red, 'left'], [p2Wins, 556, C.blue, 'right']].forEach(([wins, x, color, align]) => {
    let size = 76; ctx.font = '700 ' + size + 'px ' + NUMERAL;
    while (size > 36 && ctx.measureText(String(wins)).width > 175) { size -= 4; ctx.font = '700 ' + size + 'px ' + NUMERAL; }
    text(ctx, fit(ctx, wins, 175), x, 378, size, color, NUMERAL, 700, align);
  });
  text(ctx, '胜场', 44, 402, 12, C.muted, SANS, 500);
  text(ctx, '胜场', 556, 402, 12, C.muted, SANS, 500, 'right');
  text(ctx, rounds.length, 300, 350, 31, C.ink, NUMERAL, 600, 'center');
  text(ctx, '总回合', 300, 379, 12, C.muted, SANS, 500, 'center');
  rule(ctx, 418);
  text(ctx, '最近三局', 44, 458, 24, C.ink, SERIF, 700);
  text(ctx, 'LATEST ROUNDS', 556, 456, 10, C.muted, SANS, 500, 'right');
  const recent = rounds.slice().reverse().slice(0, 3);
  if (!recent.length) { text(ctx, '这一场，还没开局。', 44, 539, 23, C.muted, SERIF, 600); return; }
  recent.forEach((round, index) => {
    const y = 480 + index * 108;
    rule(ctx, y);
    text(ctx, String(round.roundNumber || rounds.length - index).padStart(2, '0'), 44, y + 37, 27, C.muted, NUMERAL, 500);
    const name = round.winner === 'p1' ? p1 : p2;
    ctx.font = '600 20px ' + SANS;
    text(ctx, fit(ctx, name + ' · 获胜', 430), 115, y + 34, 20, round.winner === 'p1' ? C.red : C.blue, SANS, 600);
    ctx.font = '400 17px ' + SANS;
    lines(ctx, round.reward || '本局未设彩头', 430, 2).forEach((line, lineIndex) => text(ctx, line, 115, y + 65 + lineIndex * 24, 17, C.muted));
  });
}

function loadCode(canvas) {
  if (typeof canvas.createImage !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    let image; let timer;
    function done(value) { if (timer) clearTimeout(timer); if (image) { image.onload = null; image.onerror = null; } resolve(value); }
    try {
      image = canvas.createImage();
      image.onload = () => done(image);
      image.onerror = () => done(null);
      timer = setTimeout(() => done(null), 2500);
      image.src = CODE_ASSET;
    } catch (_) { done(null); }
  });
}

function footer(ctx, image, height) {
  const top = height - 239;
  rule(ctx, top);
  text(ctx, '下一局，', 44, top + 59, 29, C.ink, SERIF, 700);
  text(ctx, '一起再来。', 44, top + 99, 29, C.blue, SERIF, 700);
  if (image) {
    // Preserve the official code's pixels and quiet area; never recolor it.
    ctx.drawImage(image, 396, top + 26, 160, 160);
    text(ctx, '扫码进入小程序', 476, top + 211, 12, C.blue, SANS, 500, 'center');
    text(ctx, '长按识别 · 进入小程序', 44, top + 142, 13, C.muted, SANS, 500);
  } else {
    text(ctx, '小程序分享入口', 396, top + 67, 15, C.ink, SANS, 600);
    text(ctx, '分享小程序卡片', 396, top + 99, 15, C.blue, SANS, 600);
    text(ctx, '邀请朋友来一局', 396, top + 124, 13, C.muted);
    text(ctx, '点右上角 · 分享小程序卡片', 44, top + 142, 13, C.muted, SANS, 500);
  }
  text(ctx, 'Brclio · 写代码，教编程，做产品', 44, height - 43, 12, C.muted, SANS, 500);
  const date = new Date(); const pad = (value) => String(value).padStart(2, '0');
  text(ctx, date.getFullYear() + '.' + pad(date.getMonth() + 1) + '.' + pad(date.getDate()) + '  ' + pad(date.getHours()) + ':' + pad(date.getMinutes()), 44, height - 21, 11, C.muted);
}

async function drawReadyGoReport(canvas, state, summary, isCurrent) {
  const width = 600; const height = summary ? 1100 : 900;
  const current = () => { try { return !isCurrent || isCurrent(); } catch (_) { return false; } };
  if (!current()) return { width, height };
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = C.cream; ctx.fillRect(0, 0, width, height);
  const value = state || {};
  const p1 = String(value.p1Name || '红方'); const p2 = String(value.p2Name || '蓝方');
  header(ctx, value, summary);
  if (summary) summaryReport(ctx, value, p1, p2);
  else single(ctx, value, p1, p2);
  const code = await loadCode(canvas);
  if (current()) footer(ctx, code, height);
  return { width, height };
}

module.exports = { drawReadyGoReport };
