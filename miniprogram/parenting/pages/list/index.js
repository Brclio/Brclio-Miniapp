'use strict';
const { COURSE, SECTIONS, ARTICLES } = require('../../data/catalog');
const PAGE_SIZE = 30;

Page({
  data: {
    course: COURSE, sections: SECTIONS, sectionId: '', query: '',
    articles: [], total: COURSE.total, hasMore: false, error: ''
  },
  onLoad(options) {
    const sectionId = options && options.section;
    if (SECTIONS.some(section => section.id === sectionId)) this.setData({ sectionId });
    this.applyFilters();
  },
  applyFilters() {
    const query = this.data.query.trim().toLocaleLowerCase();
    this._matches = ARTICLES.filter(article =>
      (!this.data.sectionId || article.sectionId === this.data.sectionId) &&
      (!query || article.title.toLocaleLowerCase().includes(query))
    );
    this._visibleCount = PAGE_SIZE;
    this.updateArticles();
  },
  updateArticles() {
    const articles = this._matches.slice(0, this._visibleCount).map((article, index, items) => ({
      id: article.id, title: article.title, sectionTitle: article.sectionTitle,
      order: String(article.order).padStart(3, '0'), readingMinutes: article.readingMinutes,
      sectionStart: !index || article.sectionId !== items[index - 1].sectionId
    }));
    this.setData({ articles, total: this._matches.length, hasMore: articles.length < this._matches.length, error: '' });
  },
  inputSearch(event) {
    this.setData({ query: String(event.detail.value || '').slice(0, 80) });
    this.applyFilters();
  },
  selectSection(event) {
    const sectionId = event.currentTarget.dataset.id;
    if (sectionId !== '' && !SECTIONS.some(section => section.id === sectionId)) return;
    this.setData({ sectionId });
    this.applyFilters();
  },
  clearSearch() { this.setData({ query: '' }); this.applyFilters(); },
  clearFilters() { this.setData({ query: '', sectionId: '' }); this.applyFilters(); },
  loadMore() {
    if (!this.data.hasMore) return;
    this._visibleCount += PAGE_SIZE;
    this.updateArticles();
  },
  onReachBottom() { this.loadMore(); },
  openArticle(event) {
    const article = ARTICLES.find(item => item.id === event.currentTarget.dataset.id);
    if (!article || this._opening) return;
    this._opening = true;
    this.setData({ error: '' });
    wx.navigateTo({
      url: article.readerPath + '?id=' + encodeURIComponent(article.id),
      fail: () => this.setData({ error: '文章暂时没能打开，请检查网络后重试。' }),
      complete: () => { this._opening = false; }
    });
  },
  onShareAppMessage() {
    return { title: COURSE.title, path: '/parenting/pages/list/index' + (this.data.sectionId ? '?section=' + encodeURIComponent(this.data.sectionId) : '') };
  },
  onShareTimeline() { return { title: COURSE.title, query: this.data.sectionId ? 'section=' + encodeURIComponent(this.data.sectionId) : '' }; }
});
