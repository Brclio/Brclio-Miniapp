// Small raster header validation for account uploads. Clients perform decoding,
// center cropping and JPEG compression; only the display derivative is served.
export const BUILTIN_AVATAR_COUNT = 1000;
export const BUILTIN_AVATAR_VERSION = '20261026';
export const MAX_AVATAR_ORIGINAL_BYTES = 10 * 1024 * 1024;
export const MAX_AVATAR_DISPLAY_BYTES = 128 * 1024;
export const MAX_AVATAR_REQUEST_BYTES = Math.ceil(MAX_AVATAR_ORIGINAL_BYTES / 3) * 4 + Math.ceil(MAX_AVATAR_DISPLAY_BYTES / 3) * 4 + 1024;
const EXTENSIONS = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' });

export class AvatarError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function invalid() { throw new AvatarError(400, 'invalid_avatar', '请选择有效的 JPG、PNG、WebP 或 GIF 图片。'); }
function ascii(bytes, offset, length) { return String.fromCharCode(...bytes.subarray(offset, offset + length)); }
function be16(bytes, offset) { return bytes[offset] * 256 + bytes[offset + 1]; }
function le24(bytes, offset) { return bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536; }

export function imageDimensions(bytes, mimeType) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width, height;
  if (mimeType === 'image/png') {
    if (bytes.length < 45 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte) ||
        view.getUint32(8) !== 13 || ascii(bytes, 12, 4) !== 'IHDR' || ascii(bytes, bytes.length - 8, 4) !== 'IEND') invalid();
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (mimeType === 'image/jpeg') {
    if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) invalid();
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 255) invalid();
      while (bytes[offset] === 255) offset += 1;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (offset + 2 > bytes.length) invalid();
      const length = be16(bytes, offset);
      if (length < 2 || offset + length > bytes.length) invalid();
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8) invalid();
        height = be16(bytes, offset + 3); width = be16(bytes, offset + 5);
        break;
      }
      offset += length;
    }
  } else if (mimeType === 'image/gif') {
    if (!['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6)) || bytes[bytes.length - 1] !== 0x3b) invalid();
    width = view.getUint16(6, true); height = view.getUint16(8, true);
  } else if (mimeType === 'image/webp') {
    if (bytes.length < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP' || view.getUint32(4, true) + 8 !== bytes.length) invalid();
    const chunk = ascii(bytes, 12, 4);
    if (chunk === 'VP8X') { width = le24(bytes, 24) + 1; height = le24(bytes, 27) + 1; }
    else if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff;
    } else if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
    }
  } else invalid();
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width > 16384 || height > 16384 || width * height > 40000000) invalid();
  return { width, height };
}

function decodeImage(value, compressed = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['mimeType', 'data'].includes(key)) ||
      !Object.hasOwn(EXTENSIONS, value.mimeType) || compressed && value.mimeType !== 'image/jpeg' || typeof value.data !== 'string') invalid();
  const limit = compressed ? MAX_AVATAR_DISPLAY_BYTES : MAX_AVATAR_ORIGINAL_BYTES;
  if (value.data.length > Math.ceil(limit / 3) * 4) throw new AvatarError(413, 'avatar_too_large', compressed ? '压缩头像须小于 128 KB。' : '原图须小于 10 MB。');
  if (!value.data.length || value.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)) invalid();
  let binary;
  try { binary = atob(value.data); } catch { invalid(); }
  // Uint8Array.from(string, map) materializes the string iterator first. At the
  // 10 MiB upload limit that temporary list can exceed a Worker's memory cap.
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  if (bytes.length > limit) throw new AvatarError(413, 'avatar_too_large', '头像文件过大。');
  const dimensions = imageDimensions(bytes, value.mimeType);
  if (compressed && (dimensions.width > 256 || dimensions.height > 256)) throw new AvatarError(400, 'avatar_not_compressed', '展示头像须压缩到 256×256 像素以内。');
  return { bytes, mimeType: value.mimeType, extension: EXTENSIONS[value.mimeType], ...dimensions };
}
export function validateAvatar(body) {
  if (Object.hasOwn(body, 'builtinId')) {
    if (Object.keys(body).length !== 1 || !Number.isInteger(body.builtinId) || body.builtinId < 1 || body.builtinId > BUILTIN_AVATAR_COUNT) invalid();
    return { builtinId: body.builtinId };
  }
  if (Object.keys(body).length !== 2 || !Object.hasOwn(body, 'original') || !Object.hasOwn(body, 'compressed')) invalid();
  return { original: decodeImage(body.original), compressed: decodeImage(body.compressed, true) };
}
export function hasAvatar(profile) {
  return profile.avatar?.type === 'builtin' && Number.isInteger(profile.avatar.id) && profile.avatar.id >= 1 && profile.avatar.id <= BUILTIN_AVATAR_COUNT ||
    profile.avatar?.type === 'custom' && /^[a-f0-9]{32}$/.test(profile.avatar.assetId);
}
export function randomBuiltinId() {
  let value;
  do { value = crypto.getRandomValues(new Uint32Array(1))[0]; } while (value >= 4294967000);
  return value % BUILTIN_AVATAR_COUNT + 1;
}
export function avatarDirectory(userId, assetId) {
  return 'users/v1/' + userId.slice(0, 2) + '/' + userId + '/avatars/' + assetId + '/';
}
export function publicAvatar(profile, origin = '') {
  if (profile.avatar?.type === 'custom' && /^[a-f0-9]{32}$/.test(profile.avatar.assetId)) {
    return { avatarType: 'custom', avatarId: null, avatarUrl: origin + '/api/account/avatar/' + profile.id + '/' + profile.avatar.assetId };
  }
  const id = profile.avatar?.id;
  return Number.isInteger(id) && id >= 1 && id <= BUILTIN_AVATAR_COUNT ?
    { avatarType: 'builtin', avatarId: id, avatarUrl: origin + '/avatars/' + String(id).padStart(4, '0') + '.png?v=' + BUILTIN_AVATAR_VERSION } :
    { avatarType: '', avatarId: null, avatarUrl: '' };
}
