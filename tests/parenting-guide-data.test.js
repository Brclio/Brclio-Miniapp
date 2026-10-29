const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { COURSE, SECTIONS, ARTICLES } = require('../miniprogram/parenting/data/catalog');
const primary = require('../miniprogram/parenting/data/guide');
const extra = require('../miniprogram/parenting-extra/data/guide');
const { convertBlocks, displayText, importGuide, PACKAGE_TEXT_BUDGET } = require('../scripts/import-parenting-guide');

function getArticle(meta) {
  return (meta.readerPath.startsWith('/parenting-extra/') ? extra : primary).getArticle(meta.id);
}

test('all 191 source articles are readable as the requested text edition', () => {
  assert.equal(COURSE.title, '悦创育儿宝典');
  assert.equal(COURSE.originalTitle, '悦创育儿宝典');
  assert.equal(COURSE.author, '悦创');
  assert.equal(COURSE.attributionLabel, '文字整理');
  assert.equal(COURSE.source, '文字整理版');
  assert.equal(COURSE.total, 191);
  assert.equal(ARTICLES.length, 191);
  assert.equal(new Set(ARTICLES.map((article) => article.id)).size, 191);
  assert.equal(SECTIONS.length, 9);
  assert.deepEqual(primary.COURSE, COURSE);
  assert.deepEqual(extra.COURSE, COURSE);
  for (const [index, meta] of ARTICLES.entries()) {
    const article = getArticle(meta);
    assert.ok(article, meta.id);
    assert.equal(article.order, index + 1);
    assert.equal(article.title, meta.title);
    assert.equal(article.sectionTitle, SECTIONS.find((section) => section.id === article.sectionId).title);
    assert.match(article.sourceUrl, /^https:\/\/www\.dedao\.cn\/course\/article\?id=/);
    assert.ok(article.blocks.length > 0, `${article.id} has no body`);
    assert.ok(article.wordCount > 0);
    assert.ok(article.readingMinutes > 0);
  }
  for (const section of SECTIONS) {
    assert.equal(ARTICLES.filter((article) => article.sectionId === section.id).length, section.count);
  }
  const textSha256 = crypto.createHash('sha256')
    .update(JSON.stringify(ARTICLES.map((meta) => {
      const { id, blocks } = getArticle(meta);
      return { id, blocks };
    }))).digest('hex');
  assert.equal(textSha256, 'aa229583acfeedaa8eb16b4a8ce4b2458d2f16a7dc9561ada86a3171a2d3c76d');
});

test('previous and next navigation includes the correct package at the boundary', () => {
  const link = (meta) => meta ? { id: meta.id, title: meta.title, readerPath: meta.readerPath } : null;
  for (const [index, meta] of ARTICLES.entries()) {
    const article = getArticle(meta);
    assert.deepEqual(article.previous, link(ARTICLES[index - 1]));
    assert.deepEqual(article.next, link(ARTICLES[index + 1]));
  }
  const boundary = ARTICLES.findIndex((meta) => meta.readerPath.startsWith('/parenting-extra/'));
  assert.equal(boundary, 101);
  assert.equal(primary.getArticle(ARTICLES[boundary].id), null);
  assert.equal(extra.getArticle(ARTICLES[boundary - 1].id), null);
  for (const dataset of [primary, extra]) {
    assert.equal(dataset.getArticle('unknown'), null);
    assert.equal(dataset.getArticle('__proto__'), null);
    assert.equal(dataset.getArticle('constructor'), null);
  }
});

test('text datasets contain no media blocks, markup or archive paths', () => {
  const allowed = new Set(['paragraph', 'heading', 'quote', 'list', 'divider']);
  for (const meta of ARTICLES) {
    for (const block of getArticle(meta).blocks) {
      assert.deepEqual(Object.keys(block).sort(), ['text', 'type']);
      assert.ok(allowed.has(block.type));
      assert.equal(typeof block.text, 'string');
      assert.doesNotMatch(block.text, /<\/?(?:audio|video|img|script|iframe)\b|assets\/(?:audio|images)|\$_IGET_USER_NAME_\$/i);
    }
  }
});

test('each package reserves room for its pages within the 2 MiB native budget', () => {
  for (const name of ['parenting', 'parenting-extra']) {
    const directory = path.join(__dirname, '..', 'miniprogram', name, 'data');
    const files = fs.readdirSync(directory);
    assert.ok(files.every((file) => file.endsWith('.js')));
    const bytes = files.reduce((sum, file) => sum + fs.statSync(path.join(directory, file)).size, 0);
    assert.ok(bytes < PACKAGE_TEXT_BUDGET, `${name}: ${bytes} bytes`);
  }
});

