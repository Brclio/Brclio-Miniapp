'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const content = require('../miniprogram/lib/blog-content');

test('blog Markdown preserves useful writing structures in web and native HTML', () => {
  const html = content.renderMarkdown('# 标题\n\n正文 **重点** 和 `code`。\n\n- 第一项\n- 第二项\n\n1. 步骤一\n2. 步骤二\n\n> 引用\n\n```js\nconst x = 1 < 2;\n```\n\n| 项目 | 值 |\n| --- | --- |\n| 点赞 | 2 |\n\n![图](https://images.example/a.jpg)\n[网站](https://brclio.com/)');
  const dom = new JSDOM(html).window.document;
  for (const selector of ['h1', 'strong', 'code', 'ul li', 'ol li', '.blog-md-quote', 'pre code', 'table th', 'table td', 'img', 'a']) assert.ok(dom.querySelector(selector), selector);
  assert.equal(dom.querySelector('pre code').textContent, 'const x = 1 < 2;');
  assert.equal(dom.querySelector('a').rel, 'noopener noreferrer');
  assert.equal(content.readingMinutes('字'.repeat(801)), 3);
  assert.equal(content.summarize('# 标题\n\n**内容** [链接](https://example.com)'), '标题 内容 链接');
});

test('untrusted Markdown cannot introduce executable HTML or unsafe URL schemes', () => {
  const attacks = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '[点](javascript:alert(1))', '![图](data:image/svg+xml,bad)', '![图](https://user:password@evil.test/x)', '[点](//evil.test/)', '[点](/%2f/evil.test)', '[点](https://example.com/"onclick="bad)', '[点](https://example.com/\\bad)', '`<script>bad</script>`'];
  for (const attack of attacks) {
    const document = new JSDOM(content.renderMarkdown(attack)).window.document;
    assert.equal(document.querySelectorAll('script,iframe,object,embed,svg,[onclick],[onerror]').length, 0, attack);
    for (const node of document.querySelectorAll('[src],[href]')) assert.ok(/^(?:https:\/\/|\/(?!\/))/.test(node.getAttribute('src') || node.getAttribute('href')), attack);
  }
});

test('incomplete Markdown from the live editor always advances the parser', () => {
  for (const input of ['- ', '1. ', '* ', '+ ', '  -\t', '# ', '> ', '```', '| a | b |\n| --- | --- |']) {
    assert.equal(typeof content.renderMarkdown(input), 'string', input);
  }
});

test('maximum incomplete link input avoids quadratic regex scans', () => {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(process.execPath, ['-e', "const m=require('./miniprogram/lib/blog-content'); for(const s of ['['.repeat(100000),'!['.repeat(50000),'[a]('.repeat(25000),'![a]('.repeat(20000)]) { m.renderMarkdown(s); m.summarize(s); }"], { cwd: require('node:path').resolve(__dirname, '..'), timeout: 2000 });
  assert.equal(result.status, 0, String(result.error || result.stderr));
});

test('native rich-text fragments preserve long Unicode and escaped text within the byte budget', () => {
  for (const source of ['[文😀字](/blog/) '.repeat(5500), '```\n' + '<😀&文'.repeat(18000) + '\n```', '| 标题 | 值 |\n| --- | --- |\n' + '| <文字> | **重点** |\n'.repeat(4000), ('段落 < > &\n\n').repeat(7000)]) {
    const chunks = content.renderMarkdownChunks(source, 32768);
    assert.ok(chunks.length > 1);
    chunks.forEach(chunk => assert.ok(Buffer.byteLength(chunk, 'utf8') <= 32768));
    const text = chunks.map(chunk => new JSDOM(chunk).window.document.body.textContent).join('');
    assert.equal(text, new JSDOM(content.renderMarkdown(source)).window.document.body.textContent);
    assert.equal(text.includes('\ufffd'), false);
  }
});

test('malformed wide Markdown tables cannot amplify tiny source into huge output', () => {
  const wideHeader = '|' + Array(250).fill('x').join('|') + '|';
  const source = wideHeader + '\n| --- | --- |\n' + '|x|\n'.repeat(250);
  const html = content.renderMarkdown(source);
  assert.equal(new JSDOM(html).window.document.querySelector('table'), null);
  assert.ok(Buffer.byteLength(html) < 20000);
  const mismatch = content.renderMarkdown('| a | b |\n| --- | --- |\n| x |\n| a | b | c |');
  assert.equal(new JSDOM(mismatch).window.document.querySelectorAll('td').length, 0);
  const tooWide = content.renderMarkdown('|' + Array(33).fill('x').join('|') + '|\n|' + Array(33).fill('---').join('|') + '|');
  assert.equal(new JSDOM(tooWide).window.document.querySelector('table'), null);
});
