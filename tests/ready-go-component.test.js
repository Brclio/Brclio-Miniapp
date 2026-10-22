'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createReadyGoHarness } = require('./helpers/ready-go-component.cjs');

// Real App.tsx events run through React DOM. Canvas, image loading and sound
// output are offline stubs: these checks do not establish pixels or audibility.
const DAY = 24 * 60 * 60 * 1000;
const placeholder = (h, text) => {
  const input = [...h.document.querySelectorAll('input')].find(element => element.placeholder === text);
  assert.ok(input, 'input exists: ' + text);
  return input;
};
const pageText = h => h.document.body.textContent.replace(/\s+/g, ' ').trim();
const oscillatorStarts = h => h.audioEvents.filter(event => event.event === 'start').length;
const hasButton = (h, text) => [...h.document.querySelectorAll('button')].some(button => button.textContent.replace(/\s+/g, ' ').trim() === text);
const textElement = (h, selector, text, index = 0) => {
  const element = [...h.document.querySelectorAll(selector)].filter(element => element.textContent.trim() === text)[index];
  assert.ok(element, selector + ' exists: ' + text);
  return element;
};
const rewardInput = (h, player) => placeholder(h, player === 'p1' ? '例: 免洗碗券一张' : '例: 请喝大杯奶茶');
const muteButton = h => {
  const button = h.document.querySelector('button svg[class*="lucide-volume"]')?.closest('button');
  assert.ok(button, 'the original sound toggle exists');
  return button;
};
const exportedReport = (h, width, height) => {
  const report = h.canvasExports.at(-1);
  assert.ok(report, 'the actual report function called Canvas.toDataURL');
  assert.equal(report.width, width);
  assert.equal(report.height, height);
  assert.equal(report.mimeType, 'image/png');
  assert.match(report.marker, /^READYGO_TEST_CANVAS_NOT_A_PNG:/);
  const link = h.document.querySelector('a[download^="ReadyGoDuel_Report_"]');
  assert.ok(link, 'the generated report has its download link');
  assert.match(link.download, /^ReadyGoDuel_Report_\d+\.png$/);
  assert.equal(link.getAttribute('href'), report.dataUrl);
  return report;
};

test('settings trim saved names, cancel drafts, and persist a saved reset across remounts', async t => {
  const h = await createReadyGoHarness(t);
  await h.click(h.queryTitle('游戏设置'));
  await h.input(placeholder(h, '例如：谁是今晚洗碗王'), '  周末对决  ');
  await h.input(placeholder(h, '红方'), '  小红  ');
  await h.input(placeholder(h, '蓝方'), '  小蓝  ');
  await h.input(h.document.querySelector('input[type="range"]'), '9');
  await h.click(h.queryButton('保存'));
  assert.equal(h.window.localStorage.getItem('RGD_CUSTOM_TITLE'), '周末对决');
  assert.equal(h.window.localStorage.getItem('RGD_P1_NAME'), '小红');
  assert.equal(h.window.localStorage.getItem('RGD_P2_NAME'), '小蓝');
  assert.equal(h.window.localStorage.getItem('RGD_MAX_WAIT'), '9');
  assert.equal(h.document.querySelector('h1').textContent.trim(), '周末对决');

  await h.click(h.queryTitle('游戏设置'));
  await h.input(placeholder(h, '例如：谁是今晚洗碗王'), '不要保存的草稿');
  await h.input(placeholder(h, '红方'), '草稿红');
  await h.click(h.queryButton('取消'));
  await h.remount();
  await h.click(h.queryTitle('游戏设置'));
  assert.equal(placeholder(h, '例如：谁是今晚洗碗王').value, '周末对决');
  assert.equal(placeholder(h, '红方').value, '小红');
  assert.equal(placeholder(h, '蓝方').value, '小蓝');
  assert.equal(h.document.querySelector('input[type="range"]').value, '9');

  await h.click(h.queryTitle('重置所有设置'));
  assert.equal(placeholder(h, '例如：谁是今晚洗碗王').value, '');
  assert.equal(h.window.localStorage.getItem('RGD_CUSTOM_TITLE'), '周末对决', 'reset first changes the draft');
  await h.click(h.queryButton('保存'));
  await h.remount();
  for (const key of ['RGD_CUSTOM_TITLE', 'RGD_P1_NAME', 'RGD_P2_NAME']) assert.equal(h.window.localStorage.getItem(key), null);
  assert.equal(h.window.localStorage.getItem('RGD_MAX_WAIT'), '6');
  assert.equal(h.document.querySelector('h1').textContent.trim(), '双人反应对决');
  await h.click(h.queryTitle('游戏设置'));
  assert.equal(placeholder(h, '例如：谁是今晚洗碗王').value, '');
  assert.equal(placeholder(h, '红方').value, '');
  assert.equal(placeholder(h, '蓝方').value, '');
  assert.equal(h.document.querySelector('input[type="range"]').value, '6');
});

