'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateCatalog, activeProjects, imagePath } = require('../web/portal/catalog');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../web/portal/projects.json'), 'utf8'));
const copy = () => JSON.parse(JSON.stringify(fixture));

test('released portal exposes one real photography project and the same active relax entry to everyone', () => {
  const catalog = validateCatalog(fixture);
  assert.deepEqual(catalog.categories.map(item => item.title), ['摄影', '放松']);
  assert.deepEqual(activeProjects(catalog).map(item => item.path), ['/projects/firstsight/', '/projects/ready-go-duel/']);
  assert.deepEqual(activeProjects(catalog, 'photography').map(item => item.id), ['firstsight']);
  assert.deepEqual(activeProjects(catalog, 'relax').map(item => item.id), ['ready-go-duel']);
});

test('project registry rejects external origins and URL/path escape forms', () => {
  for (const value of ['https://other.example/projects/firstsight/', '//other.example/projects/firstsight/', '/projects/../firstsight/', '/projects/%2e%2e/', '/projects/firstsight/?url=https://other.example', '/projects/firstsight/#next', '/projects/firstsight\\other/', 'javascript:alert(1)']) {
    const candidate = copy();
    candidate.projects[0].path = value;
    assert.throws(() => validateCatalog(candidate), /Invalid project catalog/);
  }
});

test('project covers remain local images without encoded traversal or SVG execution', () => {
  assert.equal(imagePath('/projects/firstsight/media/coast.jpg'), '/projects/firstsight/media/coast.jpg');
  for (const value of ['https://other.example/photo.jpg', '//other.example/photo.jpg', '/projects/wedding/assets/%2e%2e/secret.jpg', '/projects/wedding/assets/../secret.jpg', '/projects/wedding/assets/test.svg', 'data:image/svg+xml,anything', '/projects/wedding/assets/test.jpg?token=value']) {
    const candidate = copy();
    candidate.projects[0].cover = value;
    assert.throws(() => validateCatalog(candidate), /Invalid project catalog/);
  }
});

test('planned categories cannot silently publish active project entries', () => {
  const candidate = copy();
  candidate.categories.find(item => item.id === 'relax').status = 'planned';
  assert.throws(() => validateCatalog(candidate), /Invalid project catalog/);
  candidate.projects.find(item => item.category === 'relax').status = 'planned';
  const catalog = validateCatalog(candidate);
  assert.deepEqual(activeProjects(catalog).map(item => item.id), ['firstsight']);
  assert.deepEqual(activeProjects(catalog, 'relax'), []);
});

test('registry rejects duplicate project IDs, unknown categories and mismatched routes', () => {
  for (const change of [
    candidate => { candidate.projects.push(candidate.projects[0]); },
    candidate => { candidate.projects[0].category = 'unknown'; },
    candidate => { candidate.projects[0].path = '/projects/wedding/'; },
    candidate => { candidate.categories[1].id = 'photography'; }
  ]) {
    const candidate = copy();
    change(candidate);
    assert.throws(() => validateCatalog(candidate), /Invalid project catalog/);
  }
});

test('a new same-origin project can be registered within an active category', () => {
  const candidate = copy();
  candidate.projects.push({ ...candidate.projects[0], id: 'new-collection', path: '/projects/new-collection/', title: '新图册' });
  const catalog = validateCatalog(candidate);
  assert.equal(activeProjects(catalog, 'photography').length, 2);
  assert.equal(activeProjects(catalog, 'photography')[1].path, '/projects/new-collection/');
  assert.ok(Object.isFrozen(catalog.projects));
});
