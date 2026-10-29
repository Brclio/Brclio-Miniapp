'use strict';
const LIST_PATH = '/parenting/pages/list/index';

// A factory in the main package lets both text packages share behavior without
// requiring another subpackage's data or depending on download order.
function createReader({ COURSE, getArticle }) {
  return {
    data: { course: COURSE, article: null, blocks: [], error: '', navigationError: '' },
    onLoad(options) {
      const id = options && options.id;
      const article = typeof id === 'string' ? getArticle(id) : null;
      if (!article) {
        this.setData({ error: '这篇文章暂时找不到，请返回目录重新选择。' });
        return;
      }
      const summary = { ...article };
      delete summary.blocks;
      this.setData({ article: summary, blocks: article.blocks.map((block, index) => ({ ...block, key: index })) });
      if (typeof wx.setNavigationBarTitle === 'function') wx.setNavigationBarTitle({ title: article.title.slice(0, 20) });
    },
    openList() {
      if (this._navigating) return;
      this._navigating = true;
      this.setData({ navigationError: '' });
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
      const listIndex = pages.findIndex(page => page.route === LIST_PATH.slice(1));
      const fail = () => this.setData({ navigationError: '目录暂时没能打开，请检查网络后重试。' });
      const complete = () => { this._navigating = false; };
      if (listIndex >= 0 && listIndex < pages.length - 1) {
        wx.navigateBack({ delta: pages.length - 1 - listIndex, fail, complete });
      } else {
        wx.redirectTo({ url: LIST_PATH, fail, complete });
      }
    },
    openNeighbor(event) {
      const direction = event.currentTarget.dataset.direction;
      if (!this.data.article || !['previous', 'next'].includes(direction) || this._navigating) return;
      const article = this.data.article[direction];
      if (!article) return;
      this._navigating = true;
      this.setData({ navigationError: '' });
      wx.redirectTo({
        url: article.readerPath + '?id=' + encodeURIComponent(article.id),
        fail: () => this.setData({ navigationError: '文章暂时没能打开，请检查网络后重试。' }),
        complete: () => { this._navigating = false; }
      });
    },
    onShareAppMessage() {
      const article = this.data.article;
      return { title: article ? article.title + ' · ' + COURSE.title : COURSE.title,
        path: article ? article.readerPath + '?id=' + encodeURIComponent(article.id) : LIST_PATH };
    },
    onShareTimeline() {
      const article = this.data.article;
      return { title: article ? article.title + ' · ' + COURSE.title : COURSE.title,
        query: article ? 'id=' + encodeURIComponent(article.id) : '' };
    }
  };
}
module.exports = { createReader, LIST_PATH };
