'use strict';

// The same immutable IDs are used by the account API, web and native picker.
// Art is served by the existing web origin; it is not bundled into the miniapp.
const COUNT = 1000;
const PAGE_SIZE = 40;
const MOTIFS = Object.freeze(['小猫', '小狐狸', '小熊', '小兔', '熊猫', '小狗', '小青蛙', '猫头鹰', '小企鹅', '机器人']);

function validId(id) { return Number.isInteger(id) && id >= 1 && id <= COUNT; }
function avatarPath(id) { return validId(id) ? '/avatars/' + String(id).padStart(4, '0') + '.png' : ''; }
function avatarLabel(id) { return validId(id) ? MOTIFS[Math.floor((id - 1) / 100)] + ' ' + String(id).padStart(4, '0') : ''; }

// Pages are zero-based. At most 100 thumbnails are created at a time.
function pageItems(page, pageSize = PAGE_SIZE, origin = '') {
  if (!Number.isInteger(page) || page < 0 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return [];
  const prefix = typeof origin === 'string' ? origin.replace(/\/+$/, '') : '';
  const start = page * pageSize + 1;
  return Array.from({ length: Math.max(0, Math.min(pageSize, COUNT - start + 1)) }, (_, index) => {
    const id = start + index;
    return { id, url: prefix + avatarPath(id), label: avatarLabel(id) };
  });
}

module.exports = { COUNT, PAGE_SIZE, MOTIFS, validId, avatarPath, avatarLabel, pageItems };