test('each reward has an independent password, visibility toggle and clear-to-refill action', async t => {
  const h = await createReadyGoHarness(t);
  await h.click(h.queryButton('立即开始'));
  await h.input(rewardInput(h, 'p1'), '红方秘密奶茶');
  await h.input(rewardInput(h, 'p2'), '蓝方秘密甜点');
  await h.click(h.queryTitle('隐藏内容(密文)', 0));
  assert.equal(rewardInput(h, 'p1').type, 'password');
  await h.click(h.queryTitle('显示内容(明文)', 0));
  assert.equal(rewardInput(h, 'p1').type, 'text');
  await h.click(h.queryTitle('设置密码', 0));
  await h.input(placeholder(h, '默认 123456'), 'red-code');
  await h.click(h.queryTitle('设置密码', 1));
  await h.input(placeholder(h, '默认 123456'), 'blue-code');
  await h.click(h.queryTitle('锁定并隐藏', 0));
  await h.click(h.queryTitle('锁定并隐藏', 0));
  assert.doesNotMatch(pageText(h), /红方秘密奶茶|蓝方秘密甜点/);

  await h.click(h.queryTitle('查看内容', 0));
  await h.input(placeholder(h, '******'), 'blue-code');
  await h.click(h.queryButton('确认'));
  assert.equal(h.alerts.at(-1), '密码错误', 'the other player password cannot unlock red');
  assert.doesNotMatch(pageText(h), /已解密内容/);
  await h.input(placeholder(h, '******'), 'red-code');
  await h.click(h.queryButton('确认'));
  assert.match(pageText(h), /已解密内容\s*红方秘密奶茶/);
  assert.doesNotMatch(pageText(h), /蓝方秘密甜点/);

  await h.click(h.queryTitle('查看内容', 1));
  assert.doesNotMatch(pageText(h), /红方秘密奶茶/);
  await h.input(placeholder(h, '******'), 'red-code');
  await h.click(h.queryButton('确认'));
  assert.equal(h.alerts.at(-1), '密码错误');
  await h.input(placeholder(h, '******'), 'blue-code');
  await h.click(h.queryButton('确认'));
  assert.match(pageText(h), /已解密内容\s*蓝方秘密甜点/);
  await h.click(textElement(h, 'span', '点击清空重填', 0));
  assert.equal(rewardInput(h, 'p1').value, '');
  assert.equal(rewardInput(h, 'p1').type, 'text');
  assert.equal(h.document.querySelectorAll('button[title="查看内容"]').length, 1, 'blue remains locked');
});

test('opening rewards stays silent, launching sounds, and a waiting touch awards the opponent', async t => {
  const h = await createReadyGoHarness(t);
  const silent = h.audioEvents.length;
  await h.click(h.queryButton('立即开始'));
  assert.equal(h.audioEvents.length, silent, 'opening the reward form is not the game launch');
  await h.click(h.queryButton('跳过并开始'));
  assert.ok(h.audioEvents.length > silent, 'the launch button reaches the actual start sound');
  assert.match(pageText(h), /等待信号/);
  const started = h.audioEvents.length;
  const redHeading = textElement(h, 'h2', 'P1 红方');
  const redZone = redHeading.closest('div.flex-1');
  assert.ok(redZone, 'the original red player area exists');
  await h.click(redZone);
  assert.match(pageText(h), /蓝方胜/);
  assert.match(pageText(h), /对方抢跑犯规/);
  assert.ok(h.audioEvents.length > started, 'the false-start branch reaches its sound');
  await h.advance(2000);
  assert.doesNotMatch(pageText(h), /GO!/);
  assert.match(pageText(h), /蓝方胜/);
});

