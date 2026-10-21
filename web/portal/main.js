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
  const views = ['photography', 'relax', 'learn', 'mine'];
  const viewCopy = {
    photography: { title: '摄影', page: '生活的切片', eyebrow: 'THROUGH THE LENS / 摄影', start: '把日常，', end: '看成风景。', description: '有些瞬间，值得多看一眼。', label: '本期精选 ', english: 'SELECTED STORIES', note: 'A little pause.', aside: 'A different view.', unit: '个影像项目' },
    relax: { title: '放松', page: '放松一下', eyebrow: 'TAKE A LITTLE BREAK / 放松', start: '认真生活，', end: '轻松一下。', description: '放下忙碌，和身边的人分享一点快乐。', label: '从这一局开始 ', english: 'PLAY A LITTLE', note: 'Less rush.', aside: 'More fun.', unit: '个轻松体验' },
    learn: { title: '悦学', page: '每天学一点', eyebrow: 'A LITTLE EVERY DAY / 悦学', start: '每天学一点，', end: '好奇多一点。', description: '让单词在指尖重逢，把记忆变成小小收获。', label: '从一个单词开始 ', english: 'LEARN A LITTLE', note: 'Small steps.', aside: 'Growing every day.', unit: '个学习项目' }
  };
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
    const link = node('a', 'project-card' + (project.kind === 'reaction' ? ' project-card--reaction' : project.kind === 'learning' ? ' project-card--learning' : ''));
    link.href = project.path;
    link.setAttribute('aria-label', project.action + '，' + project.description);
    const visual = node('div', 'project-visual');
    if (project.kind === 'reaction') {
      visual.appendChild(byId('duel-art').content.cloneNode(true));
    } else if (project.kind === 'learning') {
      visual.appendChild(byId('learning-art').content.cloneNode(true));
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
        visual.appendChild(node('span', 'unavailable-copy', '封面暂不可用 · 仍可打开项目'));
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
    const copy = viewCopy[selectedView];
    byId('project-count').textContent = projects.length + ' ' + copy.unit;
    elements.grid.replaceChildren();
    elements.grid.classList.toggle('project-grid--single', projects.length === 1);
    projects.forEach(function (project, index) { elements.grid.appendChild(projectCard(project, index)); });
    elements.grid.hidden = projects.length === 0;
    elements.empty.hidden = projects.length > 0;
    elements.status.textContent = copy.title + '，' + projects.length + ' 个可浏览项目。';
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
    const learn = id === 'learn';
    const copy = viewCopy[id];
    elements.collections.hidden = mine;
    elements.mine.hidden = !mine;
    document.querySelectorAll('.main-nav [data-view]').forEach(function (link) {
      const active = link.dataset.view === id;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    byId('breadcrumb').textContent = mine ? '我的' : copy.title;
    document.title = (mine ? '我的' : copy.page) + ' · Brclio 悦创';
    if (!mine) {
      elements.eyebrow.textContent = copy.eyebrow;
      elements.title.replaceChildren(document.createTextNode(copy.start), node('span', '', copy.end));
      elements.description.textContent = copy.description;
      const label = byId('section-label');
      label.replaceChildren(document.createTextNode(copy.label), node('span', '', copy.english));
      byId('heading-note').replaceChildren(document.createTextNode(copy.note), node('br'), node('i', '', copy.aside), node('span', '', '↙'));
      byId('album-section').hidden = relax || learn;
      byId('pocket-line').hidden = relax || learn;
      byId('relax-guide').hidden = !relax;
      byId('learning-guide').hidden = !learn;
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
    const learningGuide = node('section', 'learning-guide');
    learningGuide.id = 'learning-guide';
    learningGuide.setAttribute('aria-label', '词了个词学习方法');
    [['01', '先看一眼', '选好主题或学习阶段，记住本关词表。'], ['02', '让三张牌重逢', '英文、词性与中文含义，配成一组。'], ['03', '把收获留下', '翻单词本、收藏生词，回看通关足迹。']].forEach(function (step) {
      const item = node('div');
      const text = node('div');
      text.append(node('h3', '', step[1]), node('p', '', step[2]));
      item.append(node('span', '', step[0]), text);
      learningGuide.appendChild(item);
    });
    guide.after(learningGuide);
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
