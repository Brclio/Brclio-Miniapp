(function () {
  'use strict';
  const byId = function (id) { return document.getElementById(id); };
  const elements = {
    collections: byId('collections'), grid: byId('project-grid'), mine: byId('mine-panel'),
    loading: byId('loading-panel'), error: byId('error-panel'), empty: byId('empty-panel'),
    title: byId('collection-title'), description: byId('category-description'), eyebrow: byId('category-eyebrow'),
    status: byId('category-status'), retry: byId('retry-button')
  };
  let catalog = null;
  let loading = false;
  const views = ['photography', 'relax', 'mine'];
  function readView() {
    const value = new URLSearchParams(window.location.search).get('category');
    return views.includes(value) ? value : 'photography';
  }
  let selectedView = readView();
  function node(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  }
  function projectCard(project, index) {
    const link = node('a', 'project-card' + (project.kind === 'reaction' ? ' project-card--reaction' : ''));
    link.href = project.path;
    link.setAttribute('aria-label', project.action + '，' + project.description);
    const visual = node('div', 'project-visual');
    if (project.kind === 'reaction') {
      visual.appendChild(byId('duel-art').content.cloneNode(true));
    } else {
      const image = node('img', 'project-image');
      image.src = project.cover;
      image.alt = project.coverAlt;
      image.width = 1086;
      image.height = 1448;
      image.loading = index === 0 ? 'eager' : 'lazy';
      if (index === 0) image.fetchPriority = 'high';
      image.addEventListener('error', function () {
        image.hidden = true;
        visual.classList.add('image-unavailable');
        visual.appendChild(node('span', 'unavailable-copy', '封面暂不可用 · 仍可打开图册'));
      }, { once: true });
      visual.appendChild(image);
    }
    const marker = node('span', 'image-marker', '↗');
    marker.setAttribute('aria-hidden', 'true');
    visual.append(node('span', 'image-disclosure', project.disclosure), marker);
    const content = node('div', 'project-content');
    const topline = node('div', 'project-topline');
    topline.append(node('span', 'project-label', project.label), node('span', 'project-number', 'NO. 0' + (index + 1)));
    content.append(topline, node('h3', 'project-title', project.title), node('p', 'project-subtitle', project.subtitle), node('p', 'project-description', project.description));
    const action = node('div', 'project-action');
    action.append(node('span', '', project.action), node('span', 'project-arrow', '↗'));
    action.lastElementChild.setAttribute('aria-hidden', 'true');
    content.appendChild(action);
    link.append(visual, content);
    return link;
  }
  function renderProjects() {
    if (!catalog || selectedView === 'mine') return;
    const projects = window.BrclioCatalog.activeProjects(catalog, selectedView);
    const relax = selectedView === 'relax';
    byId('project-count').textContent = relax ? projects.length + ' 个轻松体验' : projects.length + ' 个影像项目';
    elements.grid.replaceChildren();
    elements.grid.classList.toggle('project-grid--single', projects.length === 1);
    projects.forEach(function (project, index) { elements.grid.appendChild(projectCard(project, index)); });
    elements.grid.hidden = projects.length === 0;
    elements.empty.hidden = projects.length > 0;
    elements.status.textContent = (relax ? '放松' : '摄影') + '，' + projects.length + ' 个可浏览项目。';
  }
  function selectView(id, updateHistory) {
    if (!views.includes(id)) return;
    if (id === selectedView && updateHistory) {
      window.scrollTo(0, 0);
      byId('main-content').focus({ preventScroll: true });
      return;
    }
    selectedView = id;
    const mine = id === 'mine';
    const relax = id === 'relax';
    elements.collections.hidden = mine;
    elements.mine.hidden = !mine;
    document.querySelectorAll('.main-nav [data-view]').forEach(function (link) {
      const active = link.dataset.view === id;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    byId('breadcrumb').textContent = mine ? '我的' : relax ? '放松' : '摄影';
    document.title = (mine ? '我的' : relax ? '放松一下' : '生活的切片') + ' · Brclio 悦创';
    if (!mine) {
      elements.eyebrow.textContent = relax ? 'TAKE A LITTLE BREAK / 放松' : 'THROUGH THE LENS / 摄影';
      elements.title.replaceChildren(document.createTextNode(relax ? '认真生活，' : '把日常，'), node('span', '', relax ? '轻松一下。' : '看成风景。'));
      elements.description.textContent = relax ? '放下忙碌，和身边的人分享一点快乐。' : '有些瞬间，值得多看一眼。';
      const label = byId('section-label');
      label.replaceChildren(document.createTextNode(relax ? '从这一局开始 ' : '本期精选 '), node('span', '', relax ? 'PLAY A LITTLE' : 'SELECTED STORIES'));
      byId('heading-note').replaceChildren(document.createTextNode(relax ? 'Less rush.' : 'A little pause.'), node('br'), node('i', '', relax ? 'More fun.' : 'A different view.'), node('span', '', '↙'));
      byId('album-section').hidden = relax;
      byId('pocket-line').hidden = relax;
      byId('relax-guide').hidden = !relax;
      renderProjects();
    }
    if (updateHistory) {
      const url = new URL(window.location.href);
      url.searchParams.set('category', id);
      url.hash = '';
      window.history.pushState({}, '', url.pathname + url.search);
      window.scrollTo(0, 0);
      byId('main-content').focus({ preventScroll: true });
    }
  }
  function createGuide() {
    const guide = node('section', '', '');
    guide.id = 'relax-guide';
    guide.setAttribute('aria-label', '双人反应挑战玩法');
    const steps = node('div', 'relax-guide');
    [['01', '找一位搭档', '两个人，面对同一块屏幕。'], ['02', '等一声 GO', '选好赛制，信号出现前别抢跑。'], ['03', '分享小小胜负', '先得 1、3 或 5 分，快乐只在这一刻。']].forEach(function (step) {
      const item = node('div');
      item.append(node('span', '', step[0]), node('h3', '', step[1]), node('p', '', step[2]));
      steps.appendChild(item);
    });
    guide.append(steps, node('p', 'relax-note', 'A small break goes a long way.'));
    byId('pocket-line').after(guide);
  }
  async function loadCatalog() {
    if (loading) return;
    loading = true;
    elements.collections.setAttribute('aria-busy', 'true');
    elements.loading.hidden = false;
    elements.error.hidden = true;
    elements.empty.hidden = true;
    elements.grid.hidden = true;
    elements.retry.disabled = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(function () { controller.abort(); }, 10000);
    try {
      const response = await fetch('/projects.json', { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal });
      if (!response.ok) throw new Error('Catalog request failed');
      const raw = await response.text();
      if (raw.length > 128000) throw new Error('Catalog too large');
      catalog = window.BrclioCatalog.validateCatalog(JSON.parse(raw));
      byId('app-version').textContent = catalog.version;
      renderProjects();
    } catch (_) {
      elements.error.hidden = false;
      byId('project-count').textContent = '暂时未能加载';
      elements.status.textContent = '内容加载失败，可以重新加载。';
    } finally {
      window.clearTimeout(timeout);
      loading = false;
      elements.loading.hidden = true;
      elements.retry.disabled = false;
      elements.collections.setAttribute('aria-busy', 'false');
    }
  }
  document.querySelectorAll('[data-view]').forEach(function (link) {
    link.addEventListener('click', function (event) {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      selectView(link.dataset.view, true);
    });
  });
  document.querySelectorAll('a[href="#privacy"]').forEach(function (link) {
    link.addEventListener('click', function () { byId('privacy').open = true; });
  });
  window.addEventListener('popstate', function () { selectView(readView(), false); });
  elements.retry.addEventListener('click', loadCatalog);
  createGuide();
  selectView(selectedView, false);
  loadCatalog();
}());