test('GO allows reactions later than five seconds and muting suppresses all in-round sounds', async t => {
  const h = await createReadyGoHarness(t);
  await h.click(h.queryButton('立即开始'));
  await h.click(h.queryButton('跳过并开始'));
  await h.advance(1999);
  assert.match(pageText(h), /等待信号/);
  await h.advance(1);
  assert.match(pageText(h), /GO!/);
  await h.advance(6001);
  assert.match(pageText(h), /GO!/, 'the original mode has no five-second timeout');
  await h.key('a', 'KeyA');
  assert.match(pageText(h), /红方胜/);
  assert.match(pageText(h), /6001 ms/);
  const endedAudio = h.audioEvents.length;
  await h.key('l', 'KeyL');
  await h.key('a', 'KeyA');
  assert.match(pageText(h), /红方胜/);
  assert.equal(h.audioEvents.length, endedAudio);

  await h.remount();
  await h.click(muteButton(h));
  const mutedAudio = h.audioEvents.length;
  await h.click(h.queryButton('立即开始'));
  await h.click(h.queryButton('跳过并开始'));
  await h.advance(2000);
  await h.key('l', 'KeyL');
  assert.match(pageText(h), /蓝方胜/);
  assert.equal(h.audioEvents.length, mutedAudio, 'muted start, GO and win do not synthesize sound');
});

test('changing the sound toggle while waiting applies to the upcoming GO signal', async t => {
  await t.test('muting after launch suppresses GO', async t => {
    const h = await createReadyGoHarness(t);
    await h.click(h.queryButton('立即开始'));
    await h.click(h.queryButton('跳过并开始'));
    await h.click(muteButton(h));
    const beforeGo = oscillatorStarts(h);
    await h.advance(2000);
    assert.match(pageText(h), /GO!/);
    assert.equal(oscillatorStarts(h), beforeGo, 'GO must read the currently muted setting');
  });
  await t.test('unmuting after a silent launch enables GO', async t => {
    const h = await createReadyGoHarness(t);
    await h.click(muteButton(h));
    await h.click(h.queryButton('立即开始'));
    await h.click(h.queryButton('跳过并开始'));
    const beforeGo = oscillatorStarts(h);
    await h.click(muteButton(h));
    await h.advance(2000);
    assert.match(pageText(h), /GO!/);
    assert.ok(oscillatorStarts(h) > beforeGo, 'GO must read the currently enabled setting');
  });
});

