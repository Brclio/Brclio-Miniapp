(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BrclioCatalog = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const categoryTitles = Object.freeze({ photography: '摄影', relax: '放松' });
  const idPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
  const projectPathPattern = /^\/projects\/[a-z0-9][a-z0-9-]{0,63}\/$/;
  const imagePathPattern = /^\/projects\/[a-z0-9][a-z0-9-]{0,63}\/(?:assets|media)\/(?:[A-Za-z0-9][A-Za-z0-9_-]*\/)*[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:jpe?g|png|webp|avif|gif)$/i;
  function fail() { throw new Error('Invalid project catalog'); }
  function object(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(); return value; }
  function text(value, limit) {
    if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) fail();
    return value.trim();
  }
  function status(value) { if (value !== 'active' && value !== 'planned') fail(); return value; }
  function projectPath(value) { if (typeof value !== 'string' || !projectPathPattern.test(value)) fail(); return value; }
  function imagePath(value) {
    if (typeof value !== 'string' || value.length > 240 || !imagePathPattern.test(value) || value.includes('..')) fail();
    return value;
  }
  function validateCatalog(input) {
    const source = object(input);
    if (source.schemaVersion !== 1 || typeof source.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(source.version)) fail();
    const sourceIntro = object(source.intro);
    const intro = Object.freeze({ title: text(sourceIntro.title, 70), description: text(sourceIntro.description, 180), releaseNote: text(sourceIntro.releaseNote, 50) });
    if (!Array.isArray(source.categories) || source.categories.length !== 2 || !Array.isArray(source.projects) || source.projects.length > 100) fail();
    const ids = new Set();
    const categories = source.categories.map(function (value) {
      const category = object(value);
      if (!Object.prototype.hasOwnProperty.call(categoryTitles, category.id) || ids.has(category.id) || category.title !== categoryTitles[category.id]) fail();
      ids.add(category.id);
      return Object.freeze({ id: category.id, title: category.title, status: status(category.status), eyebrow: text(category.eyebrow, 60), heading: text(category.heading, 70), description: text(category.description, 180) });
    });
    const projectIds = new Set();
    const projects = source.projects.map(function (value) {
      const project = object(value);
      if (typeof project.id !== 'string' || !idPattern.test(project.id) || projectIds.has(project.id) || !ids.has(project.category)) fail();
      projectIds.add(project.id);
      const projectStatus = status(project.status);
      const category = categories.find(function (item) { return item.id === project.category; });
      if (projectStatus === 'active' && category.status !== 'active') fail();
      const path = projectPath(project.path);
      if (path !== '/projects/' + project.id + '/') fail();
      return Object.freeze({ id: project.id, category: project.category, status: projectStatus, kind: text(project.kind, 30), title: text(project.title, 70), subtitle: text(project.subtitle, 90), description: text(project.description, 220), path: path, cover: imagePath(project.cover), coverAlt: text(project.coverAlt, 180), disclosure: text(project.disclosure, 70), label: text(project.label, 40), action: text(project.action, 40) });
    });
    return Object.freeze({ schemaVersion: 1, version: source.version, intro: intro, categories: Object.freeze(categories), projects: Object.freeze(projects) });
  }
  function activeProjects(catalog, categoryId) {
    return catalog.projects.filter(function (project) { return project.status === 'active' && (!categoryId || project.category === categoryId); });
  }
  return Object.freeze({ validateCatalog: validateCatalog, activeProjects: activeProjects, projectPath: projectPath, imagePath: imagePath });
}));
