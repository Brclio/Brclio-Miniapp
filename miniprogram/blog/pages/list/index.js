'use strict';
const blog = require('../../lib/client');
Page({
  data: { posts: [], categories: [], tags: [], query: '', category: '', tag: '', saved: false, user: null, canWrite: false,
    page: 0, total: 0, loading: false, error: '', hasMore: false },
  onLoad(options) {
    blog.enter();
    this._alive = true; this._visible = false; this._loadVersion = 0; this._loaded = false;
    this._identity = (blog.account.getCachedUser() || {}).id || '';
    this.setData({ saved: options && options.saved === '1', category: String(options && options.category || '').slice(0, 60), tag: String(options && options.tag || '').slice(0, 32) });
    this._unsubscribe = blog.account.subscribe(snapshot => {
      const identity = snapshot.user && snapshot.user.id || '';
      this.setData({ user: snapshot.user || null });
      if (identity !== this._identity) {
        this._identity = identity; this._loadVersion += 1; this._loaded = false;
        this.setData({ posts: [], page: 0, total: 0, canWrite: false, loading: false, error: '' });
        if (this._visible) this.reload(false);
      }
    });
  },
  onShow() { this._visible = true; this.setData({ user: blog.account.getCachedUser() }); return this._loaded ? this.restore() : this.reload(false); },
  onHide() { this._visible = false; this._loadVersion += 1; this.setData({ loading: false }); },
  onUnload() { this._alive = false; this._visible = false; this._loadVersion += 1; if (this._unsubscribe) this._unsubscribe(); },
  filters() { return { q: this.data.query.trim(), category: this.data.category, tag: this.data.tag, saved: this.data.saved ? 1 : '' }; },
  listPath(page) { return '/posts?' + blog.query({ ...(this._filters || this.filters()), page, pageSize: 12 }); },
  applyListing(pages, me) {
    const posts = [], seen = new Set();
    pages.forEach(result => result.posts.forEach(post => { if (!seen.has(post.id)) { seen.add(post.id); posts.push(blog.post(post)); } }));
    const first = pages[0], last = pages[pages.length - 1];
    // Transfer summaries in page-sized patches, including after a long reading
    // visit, rather than sending every accumulated page across the bridge.
    if (posts.length !== this.data.posts.length || posts.some((post, index) => post.id !== this.data.posts[index].id)) this.setData({ posts: [] });
    for (let index = 0; index < posts.length; index += 12) {
      const patch = {};
      posts.slice(index, index + 12).forEach((post, offset) => { patch['posts[' + (index + offset) + ']'] = post; });
      this.setData(patch);
    }
    this.setData({ error: '', loading: false, categories: first.categories || [], tags: first.tags || [], page: last.page, total: last.total,
      hasMore: last.page * last.pageSize < last.total, user: me.user, canWrite: !!me.canWrite });
    this._loaded = true;
  },
  async restore() {
    const version = ++this._loadVersion, paths = Array.from({ length: Math.max(1, this.data.page) }, (_, index) => this.listPath(index + 1));
    const pages = paths.map(path => blog.peek(path)), me = blog.peek('/me');
    if (pages.every(Boolean) && me) { this.applyListing(pages, me); return; }
    this.setData({ loading: true, error: '' });
    try {
      const results = await Promise.all(paths.map((path, index) => pages[index] || blog.request(path)).concat(me || blog.request('/me')));
      if (this.current(version)) this.applyListing(results.slice(0, paths.length), results[paths.length]);
    } catch (error) { if (this.current(version)) this.setData({ error: blog.message(error) }); }
    finally { if (this.current(version)) this.setData({ loading: false }); }
  },
  async reload(fresh = true) {
    const version = ++this._loadVersion;
    this._loaded = false; this._filters = this.filters();
    this.setData({ loading: true, error: '', posts: [], page: 0, total: 0, hasMore: false });
    try {
      const [listing, me] = await Promise.all([
        blog.request(this.listPath(1), 'GET', undefined, { fresh: fresh !== false }),
        blog.request('/me', 'GET', undefined, { fresh: fresh !== false })
      ]);
      if (!this.current(version)) return;
      this.applyListing([listing], me);
    } catch (error) {
      if (this.current(version)) this.setData({ error: blog.isAuthError(error) && this.data.saved ? '登录后可查看你在网页和小程序收藏的文章。' : blog.message(error) });
    } finally { if (this.current(version)) this.setData({ loading: false }); }
  },
  current(version) { return this._alive && this._visible && version === this._loadVersion; },
  async loadMore() {
    if (this.data.loading || !this.data.hasMore) return;
    const version = this._loadVersion, next = this.data.page + 1;
    this.setData({ loading: true, error: '' });
    try {
      const result = await blog.request(this.listPath(next));
      if (!this.current(version)) return;
      const known = new Set(this.data.posts.map(post => post.id));
      const additions = result.posts.filter(post => !known.has(post.id)).map(blog.post);
      const patch = { page: result.page, total: result.total, hasMore: result.page * result.pageSize < result.total };
      additions.forEach((post, index) => { patch['posts[' + (this.data.posts.length + index) + ']'] = post; });
      this.setData(patch);
    } catch (error) { if (this.current(version)) this.setData({ error: blog.message(error) }); }
    finally { if (this.current(version)) this.setData({ loading: false }); }
  },
  async onPullDownRefresh() { try { await this.reload(true); } finally { wx.stopPullDownRefresh(); } },
  onReachBottom() { return this.loadMore(); },
  inputSearch(event) { this.setData({ query: String(event.detail.value || '').slice(0, 100) }); },
  search() { return this.reload(false); },
  clearFilters() { this.setData({ query: '', category: '', tag: '' }); return this.reload(false); },
  selectCategory(event) { this.setData({ category: String(event.currentTarget.dataset.category || ''), tag: '' }); return this.reload(false); },
  selectTag(event) { const tag = String(event.currentTarget.dataset.tag || ''); this.setData({ tag: this.data.tag === tag ? '' : tag }); return this.reload(false); },
  switchView(event) { const saved = event.currentTarget.dataset.view === 'saved'; if (saved !== this.data.saved) { this.setData({ saved }); return this.reload(false); } },
  openPost(event) { const id = blog.id(event.currentTarget.dataset.id); if (id) wx.navigateTo({ url: '/blog/pages/article/index?id=' + encodeURIComponent(id) }); },
  openAccount() { blog.login(); },
  copyWritingUrl() { wx.setClipboardData({ data: blog.writingUrl, success() { wx.showToast({ title: '已复制网页写作地址', icon: 'none' }); } }); },
  onShareAppMessage() { return { title: 'Brclio 博客 · 阅读，也留下想法', path: '/blog/pages/list/index' }; }
});
