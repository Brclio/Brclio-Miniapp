'use strict';
const blog = require('../../lib/client');
const content = require('../../../lib/blog-content');
Page({
  data: { post: null, htmlChunks: [], contentLoading: false, user: null, canEdit: false, interaction: { liked: false, favorited: false },
    loading: false, reactionBusy: '', error: '', actionError: '' },
  onLoad(options) {
    blog.enter();
    this._id = blog.id(options && options.id); this._alive = true; this._visible = false; this._version = 0; this._countsVersion = 0; this._loaded = false;
    this._identity = (blog.account.getCachedUser() || {}).id || '';
    this._unsubscribe = blog.account.subscribe(snapshot => {
      const identity = snapshot.user && snapshot.user.id || '';
      if (identity !== this._identity) {
        this._identity = identity; this._version += 1; this._loaded = false;
        this.setData({ user: snapshot.user || null, interaction: { liked: false, favorited: false }, canEdit: false,
          post: null, htmlChunks: [], contentLoading: false, loading: false, reactionBusy: '', actionError: '' });
        if (this._visible) this.reload(false);
      } else if (this._alive) this.setData({ user: snapshot.user || null });
    });
  },
  onShow() { this._visible = true; this.setData({ user: blog.account.getCachedUser() }); return this.restore(); },
  onHide() { if (this.data.contentLoading) this._loaded = false; this._visible = false; this._version += 1; this.setData({ loading: false, contentLoading: false, reactionBusy: '' }); },
  onUnload() { this._alive = false; this._visible = false; this._version += 1; if (this._unsubscribe) this._unsubscribe(); },
  current(version) { return this._alive && this._visible && version === this._version; },
  async restore() {
    const cached = blog.peek('/posts/' + this._id);
    if (!this._loaded || !cached || !this.data.post || cached.post.revision !== this.data.post.revision) return this.reload(false);
    const summary = blog.post(cached.post); delete summary.content;
    this.setData({ post: summary, interaction: cached.interaction || { liked: false, favorited: false }, canEdit: !!cached.canEdit });
    if (cached.post.status === 'published') this.recordView(this._version);
  },
  async reload(fresh = true) {
    const version = ++this._version;
    this._loaded = false;
    if (!this._id) { this.setData({ loading: false, error: '文章链接不完整，请返回博客列表。', post: null }); return; }
    this.setData({ loading: true, error: '', actionError: '', htmlChunks: [], contentLoading: true });
    try {
      const result = await blog.request('/posts/' + this._id, 'GET', undefined, { fresh: fresh !== false });
      if (!this.current(version)) return;
      // Article source never crosses the native render bridge alongside HTML.
      // Each rich-text chunk is transferred separately to stay below setData's
      // per-call limit even for a long article with many formatted blocks.
      const summary = blog.post(result.post);
      delete summary.content;
      const chunks = content.renderMarkdownChunks(result.post.content);
      this.setData({ post: summary, interaction: result.interaction || { liked: false, favorited: false }, canEdit: !!result.canEdit });
      this.deliverContent(chunks, 0, version);
      wx.setNavigationBarTitle({ title: result.post.title.slice(0, 20) });
      if (result.post.status === 'published') this.recordView(version);
      if (this.current(version)) this._loaded = true;
    } catch (error) { if (this.current(version)) this.setData({ error: blog.message(error), post: null, htmlChunks: [], contentLoading: false }); }
    finally { if (this.current(version)) this.setData({ loading: false }); }
  },
  deliverContent(chunks, index, version) {
    if (!this.current(version)) return;
    if (index >= chunks.length) { this.setData({ contentLoading: false }); return; }
    this.setData({ ['htmlChunks[' + index + ']']: { key: index, html: chunks[index] } }, () => this.deliverContent(chunks, index + 1, version));
  },
  async recordView(version) {
    const countsVersion = this._countsVersion;
    try {
      const result = await blog.request('/posts/' + this._id + '/view', 'POST', { visitorId: blog.visitorId() });
      if (this.current(version) && countsVersion === this._countsVersion) this.setData({ 'post.counts.views': Math.max(this.data.post.counts.views, result.counts.views) });
    } catch (_) { /* Reading remains available when the optional view write fails. */ }
  },
  async onPullDownRefresh() { try { await this.reload(true); } finally { wx.stopPullDownRefresh(); } },
  async react(event) {
    const type = event.currentTarget.dataset.type;
    if (!['like', 'favorite'].includes(type) || !this.data.post || this.data.reactionBusy) return;
    if (!blog.account.getCachedUser()) { blog.login(); return; }
    const version = this._version; this._countsVersion += 1;
    this.setData({ reactionBusy: type, actionError: '' });
    try {
      const result = await blog.request('/posts/' + this._id + '/' + type, 'PUT', { active: !this.data.interaction[type === 'like' ? 'liked' : 'favorited'] });
      if (this.current(version)) this.setData({ interaction: result.interaction, 'post.counts': result.counts });
    } catch (error) { if (this.current(version)) { this.setData({ actionError: blog.message(error) }); if (blog.isAuthError(error)) blog.login(); } }
    finally { if (this.current(version)) this.setData({ reactionBusy: '' }); }
  },
  openAccount() { blog.login(); },
  openList() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [], previous = pages[pages.length - 2];
    if (previous && previous.route === 'blog/pages/list/index') wx.navigateBack({ delta: 1 });
    else wx.navigateTo({ url: '/blog/pages/list/index' });
  },
  copyLink() { if (this._id) wx.setClipboardData({ data: blog.writingUrl.split('?')[0] + '?post=' + encodeURIComponent(this._id) }); },
  copyWritingUrl() { wx.setClipboardData({ data: blog.writingUrl + '&edit=' + encodeURIComponent(this._id) }); },
  onShareAppMessage() { return { title: this.data.post ? this.data.post.title : 'Brclio 博客', path: '/blog/pages/article/index?id=' + encodeURIComponent(this._id || '') }; },
  onShareTimeline() { return { title: this.data.post ? this.data.post.title : 'Brclio 博客', query: 'id=' + encodeURIComponent(this._id || '') }; }
});
