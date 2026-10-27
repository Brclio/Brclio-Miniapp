(function bootBlog() {
  'use strict';
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', bootBlog, { once: true }); return; }
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const date = value => { const at = new Date(value); return value && Number.isFinite(at.getTime()) ? at.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '尚未发布'; };
  const number = value => new Intl.NumberFormat('zh-CN').format(Math.max(0, Number(value) || 0));
  const link = values => '/blog/' + (new URLSearchParams(values).toString() ? '?' + new URLSearchParams(values).toString() : '');
  const safeImage = value => { try { const url = new URL(value, window.location.origin); return value && url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch (_) { return ''; } };
  const fields = ['title', 'excerpt', 'category', 'tags', 'coverUrl', 'content'];
  let runtime = null, user = null, canWrite = false, generation = 0, stopped = false, busy = false;
  let currentPost = null, interaction = { liked: false, favorited: false }, commentPage = 1, commentsRequest = 0, readerMutationPending = false;
  let editor = null, autosaveTimer = null, dirty = false, loadedDraft = null;
  let pendingConfirmation = null;
  let query = new URLSearchParams(window.location.search);
  const state = { page: Number(query.get('page')) || 1, q: query.get('q') || '', category: query.get('category') || '', tag: query.get('tag') || '' };

  function notice(message = '', error = false) {
    const element = $('#notice'); element.textContent = message; element.hidden = !message; element.classList.toggle('error', error);
  }
  function closeConfirmation(confirmed = false) {
    const pending = pendingConfirmation;
    if (!pending) return;
    pendingConfirmation = null;
    const dialog = $('#confirm-dialog');
    if (dialog.open) dialog.close();
    pending.resolve(confirmed && !stopped && pending.epoch === generation && pending.userId === principal());
  }
  function confirmAction({ heading, message, subject = '', accept = '确认', cancel = '取消', danger = false }) {
    if (pendingConfirmation || stopped) return Promise.resolve(false);
    const dialog = $('#confirm-dialog');
    $('#confirm-title').textContent = heading;
    $('#confirm-message').textContent = message;
    $('#confirm-subject').textContent = subject; $('#confirm-subject').hidden = !subject;
    $('#confirm-accept').textContent = accept; $('#confirm-cancel').textContent = cancel;
    dialog.dataset.danger = String(danger);
    return new Promise(resolve => {
      pendingConfirmation = { resolve, epoch: generation, userId: principal() };
      try { dialog.showModal(); $('#confirm-cancel').focus(); }
      catch (_) { closeConfirmation(); notice('确认窗口暂时无法打开，请刷新页面后重试。', true); }
    });
  }
  $('#confirm-accept').addEventListener('click', () => closeConfirmation(true));
  $('#confirm-cancel').addEventListener('click', () => closeConfirmation());
  $('#confirm-dialog').addEventListener('cancel', event => { event.preventDefault(); closeConfirmation(); });
  $('#confirm-dialog').addEventListener('close', () => { if (!$('#confirm-dialog').open) closeConfirmation(); });
  function empty(title, description, retry = false) { return '<div class="empty-state"><div class="empty-mark" aria-hidden="true">b.</div><h2>' + escape(title) + '</h2><p>' + escape(description) + '</p>' + (retry ? '<button class="secondary" data-action="retry" type="button">重新加载 ↗</button>' : '') + '</div>'; }
  function view() { return query.has('post') ? 'post' : query.get('view') || (query.get('saved') === '1' ? 'saved' : 'list'); }
  function principal() { return runtime?.client?.getCachedUser()?.id || null; }
  async function api(path, options = {}, epoch = generation) {
    if (!runtime?.requestBlog) throw new Error('博客服务暂未就绪，请刷新后重试。');
    const result = await runtime.requestBlog(path, options);
    if (stopped || epoch !== generation) { const error = new Error('页面已切换。'); error.canceled = true; throw error; }
    return result;
  }
  function fail(error) { if (!error?.canceled && !stopped) notice(error?.message || '连接暂时中断，请稍后重试。', true); }
  function title(text) { document.title = text + ' · Brclio 悦创'; }
  function setTab(mode) {
    document.querySelectorAll('[data-view]').forEach(element => { const active = element.dataset.view === mode; element.classList.toggle('active', active); if (active) element.setAttribute('aria-current', 'page'); else element.removeAttribute('aria-current'); });
  }
  function rememberDraft() {
    if (!editor || !dirty || !user || !$('#editor-form')) return;
    clearTimeout(autosaveTimer);
    try {
      window.localStorage.setItem(draftKey(editor.id), JSON.stringify({ version: 1, userId: user.id, postId: editor.id || '', at: Date.now(), revision: editor.draftBaseRevision ?? editor.revision ?? 0, fields: readEditor() }));
      $('#draft-status').textContent = '本机草稿已保存 · ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    } catch (_) { $('#draft-status').textContent = '本机存储不可用，请及时保存到云端。'; }
  }
  async function navigate(values, options = {}) {
    if (busy || pendingConfirmation) return;
    if (dirty && !options.saved && !await confirmAction({ heading: '离开当前编辑页？', message: '当前文字会保存在这个账号的本机草稿中，可以稍后继续编写。', accept: '保存并离开', cancel: '继续编辑' })) return;
    rememberDraft(); dirty = false; editor = null; loadedDraft = null; clearTimeout(autosaveTimer);
    window.history.pushState({}, '', link(values)); query = new URLSearchParams(window.location.search);
    state.page = Number(query.get('page')) || 1; state.q = query.get('q') || ''; state.category = query.get('category') || ''; state.tag = query.get('tag') || '';
    void route(); window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function listQuery(page = state.page) {
    const values = { page: String(page) };
    if (view() !== 'list') values.view = view();
    for (const name of ['q', 'category', 'tag']) if (state[name]) values[name] = state[name];
    return values;
  }
  function counts(value = {}) { return '<span>' + number(value.views) + ' 次阅读</span><span>' + number(value.likes) + ' 赞</span><span>' + number(value.favorites) + ' 收藏</span><span>' + number(value.comments) + ' 评论</span>'; }
  function postRow(post, admin = false) {
    const cover = safeImage(post.coverUrl), url = link({ post: post.id });
    return '<article class="post-row"><div class="post-row-body"><div class="post-topline"><span class="category-label">' + escape(post.category || '未分类') + '</span><span>' + escape(date(post.publishedAt || post.updatedAt)) + '</span>' + (admin ? '<span class="status-badge">' + (post.status === 'published' ? '已发布' : '草稿') + '</span>' : '') + '</div><h2><a href="' + escape(url) + '" data-post="' + escape(post.id) + '">' + escape(post.title || '未命名文章') + '</a></h2><p class="post-excerpt">' + escape(post.excerpt || '') + '</p><div class="post-meta"><span>' + number(post.readingMinutes || 1) + ' 分钟阅读</span>' + counts(post.counts) + '</div>' + (admin ? '<div class="post-row-actions"><a class="text-button" data-edit="' + escape(post.id) + '" href="' + escape(link({ view: 'write', edit: post.id })) + '">编辑文章 ↗</a></div>' : '') + '</div>' + (cover ? '<a href="' + escape(url) + '" data-post="' + escape(post.id) + '" tabindex="-1" aria-hidden="true"><img class="post-row-image" src="' + escape(cover) + '" loading="lazy" referrerpolicy="no-referrer" alt=""></a>' : '') + '</article>';
  }
  async function loadList(epoch) {
    const mode = view(), admin = mode === 'admin', saved = mode === 'saved';
    title(admin ? '文章管理' : saved ? '我的收藏' : '博客');
    $('#list-title').textContent = admin ? '把想法，写成一篇文章。' : saved ? '那些，想再读一次的文字。' : '留一点文字，给好奇心。';
    $('#list-description').textContent = admin ? '草稿留给自己，发布之后，网页与小程序都能读到。' : saved ? '你的收藏跟随账号，在网页与小程序之间同步。' : '写代码，教编程，做产品。也记下生活里的小发现。';
    $('#search').value = state.q;
    $('#clear-filters').hidden = !state.q && !state.category && !state.tag;
    $('#posts').innerHTML = empty('正在找来文字…', '稍等一下，文章很快就到。'); $('#pagination').replaceChildren();
    if ((saved && !user) || (admin && !canWrite)) {
      $('#posts').innerHTML = empty(saved ? '登录后，带走喜欢的文章。' : '这里留给写作者。', saved ? '使用悦创账号登录，即可查看已收藏的文章。' : '请登录已配置为博客管理员的账号。') + '<a class="primary" href="/?category=mine">前往我的账号 ↗</a>';
      $('#categories').replaceChildren(); $('#tags').replaceChildren(); $('#result-count').textContent = ''; return;
    }
    const search = new URLSearchParams({ page: String(state.page), pageSize: '12' });
    for (const name of ['q', 'category', 'tag']) if (state[name]) search.set(name, state[name]);
    if (saved) search.set('saved', '1');
    try {
      const result = await api((admin ? '/admin/posts' : '/posts') + '?' + search, {}, epoch);
      state.page = result.page || state.page;
      $('#posts').innerHTML = result.posts?.length ? result.posts.map(post => postRow(post, admin)).join('') : empty(saved ? '还没有收藏的文字。' : state.q || state.category || state.tag ? '换个词，再找找。' : admin ? '第一篇文章，从这里开始。' : '文字正在慢慢酝酿。', saved ? '打开文章，点击收藏，就能在这里重新找到它。' : admin ? '点击上方「写篇文章」，从草稿开始记录。' : '可以清除筛选，或过一阵再来看看。');
      $('#result-count').textContent = '共 ' + number(result.total) + ' 篇' + (state.tag ? ' · #' + state.tag : '');
      const categoryItems = (result.categories || []).map(item => typeof item === 'string' ? item : item.name || item.category).filter(Boolean);
      $('#categories').innerHTML = [''].concat([...new Set(categoryItems)]).map(category => '<button class="filter-button" type="button" data-category="' + escape(category) + '" aria-pressed="' + (state.category === category) + '">' + escape(category || '全部文章') + '</button>').join('');
      $('#tags').innerHTML = (result.tags || []).slice(0, 40).map(item => typeof item === 'string' ? item : item.name || item.tag).filter(Boolean).map(tag => '<button class="tag" type="button" data-tag="' + escape(tag) + '" aria-pressed="' + (state.tag === tag) + '">#' + escape(tag) + '</button>').join('');
      const pages = Math.max(1, Math.ceil((result.total || 0) / (result.pageSize || 12)));
      if (pages > 1) $('#pagination').innerHTML = '<button class="secondary" data-page="' + (state.page - 1) + '" ' + (state.page <= 1 ? 'disabled' : '') + '>← 上一页</button><span>' + state.page + ' / ' + pages + '</span><button class="secondary" data-page="' + (state.page + 1) + '" ' + (state.page >= pages ? 'disabled' : '') + '>下一页 →</button>';
    } catch (error) { if (epoch !== generation) return; $('#posts').innerHTML = empty('这次没能加载文章。', error.message || '请检查网络，稍后重试。', true); $('#result-count').textContent = ''; }
  }
  function visitorId() {
    const key = 'brclio.blog-visitor.v1';
    try { let id = window.localStorage.getItem(key); if (!/^[a-f0-9]{32}$/.test(id || '')) { id = Array.from(window.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join(''); window.localStorage.setItem(key, id); } return id; } catch (_) { return Array.from(window.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join(''); }
  }
  function renderReader(result) {
    const post = result.post; currentPost = post; interaction = result.interaction || { liked: false, favorited: false };
    title(post.title);
    const cover = safeImage(post.coverUrl), avatar = safeImage(post.author?.avatarUrl);
    $('#blog-reader').innerHTML = '<div class="reader-nav"><a class="text-button" href="/blog/" data-view="list">← 回到文章列表</a><div>' + (result.canEdit ? '<a class="text-button" href="' + escape(link({ view: 'write', edit: post.id })) + '" data-edit="' + escape(post.id) + '">编辑文章 ↗</a>' : '') + '</div></div><div class="reader-wrap"><div><article><header class="article-header"><div class="post-topline"><span class="category-label">' + escape(post.category || '未分类') + '</span>' + (post.status === 'draft' ? '<span class="status-badge">草稿 · 仅管理员可见</span>' : '') + '<span>' + number(post.readingMinutes || 1) + ' 分钟阅读</span></div><h1 id="post-title">' + escape(post.title) + '</h1><div class="author-line">' + (avatar ? '<img class="author-avatar" alt="" src="' + escape(avatar) + '">' : '') + '<span>' + escape(post.author?.displayName || 'Brclio') + '</span><time>' + escape(date(post.publishedAt || post.updatedAt)) + '</time></div>' + (post.excerpt ? '<p class="article-description">' + escape(post.excerpt) + '</p>' : '') + '</header>' + (cover ? '<img class="article-cover" alt="文章封面" src="' + escape(cover) + '" referrerpolicy="no-referrer">' : '') + '<div class="article-content" id="article-content"></div><div class="tag-list">' + (post.tags || []).map(tag => '<a class="tag" href="' + escape(link({ tag })) + '" data-tag="' + escape(tag) + '">#' + escape(tag) + '</a>').join('') + '</div><div class="reader-end"><div class="reaction-actions"><button type="button" class="secondary" data-reaction="like" aria-pressed="false"></button><button type="button" class="secondary" data-reaction="favorite" aria-pressed="false"></button><button type="button" class="secondary" data-action="copy-link">复制链接 ↗</button></div><p class="reading-count" id="view-count"></p></div></article><section class="comments-section" aria-labelledby="comments-title"><div class="section-heading"><h2 id="comments-title">一起聊聊</h2><span class="small-note" id="comments-count"></span></div><div id="comment-compose"></div><div id="comments" aria-live="polite"></div><div class="comment-pagination" id="comment-pagination"></div></section></div><aside class="reader-aside"><h2>这篇文章的路标</h2><nav id="toc" class="toc" aria-label="文章目录"></nav></aside></div>';
    $('#article-content').innerHTML = window.BrclioBlogContent.renderMarkdown(post.content || '');
    $('#article-content').querySelectorAll('h1,h2,h3').forEach((heading, index) => { heading.id = 'section-' + index; const anchor = document.createElement('a'); anchor.href = '#' + heading.id; anchor.textContent = heading.textContent; $('#toc').appendChild(anchor); });
    renderCounts();
    $('#comment-compose').innerHTML = post.commentsEnabled === false ? '<p class="small-note">作者暂时关闭了新评论，已发表的评论仍可阅读。</p>' : !user ? '<p class="small-note"><a class="text-button" href="/?category=mine">登录后，写下你的想法 ↗</a></p>' : '<form class="comment-form" id="comment-form"><label class="small-note" for="comment-content">分享你的想法，保持友善。</label><textarea id="comment-content" name="content" maxlength="1000" required placeholder="读到这里，你有什么想法？"></textarea><div class="comment-form-footer"><span class="small-note">最多 1000 字 · 公开展示昵称与评论</span><button class="primary" type="submit">发表留言 ↗</button></div></form>';
  }
  function renderCounts() {
    if (!currentPost || !$('#view-count')) return;
    $('[data-reaction="like"]').textContent = (interaction.liked ? '已赞' : '点赞') + ' · ' + number(currentPost.counts?.likes);
    $('[data-reaction="like"]').setAttribute('aria-pressed', String(!!interaction.liked));
    $('[data-reaction="favorite"]').textContent = (interaction.favorited ? '已收藏' : '收藏') + ' · ' + number(currentPost.counts?.favorites);
    $('[data-reaction="favorite"]').setAttribute('aria-pressed', String(!!interaction.favorited));
    $('#view-count').textContent = number(currentPost.counts?.views) + ' 次阅读';
    $('#comments-count').textContent = number(currentPost.counts?.comments) + ' 条留言';
  }
  async function loadReader(id, epoch) {
    $('#blog-reader').innerHTML = empty('翻开这一篇…', '正在加载文章与留言。');
    try {
      const result = await api('/posts/' + encodeURIComponent(id), {}, epoch); renderReader(result); commentPage = 1;
      void loadComments(epoch);
      if (result.post.status === 'published') api('/posts/' + encodeURIComponent(id) + '/view', { method: 'POST', data: { visitorId: visitorId() } }, epoch).then(value => { if (value.counts) currentPost.counts = { ...currentPost.counts, views: Math.max(currentPost.counts?.views || 0, value.counts.views || 0) }; renderCounts(); }).catch(() => {});
    } catch (error) { if (epoch === generation) { title('文章暂不可读'); $('#blog-reader').innerHTML = empty('这篇文章暂时无法阅读。', error.message || '文章可能已经撤回，请稍后再试。', true) + '<a class="text-button" href="/blog/" data-view="list">← 返回文章列表</a>'; } }
  }
  async function loadComments(epoch = generation) {
    if (!currentPost || !$('#comments')) return;
    const id = currentPost.id, request = ++commentsRequest; $('#comments').textContent = '正在加载留言…';
    try {
      const result = await api('/posts/' + encodeURIComponent(id) + '/comments?page=' + commentPage + '&pageSize=20', {}, epoch);
      if (request !== commentsRequest || currentPost?.id !== id) return;
      $('#comments').innerHTML = result.comments?.length ? result.comments.map(comment => '<article class="comment"><div class="comment-heading"><strong>' + escape(comment.author?.displayName || '悦创读者') + '</strong><time>' + escape(date(comment.createdAt)) + '</time>' + (comment.canDelete ? '<button type="button" class="text-button" data-delete-comment="' + escape(comment.id) + '">删除</button>' : '') + '</div><p class="comment-body">' + escape(comment.content) + '</p></article>').join('') : '<p class="small-note">还没有留言，第一份想法也许来自你。</p>';
      const pages = Math.max(1, Math.ceil((result.total || 0) / (result.pageSize || 20))); commentPage = result.page || commentPage;
      setReaderMutationPending(readerMutationPending);
      $('#comment-pagination').innerHTML = pages > 1 ? '<button class="text-button" data-comment-page="' + (commentPage - 1) + '" ' + (commentPage === 1 ? 'disabled' : '') + '>← 上一页</button><span>' + commentPage + ' / ' + pages + '</span><button class="text-button" data-comment-page="' + (commentPage + 1) + '" ' + (commentPage === pages ? 'disabled' : '') + '>下一页 →</button>' : '';
    } catch (error) { if (request === commentsRequest && epoch === generation && $('#comments')) $('#comments').innerHTML = '<p class="small-note">留言加载失败。<button type="button" class="text-button" data-action="retry-comments">再试一次 ↗</button></p>'; }
  }
  function draftKey(id) { return 'brclio.blog-draft.v1:' + user.id + ':' + (id || 'new'); }
  function readEditor() {
    const form = $('#editor-form');
    return { title: form.elements.title.value, excerpt: form.elements.excerpt.value, category: form.elements.category.value, tags: form.elements.tags.value.split(/[,，]/).map(value => value.trim()).filter(Boolean), coverUrl: form.elements.coverUrl.value.trim(), content: form.elements.content.value, commentsEnabled: form.elements.commentsEnabled.checked };
  }
  function writeEditor(values) {
    const form = $('#editor-form');
    fields.forEach(name => { form.elements[name].value = name === 'tags' ? (values.tags || []).join(', ') : values[name] || ''; });
    form.elements.commentsEnabled.checked = values.commentsEnabled !== false;
    $('#editor-preview').innerHTML = window.BrclioBlogContent.renderMarkdown(values.content || ''); updateWordCount();
  }
  function updateWordCount() { const value = $('#editor-form')?.elements.content.value || ''; $('#word-count').textContent = number(value.length) + ' 字符 · 约 ' + number(window.BrclioBlogContent.readingMinutes(value)) + ' 分钟阅读'; }
  function renderEditor(post = {}) {
    editor = { ...post }; dirty = false; title(post.id ? '编辑文章' : '写篇文章');
    $('#blog-editor').innerHTML = '<div class="page-heading editor-heading"><div><p class="eyebrow">THE WRITING ROOM</p><h1 id="editor-title">' + (post.id ? '接着，把它写好。' : '让一个想法，有处落笔。') + '</h1><p class="intro-description">用 Markdown 安静书写，随时预览。发布后，文字就会抵达网页和小程序。</p></div><span class="heading-mark" aria-hidden="true">✎</span></div><div id="draft-recovery" class="recovery" hidden><p id="draft-recovery-text"></p><button type="button" class="text-button" data-action="restore-draft">恢复文字</button><button type="button" class="text-button" data-action="discard-draft">丢弃本机草稿</button></div><form id="editor-form" class="editor-form"><div class="editor-fields"><label class="editor-field full">文章标题<input name="title" maxlength="120" required placeholder="给这一篇，取个好名字"></label><label class="editor-field full">内容摘要<textarea name="excerpt" maxlength="300" placeholder="用一两句话介绍这篇文章，留空则从正文提取。"></textarea></label><label class="editor-field">分类<input name="category" maxlength="40" placeholder="例如：编程、学习、生活"></label><label class="editor-field">标签<input name="tags" maxlength="210" placeholder="用逗号分隔，最多 8 个"><small>每个标签最多 24 字。</small></label><label class="editor-field full">封面图片链接<input name="coverUrl" type="url" maxlength="2048" placeholder="https://…（选填）"><small>支持 HTTPS 图片；正文可使用 ![图片说明](https://…) 插入配图。</small></label></div><div class="editor-toolbar"><div class="format-actions" role="group" aria-label="Markdown 格式"><button type="button" data-format="heading" title="插入二级标题">标题</button><button type="button" data-format="bold" title="加粗选中文字"><strong>B</strong></button><button type="button" data-format="italic" title="倾斜选中文字"><em>I</em></button><button type="button" data-format="link">链接</button><button type="button" data-format="image">图片</button><button type="button" data-format="list">列表</button><button type="button" data-format="quote">引用</button><button type="button" data-format="code">代码</button></div><div class="editor-mode" role="group" aria-label="编辑模式"><button type="button" data-editor-mode="write" aria-pressed="true">编写</button><button type="button" data-editor-mode="preview" aria-pressed="false">预览</button></div></div><label for="article-body" class="small-note">文章正文（Markdown）</label><textarea id="article-body" name="content" maxlength="100000" required placeholder="从这里开始…\n\n## 小标题\n\n记下一点值得分享的事。"></textarea><div id="editor-preview" class="editor-preview article-content" hidden></div><div class="editor-status-line"><span id="draft-status" class="small-note">' + (post.id ? '云端版本 ' + number(post.revision) + ' · ' + escape(date(post.updatedAt)) : '输入后自动保存在当前账号的本机草稿中。') + '</span><span id="word-count" class="small-note"></span></div><label class="editor-checkbox"><input name="commentsEnabled" type="checkbox" checked>允许读者评论</label><div class="editor-actions"><button class="secondary" type="button" data-save="draft">' + (post.status === 'published' ? '撤回为草稿' : '保存草稿') + '</button><button class="primary" type="button" data-save="published">' + (post.status === 'published' ? '更新已发布文章 ↗' : '发布文章 ↗') + '</button><button class="text-button" type="button" data-action="back-admin">返回管理</button>' + (post.id ? '<button class="danger" type="button" data-action="delete-post">删除文章</button>' : '') + '</div></form>';
    writeEditor(post);
    try {
      const cached = JSON.parse(window.localStorage.getItem(draftKey(post.id)) || 'null');
      if (cached?.version === 1 && cached.userId === user.id && cached.postId === (post.id || '') && cached.fields && typeof cached.fields.content === 'string') {
        loadedDraft = cached; $('#draft-recovery').hidden = false;
        $('#draft-recovery-text').textContent = '找到 ' + new Date(cached.at).toLocaleString('zh-CN') + ' 的本机草稿。' + (cached.revision !== (post.revision || 0) ? '云端已有新版本，恢复后请先比较再保存。' : '');
      }
    } catch (_) { $('#draft-status').textContent = '本机草稿暂不可读取，请及时保存到云端。'; }
  }
  async function loadEditor(epoch) {
    if (!canWrite) { title('写作权限'); $('#blog-editor').innerHTML = '<div class="editor-disabled">' + empty('这里留给写作者。', '请先登录已授权的管理员账号。写作权限由网站管理者设置。') + '<a class="primary" href="/?category=mine">前往我的账号 ↗</a></div>'; return; }
    const id = query.get('edit');
    if (!id) return renderEditor();
    $('#blog-editor').innerHTML = empty('拿出你的草稿…', '正在读取文章最新版本。');
    try { const result = await api('/posts/' + encodeURIComponent(id), {}, epoch); if (!result.canEdit) throw new Error('当前账号没有编辑权限。'); renderEditor(result.post); }
    catch (error) { if (epoch === generation) $('#blog-editor').innerHTML = empty('这次没能打开编辑器。', error.message, true); }
  }
  function editorBusy(value) { busy = value; $('#editor-form')?.setAttribute('aria-busy', String(value)); $('#editor-form')?.querySelectorAll('button,input,textarea').forEach(element => { element.disabled = value; }); }
  async function saveArticle(status) {
    if (!editor || busy || pendingConfirmation) return;
    const editing = editor, epoch = generation;
    const form = $('#editor-form'), data = readEditor();
    if (!form.reportValidity()) return;
    if (!data.content.trim() || !data.title.trim()) { notice('先写好标题和正文，再保存。', true); return; }
    if (data.tags.length > 8 || data.tags.some(tag => tag.length > 24)) { notice('标签最多 8 个，每个最多 24 字。', true); return; }
    if (data.coverUrl && (!/^https:\/\//i.test(data.coverUrl) || !safeImage(data.coverUrl))) { notice('封面请使用有效的 HTTPS 图片链接。', true); return; }
    if (editing.recoveryNeedsReview && !await confirmAction({ heading: '确认替换云端内容？', message: '这份草稿基于版本 ' + editing.draftBaseRevision + '，云端当前为版本 ' + editing.revision + '。请先在另一个页面比较云端文章，核对后再用当前文字替换。', accept: '已核对，继续保存', danger: true })) return;
    if (editor !== editing || epoch !== generation || stopped) return;
    if (editing.status === 'published' && status === 'draft' && !await confirmAction({ heading: '撤回这篇文章？', message: '撤回后，网页和小程序中的读者将无法访问这篇文章。文字会保留为云端草稿。', subject: data.title, accept: '撤回为草稿', danger: true })) return;
    if (status === 'published' && editing.status !== 'published' && !await confirmAction({ heading: '确认发布这篇文章？', message: '发布后，网页和小程序中的所有读者都能阅读这篇文章。', subject: data.title, accept: '确认发布 ↗', cancel: '继续编辑' })) return;
    if (editor !== editing || epoch !== generation || stopped) return;
    rememberDraft(); notice(); editorBusy(true);
    try {
      const oldKey = draftKey(editor.id);
      const result = await api('/admin/posts' + (editor.id ? '/' + encodeURIComponent(editor.id) : ''), { method: editor.id ? 'PUT' : 'POST', data: { ...data, status, ...(editor.id ? { revision: editor.revision } : {}) } });
      try { window.localStorage.removeItem(oldKey); } catch (_) {}
      dirty = false; const saved = result.post; renderEditor(saved);
      window.history.replaceState({}, '', link({ view: 'write', edit: saved.id })); query = new URLSearchParams(window.location.search);
      notice(status === 'published' ? '文章已发布，网页与小程序现在都能读到。' : '草稿已保存到云端。');
    } catch (error) { fail(error); if (error?.status === 409 || /conflict|版本/.test(error?.code || error?.message || '')) notice('云端已有新版本，本次文字仍保留在本机。请复制当前正文或另开页面比较后，再重新加载文章。', true); }
    finally { editorBusy(false); }
  }
  async function route() {
    closeConfirmation();
    const epoch = ++generation; commentsRequest += 1; notice(); currentPost = null; editor = null; commentPage = 1; readerMutationPending = false;
    const mode = view(); setTab(mode);
    $('#blog-list').hidden = !['list', 'saved', 'admin'].includes(mode); $('#blog-reader').hidden = mode !== 'post'; $('#blog-editor').hidden = mode !== 'write';
    if (mode === 'post') return loadReader(query.get('post'), epoch);
    if (mode === 'write') return loadEditor(epoch);
    if (!['list', 'saved', 'admin'].includes(mode)) return navigate({});
    return loadList(epoch);
  }
  function inputChanged() {
    if (!editor || busy) return;
    dirty = true; updateWordCount(); $('#draft-status').textContent = '正在保存本机草稿…';
    clearTimeout(autosaveTimer); autosaveTimer = window.setTimeout(rememberDraft, 500);
  }
  function setReaderMutationPending(value) {
    readerMutationPending = value;
    $('#blog-reader').querySelectorAll('[data-reaction],[data-delete-comment],#comment-form button,#comment-form textarea').forEach(element => { element.disabled = value; });
    $('#comment-form')?.setAttribute('aria-busy', String(value));
  }
  async function mutateReader(action) {
    if (readerMutationPending || !currentPost) return;
    const epoch = generation; setReaderMutationPending(true);
    try { await action(); } catch (error) { fail(error); }
    finally { if (epoch === generation) setReaderMutationPending(false); }
  }
  async function react(kind) {
    if (!user) { notice('登录后即可点赞、收藏。上方「登录 / 注册」可以进入账号页。', true); return; }
    await mutateReader(async () => {
      const id = currentPost.id;
      const result = await api('/posts/' + encodeURIComponent(id) + '/' + kind, { method: 'PUT', data: { active: !interaction[kind === 'like' ? 'liked' : 'favorited'] } });
      interaction = result.interaction; currentPost.counts = result.counts; renderCounts();
    });
  }
  document.addEventListener('click', async event => {
    const target = event.target.closest('a,button'); if (!target || target.disabled || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button > 0) return;
    if (pendingConfirmation) { event.preventDefault(); return; }
    if (target.dataset.view !== undefined) { event.preventDefault(); navigate(target.dataset.view === 'list' ? {} : { view: target.dataset.view }); return; }
    if (target.dataset.post !== undefined) { event.preventDefault(); navigate({ post: target.dataset.post }); return; }
    if (target.dataset.edit !== undefined) { event.preventDefault(); navigate({ view: 'write', edit: target.dataset.edit }); return; }
    if (target.dataset.page !== undefined) { navigate(listQuery(Number(target.dataset.page))); return; }
    if (target.dataset.category !== undefined) { state.category = target.dataset.category; navigate({ ...listQuery(1), category: state.category }); return; }
    if (target.dataset.tag !== undefined) { event.preventDefault(); state.tag = state.tag === target.dataset.tag ? '' : target.dataset.tag; navigate({ ...(view() === 'post' ? {} : listQuery(1)), tag: state.tag }); return; }
    if (target.dataset.reaction) { await react(target.dataset.reaction); return; }
    if (target.dataset.commentPage) { commentPage = Number(target.dataset.commentPage); void loadComments(); return; }
    if (target.dataset.deleteComment) {
      if (readerMutationPending || !currentPost) return;
      const post = currentPost, epoch = generation;
      if (!await confirmAction({ heading: '删除这条留言？', message: '删除后，这条留言将不再展示。此操作无法撤销。', accept: '删除留言', danger: true }) || currentPost !== post || epoch !== generation || readerMutationPending) return;
      await mutateReader(async () => {
        const result = await api('/posts/' + encodeURIComponent(currentPost.id) + '/comments/' + encodeURIComponent(target.dataset.deleteComment), { method: 'DELETE' });
        currentPost.counts = result.counts; renderCounts(); await loadComments();
      }); return;
    }
    if (target.dataset.save) { await saveArticle(target.dataset.save); return; }
    if (target.dataset.format) {
      const textarea = $('#editor-form').elements.content, start = textarea.selectionStart, end = textarea.selectionEnd, selected = textarea.value.slice(start, end);
      const formats = { heading: ['\n## ', '\n', '小标题'], bold: ['**', '**', '加粗文字'], italic: ['*', '*', '倾斜文字'], link: ['[', '](https://)', '链接文字'], image: ['![', '](https://)', '图片说明'], list: ['\n- ', '\n', '列表内容'], quote: ['\n> ', '\n', '引用文字'], code: ['\n```\n', '\n```\n', '代码'] };
      const [before, after, fallback] = formats[target.dataset.format]; textarea.setRangeText(before + (selected || fallback) + after, start, end, 'end'); textarea.focus(); inputChanged(); return;
    }
    if (target.dataset.editorMode) {
      const preview = target.dataset.editorMode === 'preview'; $('#editor-form').elements.content.hidden = preview; $('#editor-preview').hidden = !preview;
      $('#editor-preview').innerHTML = window.BrclioBlogContent.renderMarkdown($('#editor-form').elements.content.value);
      document.querySelectorAll('[data-editor-mode]').forEach(element => element.setAttribute('aria-pressed', String(element === target))); return;
    }
    switch (target.dataset.action) {
      case 'retry': void route(); break;
      case 'retry-comments': void loadComments(); break;
      case 'back-admin': navigate({ view: 'admin' }); break;
      case 'copy-link':
        try { await window.navigator.clipboard.writeText(window.location.origin + link({ post: currentPost.id })); notice('文章链接已复制。'); } catch (_) { notice('请复制浏览器地址栏中的文章链接。'); } break;
      case 'restore-draft':
        if (loadedDraft) {
          editor.draftBaseRevision = loadedDraft.revision;
          editor.recoveryNeedsReview = loadedDraft.revision !== (editor.revision || 0);
          writeEditor(loadedDraft.fields); dirty = true; $('#draft-recovery').hidden = true; rememberDraft();
          notice(editor.recoveryNeedsReview ? '已恢复旧版本的本机文字。保存前须比较云端文章，并确认替换。' : '已恢复本机文字。保存前请检查内容与云端版本。');
        } break;
      case 'discard-draft': {
        const editing = editor;
        if (editing && loadedDraft && await confirmAction({ heading: '丢弃本机恢复草稿？', message: '这份本机恢复草稿将被移除，云端文章不会改变。', accept: '丢弃草稿', danger: true }) && editor === editing) { try { window.localStorage.removeItem(draftKey(editor.id)); } catch (_) {} loadedDraft = null; $('#draft-recovery').hidden = true; } break;
      }
      case 'delete-post': {
        const editing = editor, epoch = generation;
        if (!editing?.id || busy || !await confirmAction({ heading: '永久删除这篇文章？', message: '文章及相关互动将不再展示，此操作无法撤销。', subject: editing.title, accept: '永久删除', danger: true }) || editor !== editing || epoch !== generation) break;
        editorBusy(true);
        try { await api('/admin/posts/' + encodeURIComponent(editor.id), { method: 'DELETE', data: { revision: editor.revision } }); try { window.localStorage.removeItem(draftKey(editor.id)); } catch (_) {} dirty = false; busy = false; navigate({ view: 'admin' }, { saved: true }); notice('文章已删除。'); }
        catch (error) { fail(error); editorBusy(false); } break;
      }
    }
  });
  $('#search-form').addEventListener('submit', event => { event.preventDefault(); state.q = $('#search').value.trim(); navigate(listQuery(1)); });
  $('#clear-filters').addEventListener('click', () => navigate(view() === 'list' ? {} : { view: view() }));
  document.addEventListener('input', event => { if (event.target.closest('#editor-form')) inputChanged(); });
  document.addEventListener('change', event => { if (event.target.closest('#editor-form')) inputChanged(); });
  document.addEventListener('submit', async event => {
    if (event.target.id === 'editor-form') { event.preventDefault(); return; }
    if (event.target.id !== 'comment-form') return;
    event.preventDefault(); const form = event.target, content = form.elements.content.value.trim(); if (!content || readerMutationPending || pendingConfirmation) return;
    await mutateReader(async () => {
      const result = await api('/posts/' + encodeURIComponent(currentPost.id) + '/comments', { method: 'POST', data: { content } });
      form.elements.content.value = ''; currentPost.counts = result.counts; renderCounts(); commentPage = 1; await loadComments(); notice('留言已发表。');
    });
  });
  window.addEventListener('beforeunload', event => { if (dirty) { rememberDraft(); event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('pagehide', () => { rememberDraft(); stopped = true; closeConfirmation(); clearTimeout(autosaveTimer); });
  window.addEventListener('pageshow', event => { if (event.persisted) { stopped = false; void initialize(); } });
  window.addEventListener('popstate', () => { rememberDraft(); dirty = false; query = new URLSearchParams(window.location.search); state.page = Number(query.get('page')) || 1; for (const name of ['q', 'category', 'tag']) state[name] = query.get(name) || ''; void route(); });
  async function initialize() {
    runtime = window.BrclioAccount;
    try {
      await runtime?.ready;
      if (!window.BrclioBlogContent) throw new Error('文章排版组件未能加载，请刷新页面。');
      const result = await api('/me'); user = result.user || null; canWrite = !!result.canWrite;
      document.querySelectorAll('[data-view="admin"],[data-view="write"]').forEach(element => { element.hidden = !canWrite; });
      $('#account-entry').textContent = user ? (user.displayName || '我的账号') + ' ↗' : '登录 / 注册 ↗';
      if (runtime?.onAccountChange) runtime.onAccountChange(snapshot => { if ((snapshot.user?.id || null) !== (user?.id || null)) { rememberDraft(); ++generation; closeConfirmation(); window.location.reload(); } });
      await route();
    } catch (error) {
      if (stopped) return;
      user = null; canWrite = false; notice(error.message || '账号状态暂时无法读取，互动功能稍后再试。', true);
      if (['list', 'saved', 'admin'].includes(view()) && window.BrclioBlogContent) await loadList(generation);
      else { $('#blog-list').hidden = true; const target = view() === 'write' ? $('#blog-editor') : $('#blog-reader'); target.hidden = false; target.innerHTML = empty('这次没能打开博客。', error.message, true); }
    }
  }
  void initialize();
})();