test('two infinite rounds auto-generate new rewards, ignore repeated keys and export a tied summary', async t => {
  const h = await createReadyGoHarness(t);
  await h.upload(h.document.querySelector('input[type="file"]'), '自动彩头\n另一个彩头');
  await h.click(h.queryTitle('无限世界'));
  await h.click(h.queryButton('开启挑战'));
  await h.click(h.queryButton('✨ 自定义'));
  await h.input(rewardInput(h, 'p1'), '首轮红方奖励');
  await h.input(rewardInput(h, 'p2'), '首轮蓝方奖励');
  await h.click(h.queryButton('开始对决'));
  await h.advance(2000);
  await h.key('a', 'KeyA');
  await h.key('a', 'KeyA');
  await h.key('l', 'KeyL');
  assert.match(pageText(h), /红方胜/);
  await h.click(h.queryButton('下一轮'));
  assert.match(pageText(h), /等待信号/);
  assert.equal(hasButton(h, '开始对决'), false, 'the next round starts without reopening the form');
  await h.advance(2000);
  await h.key('l', 'KeyL');
  await h.key('a', 'KeyA');
  await h.key('l', 'KeyL');
  await h.click(h.queryButton('退出'));
  const summary = textElement(h, 'h2', '无限世界战报').parentElement.parentElement;
  for (const name of ['红方胜场', '蓝方胜场']) {
    const label = [...summary.querySelectorAll('div')].find(element => element.textContent === name);
    assert.ok(label, name);
    assert.equal(label.nextElementSibling.textContent, '1');
  }
  assert.equal([...summary.querySelectorAll('div')].filter(element => /^#\d+$/.test(element.textContent)).length, 2, 'ended keys cannot add extra round records');
  assert.match(summary.textContent, /赢走: 首轮红方奖励/);
  assert.match(summary.textContent, /赢走: 自动彩头/);
  assert.doesNotMatch(summary.textContent, /赢走: 首轮蓝方奖励/);
  await h.click(h.queryButton('生成总战报'));
  exportedReport(h, 600, 1000);
  const drawn = h.drawTexts.map(entry => entry.text);
  assert.ok(drawn.includes('势均力敌'));
  assert.ok(drawn.includes('总对局'));
  assert.ok(drawn.includes('2'));
  assert.ok(drawn.includes('赢走: 自动彩头'));
});

test('the single-round report exports the original Canvas contract and same-origin QR download', async t => {
  const h = await createReadyGoHarness(t);
  await h.click(h.queryButton('立即开始'));
  await h.input(rewardInput(h, 'p1'), '一杯奶茶');
  await h.click(h.queryButton('开始对决'));
  await h.advance(2000);
  await h.advance(137);
  await h.key('a', 'KeyA');
  await h.click(textElement(h, 'span', '点击揭晓彩头'));
  assert.match(pageText(h), /赢家奖励 一杯奶茶/);
  await h.click(h.queryButton('战报'));
  exportedReport(h, 600, 800);
  const drawn = h.drawTexts.map(entry => entry.text);
  assert.ok(drawn.includes('红方胜'));
  assert.ok(drawn.includes('反应时间: 137 ms'));
  assert.ok(drawn.includes('赢取: 一杯奶茶'));
  assert.equal(h.imageRequests.length, 1);
  assert.equal(h.imageRequests[0], './assets/ReadyGoDuel.png');
  const qr = new URL(h.imageRequests[0], h.window.location.href);
  assert.equal(qr.origin, h.window.location.origin);
});

test('TXT imports trim lines, reject blank entries, and preserve the custom category after remount', async t => {
  const h = await createReadyGoHarness(t);
  const fileInput = h.document.querySelector('input[type="file"]');
  await h.upload(fileInput, '\n \n\t\r\n');
  assert.equal(h.alerts.at(-1), '文件内容为空或格式不正确');
  assert.equal(h.window.localStorage.getItem('RGD_CUSTOM_REWARDS'), null);
  await h.upload(fileInput, '  自定义奶茶  \r\n\n \t\n自定义甜点\n');
  assert.equal(h.alerts.at(-1), '成功导入 2 个自定义彩头！');
  assert.deepEqual(JSON.parse(h.window.localStorage.getItem('RGD_CUSTOM_REWARDS')), ['自定义奶茶', '自定义甜点']);
  assert.equal(fileInput.value, '', 'the same file can be selected again');
  await h.remount();
  await h.click(h.queryButton('立即开始'));
  await h.click(h.queryButton('✨ 自定义'));
  await h.click(h.queryTitle('随机生成 (✨ 自定义)', 0));
  assert.equal(rewardInput(h, 'p1').value, '自定义奶茶');
  await h.click(h.queryTitle('随机生成 (✨ 自定义)', 1));
  assert.equal(rewardInput(h, 'p2').value, '自定义奶茶');
});

test('settings and custom rewards expire independently at seven days while max wait survives', async t => {
  const h = await createReadyGoHarness(t);
  const storage = h.window.localStorage;
  const now = h.now();
  for (const [key, value] of Object.entries({
    RGD_CUSTOM_TITLE: '仍在有效期', RGD_P1_NAME: '旧红', RGD_P2_NAME: '旧蓝',
    RGD_TITLE_TS: String(now - 6 * DAY), RGD_MAX_WAIT: '9',
    RGD_CUSTOM_REWARDS: JSON.stringify(['即将到期彩头']), RGD_CUSTOM_TS: String(now - 7 * DAY + 1)
  })) storage.setItem(key, value);
  await h.remount();
  assert.equal(h.document.querySelector('h1').textContent.trim(), '仍在有效期');
  await h.click(h.queryButton('立即开始'));
  assert.equal(hasButton(h, '✨ 自定义'), true);
  await h.advance(1);
  await h.remount();
  assert.equal(h.document.querySelector('h1').textContent.trim(), '仍在有效期', 'reward expiry does not expire newer settings');
  assert.equal(storage.getItem('RGD_CUSTOM_REWARDS'), null);
  assert.equal(storage.getItem('RGD_CUSTOM_TS'), null);
  await h.click(h.queryButton('立即开始'));
  assert.equal(hasButton(h, '✨ 自定义'), false);

  await h.advance(DAY - 1);
  await h.remount();
  assert.equal(h.document.querySelector('h1').textContent.trim(), '双人反应对决');
  for (const key of ['RGD_CUSTOM_TITLE', 'RGD_P1_NAME', 'RGD_P2_NAME', 'RGD_TITLE_TS']) assert.equal(storage.getItem(key), null);
  assert.equal(storage.getItem('RGD_MAX_WAIT'), '9');
  await h.click(h.queryTitle('游戏设置'));
  assert.equal(h.document.querySelector('input[type="range"]').value, '9');
});
