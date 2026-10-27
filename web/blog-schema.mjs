// A closed, versioned JSON record contract shared by storage reads and writes.
// JSON Schema exports are also saved as docs/blog-storage.schema.json.
export const BLOG_SCHEMA_VERSION = 1;
const id = { type: 'string', pattern: '^[a-f0-9]{32}$' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const text = maximum => ({ type: 'string', maxLength: maximum, pattern: '^[^\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]*$' });
const requiredText = maximum => ({ ...text(maximum), minLength: 1 });
const object = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const array = (items, maximum, uniqueItems = false) => ({ type: 'array', items, maxItems: maximum, ...(uniqueItems ? { uniqueItems: true } : {}) });
const version = { const: BLOG_SCHEMA_VERSION };
const author = object({ id, displayName: requiredText(128), avatarUrl: { ...text(2048), format: 'https-url-or-empty' } });
const counts = object({ views: integer, likes: { ...integer, maximum: 5000 }, favorites: { ...integer, maximum: 5000 }, comments: { ...integer, maximum: 1000 } });
const postProperties = {
  schemaVersion: version, id, title: requiredText(120), excerpt: text(300), category: requiredText(40),
  tags: array(requiredText(24), 8, true), coverUrl: { ...text(2048), format: 'https-url-or-empty' },
  status: { enum: ['draft', 'published'] }, commentsEnabled: { type: 'boolean' }, author,
  createdAt: integer, publishedAt: { anyOf: [integer, { type: 'null' }] }, updatedAt: integer,
  readingMinutes: { ...integer, minimum: 1 }, revision: { ...integer, minimum: 1 }, counts
};
export const blogStorageSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://pocket.bornforthis.cn/schemas/blog-storage-v1.json',
  title: 'Brclio Miniapp Blog structured storage v1',
  description: 'Each storage path selects exactly one closed record type; Markdown is an article content string.',
  oneOf: ['article', 'summary', 'catalog', 'reactions', 'comments', 'comment', 'views', 'favorites', 'rate'].map(kind => ({ $ref: '#/$defs/' + kind })),
  $defs: {
    article: object({ ...postProperties, content: { ...requiredText(100000), 'x-maxLines': 5000 } }),
    summary: object(postProperties),
    catalog: object({ schemaVersion: version, posts: array({ $ref: '#/$defs/summary' }, 500) }),
    reactions: object({ schemaVersion: version, likes: array(id, 5000, true), favorites: array(id, 5000, true) }),
    comments: object({ schemaVersion: version, items: array(object({ id }), 1000) }),
    comment: object({ schemaVersion: version, id, content: requiredText(1000), author, createdAt: integer }),
    views: object({ schemaVersion: version, visitors: array(hash, 10000, true) }),
    favorites: object({ schemaVersion: version, ids: array(id, 500, true) }),
    rate: object({ schemaVersion: version, count: integer, resetAt: integer })
  }
};

export class BlogSchemaError extends Error {
  constructor() { super('blog_record_invalid'); this.name = 'BlogSchemaError'; }
}
function matches(value, schema) {
  if (schema.$ref) return matches(value, blogStorageSchema.$defs[schema.$ref.slice('#/$defs/'.length)]);
  if (schema.anyOf) return schema.anyOf.some(candidate => matches(value, candidate));
  if (Object.hasOwn(schema, 'const') && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'integer') return Number.isSafeInteger(value) && value >= schema.minimum && value <= schema.maximum;
  if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length > schema.maxLength || value.length < (schema.minLength || 0)) return false;
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return false;
    if (schema['x-maxLines'] && value.split('\n').length > schema['x-maxLines']) return false;
    if (schema.format === 'https-url-or-empty' && value) {
      try { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password) return false; } catch { return false; }
    }
    return true;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length > schema.maxItems || !value.every(item => matches(item, schema.items))) return false;
    if (schema.uniqueItems && new Set(value.map(item => typeof item === 'object' ? JSON.stringify(item) : item)).size !== value.length) return false;
    return true;
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return schema.required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => Object.hasOwn(schema.properties, key) && matches(value[key], schema.properties[key]));
  }
  return true;
}
export function validateBlogRecord(kind, value) {
  const schema = blogStorageSchema.$defs[kind];
  if (!schema || !matches(value, schema)) throw new BlogSchemaError();
  // Referential rules supplement the machine-readable field schema.
  if (kind === 'article' || kind === 'summary') {
    if (value.status === 'published' && value.publishedAt === null || value.updatedAt < value.createdAt) throw new BlogSchemaError();
  }
  if (kind === 'catalog' && new Set(value.posts.map(post => post.id)).size !== value.posts.length) throw new BlogSchemaError();
  if (kind === 'comments' && new Set(value.items.map(comment => comment.id)).size !== value.items.length) throw new BlogSchemaError();
  return value;
}
