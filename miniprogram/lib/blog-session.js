'use strict';
const account = require('./account');
const { createBlogCache } = require('./blog-cache');

// One memory-only reading visit is shared by the main app and blog subpackage.
// No article, role or session token is persisted to device storage.
const cache = createBlogCache({
  request: (path, method, data) => account.blogRequest(path, method, data),
  getIdentity: () => (account.getCachedUser() || {}).id || ''
});
let identity = (account.getCachedUser() || {}).id || '';
account.subscribe(snapshot => {
  const next = snapshot.user && snapshot.user.id || '';
  if (next !== identity) { identity = next; cache.reset(); }
});
module.exports = cache;