test('import keeps meaningful text and drops complete media blocks without using media labels', () => {
  assert.deepEqual(convertBlocks([
    { type: 'header', text: ' 标题 ' },
    { type: 'paragraph', text: '第一段\r\n第二段\u00a0内容' },
    { type: 'audio', title: '不应导入的音频标题', text: '不应导入的音频说明' },
    { type: 'video', text: '不应导入的视频说明' },
    { type: 'image', text: '不应导入的图片说明' },
    { type: 'blockquote', text: '作者\n引用正文' },
    { type: 'list', text: '条目一\n条目二' },
    { type: 'tip', text: '版权归原作者所有' },
    { type: 'salutation', text: '$_IGET_USER_NAME_$,你好' },
    { type: 'hr', text: '' }
  ]), [
    { type: 'heading', text: '标题' },
    { type: 'paragraph', text: '第一段\n第二段 内容' },
    { type: 'quote', text: '作者\n引用正文' },
    { type: 'list', text: '条目一\n条目二' },
    { type: 'paragraph', text: '版权归原作者所有' },
    { type: 'paragraph', text: '你好' },
    { type: 'divider', text: '' }
  ]);
  assert.throws(() => convertBlocks([{ type: 'new-unsupported-type', text: '不能静默漏掉正文' }]), /Unsupported source block type/);
});

test('display-name replacements cover spacing variants and all bundled text', () => {
  assert.equal(displayText('Dr. 魏的家庭教育宝典 / Dr.魏 / Dr 魏 / Dr． 魏 / 魏坤琳 / 章子怡'), '悦创育儿宝典 / 悦创 / 悦创 / 悦创 / 悦创 / 林知夏');
  assert.equal(displayText('叨叨魏 / 叨叨魏老师 / 魏叨叨 / 魏老师 / 魏教授 / @魏连殳'), '悦创 / 悦创 / 悦创 / 悦创 / 悦创 / @魏连殳');
  assert.equal(displayText('二是我的姓氏“魏”（拼音wei）在德文中读作why'), '二是取了姓氏的谐音：以“魏”（拼音 wei）为例，在德文中读作 why');
  const bundled = JSON.stringify({ COURSE, SECTIONS, ARTICLES, bodies: ARTICLES.map(getArticle) });
  assert.doesNotMatch(bundled, /Dr\s*[.．]?\s*魏|魏坤琳|章子怡|叨叨魏|魏叨叨|魏老师|魏教授|我的姓氏“魏”/i);
  assert.match(bundled, /林知夏/);
});

test('import never modifies source files while replacing names in output copies', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'parenting-import-'));
  const source = path.join(temporary, 'source');
  const output = path.join(temporary, 'output');
  fs.mkdirSync(source);
  const course = {
    title: 'Dr. 魏的家庭教育宝典', source_url: 'https://www.dedao.cn/course/detail?id=example', expected_lesson_count: 1,
    sections: [{ id: '1', title: '家庭教育(1讲)', description: 'Dr.魏与魏坤琳' }],
    lessons: [{ id: '1', order: 1, title: '章子怡的分享', summary: 'Dr. 魏的家庭教育宝典', section_id: '1', localized_blocks_path: 'body.json', source_url: 'https://www.dedao.cn/course/article?id=example' }]
  };
  fs.writeFileSync(path.join(source, 'course.json'), JSON.stringify(course));
  fs.writeFileSync(path.join(source, 'body.json'), JSON.stringify([{ type: 'paragraph', text: 'Dr. 魏、魏坤琳、章子怡' }]));
  fs.writeFileSync(path.join(source, 'original-audio.m4a'), Buffer.from([0, 1, 254, 255]));
  const fingerprint = () => fs.readdirSync(source).sort().map((file) => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(source, file))).digest('hex')]);
  try {
    const before = fingerprint();
    importGuide(source, output);
    assert.deepEqual(fingerprint(), before);
    const imported = require(path.join(output, 'miniprogram/parenting/data/guide.js')).getArticle('1');
    assert.equal(imported.title, '林知夏的分享');
    assert.equal(imported.summary, '悦创育儿宝典');
    assert.equal(imported.blocks[0].text, '悦创、悦创、林知夏');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
