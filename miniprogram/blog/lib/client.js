'use strict';
const account = require('../../lib/account');
const config = require('../../config');
const VISITOR_KEY = 'brclio.blog-visitor.v1';
let memoryVisitor;
function id(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value) ? value : ''; }
function query(values) {
  return Object.keys(values || {}).filter(key => values[key] !== undefined && values[key] !== '' && values[key] !== false).map(key => encodeURIComponent(key) + '=' + encodeURIComponent(values[key])).join('&');
}
function request(path, method, data) { return account.blogRequest(path, method || 'GET', data); }
function date(value) {
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') : '';
}
function post(value) { return { ...value, dateText: date(value.publishedAt || value.updatedAt) }; }
function comment(value) { return { ...value, dateText: date(value.createdAt) }; }
function visitorId() {
  if (memoryVisitor) return memoryVisitor;
  try { const value = wx.getStorageSync(VISITOR_KEY); if (typeof value === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(value)) return (memoryVisitor = value); } catch (_) {}
  memoryVisitor = 'mini_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 13) + Math.random().toString(36).slice(2, 13);
  try { wx.setStorageSync(VISITOR_KEY, memoryVisitor); } catch (_) {}
  return memoryVisitor;
}
function login() { wx.navigateTo({ url: '/pages/account/index' }); }
function isAuthError(error) { return error && (error.status === 401 || error.code === 'session_expired' || error.code === 'unauthorized'); }
function message(error) { return error && error.code === 'operation_canceled' ? '' : error && error.message || '连接失败，请稍后重试。'; }
module.exports = { account, id, query, request, post, comment, visitorId, login, isAuthError, message,
  writingUrl: config.webOrigin + '/blog/?view=write' };
