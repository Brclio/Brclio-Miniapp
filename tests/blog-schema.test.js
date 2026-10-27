const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('formal JSON storage schema exactly matches the validator contract used by the blog service', async () => {
  const { blogStorageSchema, validateBlogRecord } = await import('../web/blog-schema.mjs');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/blog-storage.schema.json'), 'utf8')), blogStorageSchema);
  for (const [kind, example] of [
    ['catalog', { schemaVersion: 1, posts: [] }],
    ['reactions', { schemaVersion: 1, likes: [], favorites: [] }],
    ['comments', { schemaVersion: 1, items: [] }],
    ['views', { schemaVersion: 1, visitors: ['a'.repeat(64)] }],
    ['favorites', { schemaVersion: 1, ids: ['b'.repeat(32)] }],
    ['rate', { schemaVersion: 1, count: 1, resetAt: 1793059200000 }]
  ]) {
    assert.equal(validateBlogRecord(kind, example), example);
    assert.throws(() => validateBlogRecord(kind, { ...example, privateField: 'forbidden' }), { name: 'BlogSchemaError' });
    assert.throws(() => validateBlogRecord(kind, { ...example, schemaVersion: 2 }), { name: 'BlogSchemaError' });
  }
});

test('formal root schema requires exactly one closed versioned record instead of accepting arbitrary JSON', async () => {
  const { blogStorageSchema } = await import('../web/blog-schema.mjs');
  assert.deepEqual(blogStorageSchema.oneOf, Object.keys(blogStorageSchema.$defs).map(kind => ({ $ref: '#/$defs/' + kind })));
  assert.equal(blogStorageSchema.oneOf.length, 9);
  for (const branch of blogStorageSchema.oneOf) {
    const record = blogStorageSchema.$defs[branch.$ref.slice('#/$defs/'.length)];
    assert.equal(record.type, 'object');
    assert.equal(record.additionalProperties, false);
    assert.ok(record.required.includes('schemaVersion'));
    assert.deepEqual(record.properties.schemaVersion, { const: 1 });
  }
});
