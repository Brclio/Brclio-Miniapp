'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { drawReadyGoReport } = require('../miniprogram/lib/ready-go-report');

function host(imageMode) {
  const operations = []; let pendingImage;
  const context = {
    font: '', textAlign: 'left', fillStyle: '',
    measureText(value) { const size = Number((this.font.match(/(\d+)px/) || [0, 14])[1]); return { width: Array.from(String(value)).reduce((sum, letter) => sum + (/[^\x00-\xff]/.test(letter) ? size : size * .56), 0) }; },
    fillText(value, x, y) { operations.push({ type: 'text', value: String(value), x, y, font: this.font, align: this.textAlign, width: this.measureText(value).width }); },
    fillRect(x, y, width, height) { operations.push({ type: 'rect', x, y, width, height, color: this.fillStyle }); },
    drawImage(image, x, y, width, height) { operations.push({ type: 'image', source: image.src, x, y, width, height }); }
  };
  ['beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'closePath', 'fill', 'arc', 'stroke'].forEach((name) => { context[name] = () => {}; });
  const canvas = {
    width: 0, height: 0, getContext: () => context,
    createImage() {
      pendingImage = { get src() { return this._src; }, set src(value) { this._src = value; operations.push({ type: 'requested-image', source: value }); if (imageMode === 'loaded') this.onload(); else if (imageMode !== 'pending') this.onerror(); } };
      return pendingImage;
    }
  };
  return { canvas, operations, completeImage() { pendingImage.onload(); } };
}
const state = { p1Name: '红方', p2Name: '蓝方', winner: 'p1', winReason: 'REACTION', reactionTime: 24497, p1Reward: '请喝大杯奶茶', p2Reward: '', gameMode: 'TOUCH', customTitle: '今晚谁洗碗', infiniteStats: [] };
const words = (host) => host.operations.filter((op) => op.type === 'text').map((op) => op.value);

test('single report keeps winner, reaction and prize with the real mini-program code', async () => {
  const h = host('loaded');
  assert.deepEqual(await drawReadyGoReport(h.canvas, state, false), { width: 600, height: 900 });
  assert.deepEqual(h.operations[0], { type: 'rect', x: 0, y: 0, width: 600, height: 900, color: '#fefcf6' });
  for (const value of ['Brclio 悦创', '红方', '24497', 'ms', '请喝大杯奶茶', '扫码进入小程序']) assert.ok(words(h).includes(value), value);
  assert.deepEqual(h.operations.filter((op) => op.type === 'image'), [{ type: 'image', source: '/assets/duel-miniprogram-code.jpg', x: 396, y: 687, width: 160, height: 160 }]);
  assert.ok(!JSON.stringify(h.operations).includes('duel-qr.png'));
});

test('missing mini-program code offers an explicit share entry without a website or fake code', async () => {
  const h = host('missing');
  await drawReadyGoReport(h.canvas, Object.assign({}, state, { winReason: 'FALSE_START' }), false);
  assert.ok(words(h).includes('对方抢跑'));
  assert.ok(words(h).includes('分享小程序卡片'));
  assert.ok(!words(h).some((value) => /扫码|24497|https?:/.test(value)));
  assert.equal(h.operations.filter((op) => op.type === 'image').length, 0);
});

test('summary preserves wins, total and the most recent three rewards in their own rows', async () => {
  const h = host('loaded');
  const rounds = [1, 2, 3, 4].map((roundNumber) => ({ roundNumber, winner: roundNumber === 1 ? 'p2' : 'p1', reward: '彩头' + roundNumber }));
  assert.deepEqual(await drawReadyGoReport(h.canvas, Object.assign({}, state, { infiniteStats: rounds }), true), { width: 600, height: 1100 });
  const text = words(h);
  for (const value of ['3', '1', '4', '彩头4', '彩头3', '彩头2', '总回合']) assert.ok(text.includes(value), value);
  assert.ok(!text.includes('彩头1'));
  const prizes = h.operations.filter((op) => op.type === 'text' && /^彩头/.test(op.value));
  assert.deepEqual(prizes.map((op) => op.y), [545, 653, 761]);
  assert.ok(prizes.every((op) => op.x + op.width <= 556));
});

test('an empty summary displays zero scores without inventing a winner or a recent round', async () => {
  const h = host('missing');
  await drawReadyGoReport(h.canvas, Object.assign({}, state, { infiniteStats: [] }), true);
  assert.equal(words(h).filter((value) => value === '0').length, 3);
  assert.ok(words(h).includes('势均力敌。'));
  assert.ok(words(h).includes('这一场，还没开局。'));
});

test('long names and rewards wrap or truncate inside the content bounds, above the footer', async () => {
  const h = host('loaded');
  await drawReadyGoReport(h.canvas, Object.assign({}, state, { p1Name: '很长的玩家名字'.repeat(8), p1Reward: '今晚负责洗碗然后请朋友一起吃火锅喝奶茶'.repeat(9) }), false);
  const text = h.operations.filter((op) => op.type === 'text');
  assert.ok(text.some((op) => op.value.endsWith('…')));
  text.forEach((op) => {
    const left = op.align === 'right' ? op.x - op.width : op.align === 'center' ? op.x - op.width / 2 : op.x;
    const right = op.align === 'right' ? op.x : op.align === 'center' ? op.x + op.width / 2 : op.x + op.width;
    assert.ok(left >= 35 && right <= 562, JSON.stringify(op));
    assert.ok(op.y >= 20 && op.y <= 880, JSON.stringify(op));
  });
  const prize = text.filter((op) => /今晚负责/.test(op.value) || op.y === 593);
  assert.ok(prize.every((op) => op.y < 661));
});

test('cancellation before rendering or while code loads does not add stale drawing', async () => {
  const initial = host('loaded');
  await drawReadyGoReport(initial.canvas, state, false, () => false);
  assert.equal(initial.operations.length, 0);
  const h = host('pending'); let current = true;
  const draw = drawReadyGoReport(h.canvas, state, true, () => current);
  const count = h.operations.length; current = false; h.completeImage(); await draw;
  assert.equal(h.operations.length, count);
  assert.ok(!words(h).includes('扫码进入小程序'));
});
