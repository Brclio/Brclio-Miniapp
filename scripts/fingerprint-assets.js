'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const assets = [
  { filename: 'main.js', attribute: 'src', extension: 'js' },
  { filename: 'main.css', attribute: 'href', extension: 'css' }
];
const fingerprint = bytes => crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function referencePattern(asset, filename) {
  // A whitespace boundary excludes attributes such as data-src and data-href.
  return new RegExp('(?<=\\s)' + asset.attribute + '="\\./' + filename + '"', 'g');
}

function exactlyOne(html, pattern, label) {
  const matches = [...html.matchAll(pattern)];
  if (matches.length !== 1) throw new Error('Expected exactly one ' + label + '; found ' + matches.length);
  return matches[0];
}

function fingerprintAssets(directory, html) {
  // Validate both references and read final bytes before writing any new files.
  const replacements = assets.map(function (asset) {
    const pattern = referencePattern(asset, escapeRegExp(asset.filename));
    exactlyOne(html, pattern, asset.attribute + '="./' + asset.filename + '"');
    const bytes = fs.readFileSync(path.join(directory, asset.filename));
    const filename = 'main-' + fingerprint(bytes) + '.' + asset.extension;
    return { asset, pattern, bytes, filename };
  });
  let output = html;
  for (const replacement of replacements) {
    fs.writeFileSync(path.join(directory, replacement.filename), replacement.bytes);
    output = output.replace(replacement.pattern, replacement.asset.attribute + '="./' + replacement.filename + '"');
  }
  return output;
}

function verifyFingerprintedAssets(directory, html) {
  for (const asset of assets) {
    if (referencePattern(asset, escapeRegExp(asset.filename)).test(html)) {
      throw new Error('HTML still references unversioned ' + asset.filename);
    }
    const match = exactlyOne(html, referencePattern(asset, 'main-([a-f0-9]{16})\\.' + asset.extension), 'fingerprinted ' + asset.filename + ' reference');
    const filename = 'main-' + match[1] + '.' + asset.extension;
    const bytes = fs.readFileSync(path.join(directory, filename));
    if (fingerprint(bytes) !== match[1]) throw new Error('Asset fingerprint differs from file bytes: ' + filename);
    if (!bytes.equals(fs.readFileSync(path.join(directory, asset.filename)))) {
      throw new Error('Fingerprinted asset differs from compatibility alias: ' + asset.filename);
    }
  }
  return true;
}

module.exports = { fingerprintAssets, verifyFingerprintedAssets };
