'use strict';
const blog = require('../../lib/client');
const content = require('../../../lib/blog-content');
Page({
  data: { post: null, htmlChunks: [], contentLoading: false, user: null, canEdit: false, interaction: { liked: false, favorited: false },
    comments: [], commentText: '', commentPage: 0, commentTotal: 0, commentsMore: false,
    loading: false, commentsLoading: false, reactionBusy: '', commentBusy: false, error: '', commentsError: '', actionError: '' },
  onLoad(options) {
    this._id = blog.id(options && options.id); this._alive = true; this._visible = false; this._version = 0; this._commentsVersion = 0; this._countsVersion = 0;
    this._identity = (blog.account.getCachedUser() || {}).id || '';
    this._unsubscribe = blog.account.subscribe(snapshot => {
      const identity = snapshot.user && snapshot.user.id || '';
      if (identity !== this._identity) {
        const clearDraft = !!this._identity; this._identity = identity; this._version += 1; this._commentsVersion += 1;
        this.setData({ user: snapshot.user || null, interaction: { liked: false, favorited: false }, comments: [], canEdit: false,
          post: null, htmlChunks: [], contentLoading: false, loading: false, commentsLoading: false, reactionBusy: '', commentBusy: false, actionError: '', ...(clearDraft ? { commentText: '' } : {}) });
        if (this._visible) this.reload();
      } else if (this._alive) this.setData({ user: snapshot.user || null });
    });
  },
  onShow() { this._visible = true; this.setData({ user: blog.account.getCachedUser() }); return this.reload(); },
  onHide() { this._visible = false; this._version += 1; this._commentsVersion += 1; this.setData({ loading: false, contentLoading: false, commentsLoading: false, reactionBusy: '', commentBusy: false }); },
  onUnload() { this._alive = false; this._visible = false; this._version += 1; this._commentsVersion += 1; if (this._unsubscribe) this._unsubscribe(); },
  current(version) { return this._alive && this._visible && version === this._version; },
  async reload() {
    const version = ++this._version; this._commentsVersion += 1;
    if (!this._id) { this.setData({ loading: false, error: '文章链接不完整，请返回博客列表。', post: null }); return; }
    this.setData({ loading: true, error: '', actionError: '', commentsError: '', comments: [], commentPage: 0, commentsMore: false, commentTotal: 0, htmlChunks: [], contentLoading: true });
    try {
      const result = await blog.request('/posts/' + this._id);
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
      if (result.post.status === 'published') await this.loadComments(true);
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
  async loadComments(reset) {
    if (!this.data.post || (!reset && (this.data.commentsLoading || !this.data.commentsMore))) return;
    const version = this._version, commentVersion = ++this._commentsVersion, page = reset ? 1 : this.data.commentPage + 1;
    this.setData({ commentsLoading: true, commentsError: '' });
    try {
      const result = await blog.request('/posts/' + this._id + '/comments?' + blog.query({ page, pageSize: 20 }));
      if (!this.current(version) || commentVersion !== this._commentsVersion) return;
      const existing = reset ? [] : this.data.comments, known = new Set(existing.map(comment => comment.id));
      const additions = result.comments.filter(comment => !known.has(comment.id)).map(blog.comment);
      const patch = { commentPage: result.page, commentTotal: result.total, commentsMore: result.page * result.pageSize < result.total };
      if (reset) patch.comments = additions;
      else additions.forEach((comment, index) => { patch['comments[' + (existing.length + index) + ']'] = comment; });
      this.setData(patch);
    } catch (error) { if (this.current(version) && commentVersion === this._commentsVersion) this.setData({ commentsError: blog.message(error) }); }
    finally { if (this.current(version) && commentVersion === this._commentsVersion) this.setData({ commentsLoading: false }); }
  },
  moreComments() { return this.loadComments(false); },
  retryComments() { return this.loadComments(true); },
  async onPullDownRefresh() { try { await this.reload(); } finally { wx.stopPullDownRefresh(); } },
  async react(event) {
    const type = event.currentTarget.dataset.type;
    if (!['like', 'favorite'].includes(type) || !this.data.post || this.data.reactionBusy || this.data.commentBusy) return;
    if (!blog.account.getCachedUser()) { blog.login(); return; }
    const version = this._version; this._countsVersion += 1;
    this.setData({ reactionBusy: type, actionError: '' });
    try {
      const result = await blog.request('/posts/' + this._id + '/' + type, 'PUT', { active: !this.data.interaction[type === 'like' ? 'liked' : 'favorited'] });
      if (this.current(version)) this.setData({ interaction: result.interaction, 'post.counts': result.counts });
    } catch (error) { if (this.current(version)) { this.setData({ actionError: blog.message(error) }); if (blog.isAuthError(error)) blog.login(); } }
    finally { if (this.current(version)) this.setData({ reactionBusy: '' }); }
  },
  inputComment(event) { this.setData({ commentText: String(event.detail.value || '').slice(0, 1000) }); },
  async submitComment() {
    if (!this.data.post || !this.data.post.commentsEnabled || this.data.commentBusy || this.data.reactionBusy) return;
    if (!blog.account.getCachedUser()) { blog.login(); return; }
    const text = this.data.commentText.trim();
    if (!text) { this.setData({ actionError: '先写一点想法，再发布评论。' }); return; }
    const version = this._version; this._countsVersion += 1;
    this.setData({ commentBusy: true, actionError: '' });
    try {
      const result = await blog.request('/posts/' + this._id + '/comments', 'POST', { content: text });
      if (!this.current(version)) return;
      this.setData({ commentText: '', 'post.counts': result.counts });
      wx.showToast({ title: '评论已发布', icon: 'success' });
      await this.loadComments(true);
    } catch (error) { if (this.current(version)) { this.setData({ actionError: blog.message(error) }); if (blog.isAuthError(error)) blog.login(); } }
    finally { if (this.current(version)) this.setData({ commentBusy: false }); }
  },
  deleteComment(event) {
    const id = blog.id(event.currentTarget.dataset.id), comment = this.data.comments.find(item => item.id === id), version = this._version;
    if (!comment || !comment.canDelete || this.data.commentBusy || this.data.reactionBusy) return;
    wx.showModal({ title: '删除这条评论？', content: '删除后不再公开展示，且无法在这里恢复。', confirmText: '删除', confirmColor: '#e84a5f',
      success: async result => {
        if (!result.confirm || !this.current(version)) return;
        this._countsVersion += 1; this.setData({ commentBusy: true, actionError: '' });
        try {
          const removed = await blog.request('/posts/' + this._id + '/comments/' + id, 'DELETE');
          if (!this.current(version)) return;
          this.setData({ 'post.counts': removed.counts });
          await this.loadComments(true);
        } catch (error) { if (this.current(version)) this.setData({ actionError: blog.message(error) }); }
        finally { if (this.current(version)) this.setData({ commentBusy: false }); }
      }
    });
  },
  openAccount() { blog.login(); },
  openList() { wx.navigateTo({ url: '/blog/pages/list/index' }); },
  copyLink() { if (this._id) wx.setClipboardData({ data: blog.writingUrl.split('?')[0] + '?post=' + encodeURIComponent(this._id) }); },
  copyWritingUrl() { wx.setClipboardData({ data: blog.writingUrl + '&edit=' + encodeURIComponent(this._id) }); },
  onShareAppMessage() { return { title: this.data.post ? this.data.post.title : 'Brclio 博客', path: '/blog/pages/article/index?id=' + encodeURIComponent(this._id || '') }; },
  onShareTimeline() { return { title: this.data.post ? this.data.post.title : 'Brclio 博客', query: 'id=' + encodeURIComponent(this._id || '') }; }
});
