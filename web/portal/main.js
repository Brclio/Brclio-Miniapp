(function () {
  'use strict';
  const byId = function (id) { return document.getElementById(id); };
  const elements = {
    collections: byId('collections'), tabs: byId('category-tabs'), grid: byId('project-grid'),
    loading: byId('loading-panel'), error: byId('error-panel'), empty: byId('empty-panel'),
    title: byId('collection-title'), description: byId('category-description'), eyebrow: byId('category-eyebrow'),
    status: byId('category-status'), retry: byId('retry-button')
  };
  let catalog = null;
  let selectedCategory = new URLSearchParams(window.location.search).get('category') === 'relax' ? 'relax' : 'photography';
  let loading = false;
  function node(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  }
  function projectCard(project, index) {
    const link = node('a', 'project-card' + (index === 0 ? ' project-card--featured' : '') + (project.kind === 'reaction' ? ' project-card--reaction' : ''));
    link.href = project.path;
    link.setAttribute('aria-label', project.action + '，' + project.description);
    const visual = node('div', 'project-visual');
    const image = node('img', 'project-image');
    image.src = project.cover;
    image.alt = project.coverAlt;
    image.width = 1086;
    image.height = 1448;
    image.loading = index === 0 ? 'eager' : 'lazy';
    if (index === 0) image.fetchPriority = 'high';
    if (project.kind === 'reaction') visual.appendChild(node('span', 'reaction-label', 'READY. SET. GO.'));
    visual.append(image, node('span', 'image-disclosure', project.disclosure));
    const imageMarker = node('span', 'image-marker', '↗');
    imageMarker.setAttribute('aria-hidden', 'true');
    visual.appendChild(imageMarker);
    const content = node('div', 'project-content');
    const topline = node('div', 'project-topline');
    topline.append(node('span', 'project-label', project.label), node('span', 'project-number', '0' + (index + 1)));
    content.append(topline, node('h3', 'project-title', project.title), node('p', 'project-subtitle', project.subtitle), node('p', 'project-description', project.description));
    const action = node('div', 'project-action');
    action.append(node('span', '', project.action), node('span', 'project-arrow', '↗'));
    action.lastElementChild.setAttribute('aria-hidden', 'true');
    content.appendChild(action);
    link.append(visual, content);
    return link;
  }
  function selectCategory(id, moveFocus) {
    if (!catalog) return;
    const category = catalog.categories.find(function (item) { return item.id === id; });
    if (!category) return;
    selectedCategory = id;
    const projects = window.BrclioCatalog.activeProjects(catalog, id);
    const panelId = projects.length ? 'project-grid' : 'empty-panel';
    Array.from(elements.tabs.children).forEach(function (tab) {
      const selected = tab.dataset.category === id;
      tab.classList.toggle('active', selected);
      tab.setAttribute('aria-selected', String(selected));
      tab.setAttribute('aria-controls', selected ? panelId : (tab.dataset.category === 'relax' && !window.BrclioCatalog.activeProjects(catalog, 'relax').length ? 'empty-panel' : 'project-grid'));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && moveFocus) tab.focus();
    });
    elements.eyebrow.textContent = category.eyebrow;
    elements.title.textContent = category.heading;
    elements.description.textContent = category.description;
    elements.grid.replaceChildren();
    elements.grid.classList.toggle('project-grid--single', projects.length === 1);
    projects.forEach(function (project, index) { elements.grid.appendChild(projectCard(project, index)); });
    elements.grid.hidden = projects.length === 0;
    elements.empty.hidden = projects.length > 0;
    const panel = projects.length ? elements.grid : elements.empty;
    panel.setAttribute('aria-labelledby', 'tab-' + id);
    byId('empty-title').textContent = category.heading;
    byId('empty-description').textContent = category.description;
    byId('empty-badge').textContent = category.status === 'planned' ? '未开放 · 0 个项目' : '暂无项目';
    elements.status.textContent = category.title + '，' + projects.length + ' 个可浏览项目' + (category.status === 'planned' ? '，暂未开放' : '');
  }
  function renderCatalog() {
    const title = byId('page-title');
    const split = catalog.intro.title.indexOf('，');
    title.replaceChildren();
    if (split >= 0) {
      title.append(document.createTextNode(catalog.intro.title.slice(0, split + 1)), node('br'), node('span', 'highlight', catalog.intro.title.slice(split + 1)));
    } else title.textContent = catalog.intro.title;
    byId('intro-description').textContent = catalog.intro.description;
    byId('release-note').textContent = catalog.intro.releaseNote;
    byId('total-count').textContent = String(window.BrclioCatalog.activeProjects(catalog).length).padStart(2, '0');
    byId('app-version').textContent = catalog.version;
    elements.tabs.replaceChildren();
    catalog.categories.forEach(function (category) {
      const button = node('button', 'tab');
      button.type = 'button';
      button.id = 'tab-' + category.id;
      button.dataset.category = category.id;
      button.setAttribute('role', 'tab');
      button.append(node('span', '', category.title), node('span', 'tab-count', String(window.BrclioCatalog.activeProjects(catalog, category.id).length).padStart(2, '0')));
      if (category.status === 'planned') button.appendChild(node('span', 'tab-planned', '未开放'));
      button.addEventListener('click', function () { selectCategory(category.id, false); });
      elements.tabs.appendChild(button);
    });
    selectCategory(selectedCategory, false);
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
      renderCatalog();
    } catch (_) {
      elements.error.hidden = false;
      elements.title.textContent = '内容暂时没有加载出来';
      elements.description.textContent = '请检查网络连接，然后重试。';
      elements.status.textContent = '内容加载失败，可以重新加载。';
    } finally {
      window.clearTimeout(timeout);
      loading = false;
      elements.loading.hidden = true;
      elements.retry.disabled = false;
      elements.collections.setAttribute('aria-busy', 'false');
    }
  }
  elements.tabs.addEventListener('keydown', function (event) {
    if (!catalog || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = catalog.categories.findIndex(function (category) { return category.id === selectedCategory; });
    let next = current;
    if (event.key === 'ArrowRight') next = (current + 1) % catalog.categories.length;
    if (event.key === 'ArrowLeft') next = (current - 1 + catalog.categories.length) % catalog.categories.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = catalog.categories.length - 1;
    selectCategory(catalog.categories[next].id, true);
  });
  elements.retry.addEventListener('click', loadCatalog);
  loadCatalog();
}());
