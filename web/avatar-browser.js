'use strict';

const catalog = require('../miniprogram/lib/avatar-catalog');
const MAX_ORIGINAL_BYTES = 10 * 1024 * 1024;
const MAX_COMPRESSED_BYTES = 128 * 1024;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function readDataUrl(file, host) {
  return new Promise((resolve, reject) => {
    const reader = new host.FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('图片读取失败，请重新选择。'));
    reader.readAsDataURL(file);
  });
}

// Only the display copy passes through canvas. The original FileReader bytes
// are sent separately, with no crop, resize, orientation rewrite or re-encode.
async function prepareBrowserAvatar(file, host = window) {
  if (!file || !TYPES.has(file.type)) throw new Error('请选择 JPG、PNG、WebP 或 GIF 图片。');
  if (!file.size || file.size > MAX_ORIGINAL_BYTES) throw new Error('原图须不超过 10 MB，请重新选择。');
  const source = await readDataUrl(file, host);
  const image = new host.Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('无法打开这张图片，请尝试其他图片。'));
    image.src = source;
  });
  if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 16384 || image.naturalHeight > 16384 || image.naturalWidth * image.naturalHeight > 40000000) {
    throw new Error('图片尺寸过大，请选择 4000 万像素以内的图片。');
  }
  const canvas = host.document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法处理图片，请更换浏览器重试。');
  context.fillStyle = '#fefcf6'; context.fillRect(0, 0, 256, 256);
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
  let preview;
  for (const quality of [0.82, 0.65, 0.45]) {
    preview = canvas.toDataURL('image/jpeg', quality);
    if (preview.startsWith('data:image/jpeg;base64,') && (preview.length - preview.indexOf(',') - 1) * 3 / 4 <= MAX_COMPRESSED_BYTES) break;
  }
  if (!preview?.startsWith('data:image/jpeg;base64,') || (preview.length - preview.indexOf(',') - 1) * 3 / 4 > MAX_COMPRESSED_BYTES) {
    throw new Error('图片压缩失败，请尝试其他图片。');
  }
  return { preview, payload: { original: { mimeType: file.type, data: source.slice(source.indexOf(',') + 1) }, compressed: { mimeType: 'image/jpeg', data: preview.slice(preview.indexOf(',') + 1) } } };
}

module.exports = { ...catalog, MAX_ORIGINAL_BYTES, MAX_COMPRESSED_BYTES, prepareBrowserAvatar };
