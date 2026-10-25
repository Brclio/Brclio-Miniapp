'use strict';

const ORIGINAL_LIMIT = 10 * 1024 * 1024;
const COMPRESSED_LIMIT = 128 * 1024;
const AVATAR_SIZE = 256;
function error(code, message) { return Object.assign(new Error(message), { code }); }
function call(api, method, args, context) {
  return new Promise((resolve, reject) => {
    if (!api || typeof api[method] !== 'function') return reject(error('avatar_unavailable', '当前微信版本暂不支持上传头像，请更新微信或选择内置头像。'));
    api[method]({ ...args, success: resolve, fail: value => reject(error(/cancel/i.test(value && value.errMsg || '') ? 'avatar_canceled' : 'avatar_failed', '图片处理未完成，请重新选择。')) }, context);
  });
}
function base64Size(value) {
  return typeof value === 'string' ? Math.floor(value.length * 3 / 4) - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0) : 0;
}
function originalMimeType(value) {
  if (typeof value !== 'string') return '';
  // getImageInfo.type can be "unknown" for WebP. Read at most 36 bytes from
  // the unchanged source instead of trusting its extension or decoding 10 MB.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes = [];
  let buffer = 0, bits = 0;
  for (let index = 0; index < Math.min(value.length, 48); index += 1) {
    const digit = alphabet.indexOf(value[index]);
    if (digit < 0) break;
    buffer = (buffer << 6) | digit;
    bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >>> bits) & 255); }
  }
  const matches = (offset, signature) => signature.every((byte, index) => bytes[offset + index] === byte);
  const ascii = (offset, length) => String.fromCharCode(...bytes.slice(offset, offset + length));
  if (matches(0, [137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png';
  if (matches(0, [255, 216, 255])) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(ascii(12, 4))) return 'image/webp';
  return '';
}
async function chooseOriginal(api) {
  if (typeof api.chooseMedia === 'function') {
    const result = await call(api, 'chooseMedia', { count: 1, mediaType: ['image'], sourceType: ['album'], sizeType: ['original'] });
    const file = result.tempFiles && result.tempFiles[0];
    return file && { path: file.tempFilePath, size: file.size };
  }
  const result = await call(api, 'chooseImage', { count: 1, sourceType: ['album'], sizeType: ['original'] });
  const file = result.tempFiles && result.tempFiles[0];
  return file ? { path: file.path, size: file.size } : result.tempFilePaths && { path: result.tempFilePaths[0] };
}
function canvasFor(page) {
  return new Promise((resolve, reject) => {
    if (!page || typeof page.createSelectorQuery !== 'function') return reject(error('avatar_unavailable', '暂时无法处理图片，请重试。'));
    page.createSelectorQuery().select('#avatar-upload-canvas').fields({ node: true }).exec(results => {
      const canvas = results && results[0] && results[0].node;
      if (!canvas) return reject(error('avatar_unavailable', '暂时无法处理图片，请重试。'));
      resolve(canvas);
    });
  });
}
function loadImage(canvas, path) {
  return new Promise((resolve, reject) => {
    const image = canvas.createImage();
    image.onload = () => resolve(image);
    image.onerror = () => reject(error('invalid_avatar', '这张图片暂时无法读取，请选择 JPG、PNG、WebP 或 GIF 图片。'));
    image.src = path;
  });
}

// The chosen source is read unchanged. Only the separate display derivative is
// cropped and encoded; the original never passes through a compression API.
async function prepareNativeAvatar(page, api, isCurrent = () => true) {
  const assertCurrent = () => { if (!isCurrent()) throw error('operation_canceled', '账号已变化，本次头像设置已取消。'); };
  const selected = await chooseOriginal(api);
  assertCurrent();
  if (!selected || !selected.path) throw error('avatar_canceled', '未选择图片。');
  if (selected.size > ORIGINAL_LIMIT) throw error('avatar_too_large', '请选择不超过 10 MB 的图片。');
  const info = await call(api, 'getImageInfo', { src: selected.path });
  if (!Number.isFinite(info.width) || !Number.isFinite(info.height) || info.width <= 0 || info.height <= 0 || info.width > 16384 || info.height > 16384 || info.width * info.height > 40000000) throw error('invalid_avatar', '请选择尺寸适中的 JPG、PNG、WebP 或 GIF 图片。');
  const fs = api.getFileSystemManager && api.getFileSystemManager();
  const original = await call(fs, 'readFile', { filePath: selected.path, encoding: 'base64' });
  if (!original.data || base64Size(original.data) > ORIGINAL_LIMIT) throw error('avatar_too_large', '请选择不超过 10 MB 的图片。');
  const mimeType = originalMimeType(original.data);
  const reportedType = ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' })[String(info.type).toLowerCase()];
  if (!mimeType || reportedType && reportedType !== mimeType) throw error('invalid_avatar', '图片格式无效，请重新选择 JPG、PNG、WebP 或 GIF 图片。');
  assertCurrent();
  const canvas = await canvasFor(page);
  canvas.width = AVATAR_SIZE; canvas.height = AVATAR_SIZE;
  const image = await loadImage(canvas, selected.path);
  assertCurrent();
  const context = canvas.getContext('2d');
  context.fillStyle = '#fefcf6'; context.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  const side = Math.min(image.width, image.height);
  context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  const result = await call(api, 'canvasToTempFilePath', { canvas, x: 0, y: 0, width: AVATAR_SIZE, height: AVATAR_SIZE, destWidth: AVATAR_SIZE, destHeight: AVATAR_SIZE, fileType: 'jpg', quality: 0.82 }, page);
  let compressed;
  try { compressed = await call(fs, 'readFile', { filePath: result.tempFilePath, encoding: 'base64' }); }
  finally { if (fs && typeof fs.unlink === 'function') fs.unlink({ filePath: result.tempFilePath, fail() {} }); }
  assertCurrent();
  if (!compressed.data || base64Size(compressed.data) > COMPRESSED_LIMIT) throw error('avatar_too_large', '图片压缩未完成，请换一张图片。');
  return { original: { mimeType, data: original.data }, compressed: { mimeType: 'image/jpeg', data: compressed.data } };
}

module.exports = { prepareNativeAvatar, ORIGINAL_LIMIT, COMPRESSED_LIMIT, AVATAR_SIZE, base64Size };
