import { handleBlog } from '../../../web/blog-api.mjs';

export function onRequest(context) { return handleBlog(context.request, context.env); }
