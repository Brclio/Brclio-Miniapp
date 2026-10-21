#!/usr/bin/env node
'use strict';

// Optional refresh utility. PNGs are committed so normal offline builds do not
// require an SVG renderer. Use the installed sharp renderer to refresh them.
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const icons = require('lucide-react');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'miniprogram/pages/duel/icons');
const names = ['Hand', 'Mic', 'Infinity', 'Settings', 'Volume2', 'VolumeX', 'RotateCcw', 'Play', 'Trophy', 'AlertTriangle', 'MicOff', 'Lock', 'Gift', 'Dices', 'Eye', 'EyeOff', 'KeyRound', 'Trash2', 'Save', 'XCircle', 'FileImage', 'RefreshCw', 'LogOut', 'Download', 'Upload', 'Music'];
const colors = { '': '#374151', '-white': '#ffffff', '-muted': '#1f293733', '-rose': '#f43f5e', '-sky': '#0ea5e9' };
function filename(name) { return name.replace(/([a-z])([A-Z0-9])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').toLowerCase(); }

async function prepareDuelIcons() {
  fs.mkdirSync(output, { recursive: true });
  for (const name of names) {
    for (const [suffix, color] of Object.entries(colors)) {
      const svg = renderToStaticMarkup(React.createElement(icons[name], { size: 96, color: name === 'Trophy' && !suffix ? '#eab308' : color, strokeWidth: name === 'Hand' ? 1.5 : 2, fill: name === 'Trophy' && !suffix ? '#fde047' : name === 'Play' ? color : 'none' }));
      await sharp(Buffer.from(svg)).png().toFile(path.join(output, filename(name) + suffix + '.png'));
    }
  }
  for (const [name, suffix, color] of [['Hand', 'indigo', '#4f46e5'], ['Infinity', 'purple', '#9333ea'], ['Settings', 'indigo', '#4f46e5'], ['Lock', 'yellow', '#ca8a04'], ['Gift', 'indigo', '#4f46e5']]) {
    const svg = renderToStaticMarkup(React.createElement(icons[name], { size: 96, color, strokeWidth: name === 'Hand' ? 1.5 : 2 }));
    await sharp(Buffer.from(svg)).png().toFile(path.join(output, filename(name) + '-' + suffix + '.png'));
  }
  const source = fs.readFileSync(path.join(root, 'web/projects/ready-go-duel/App.tsx'), 'utf8');
  const component = source.slice(source.indexOf('const CustomLogo'), source.indexOf('const Confetti'));
  const svgMatch = component.match(/<svg[\s\S]*?<\/svg>/);
  if (!svgMatch) throw new Error('Original ReadyGoDuel logo not found');
  const logo = svgMatch[0].replace(/\s*className=\{className\}/, '').replace(/style=\{\{([\s\S]*?)\}\}/g, function (_, value) {
    const declarations = Array.from(value.matchAll(/([A-Za-z]+)\s*:\s*'([^']*)'/g), function (match) { return match[1].replace(/[A-Z]/g, c => '-' + c.toLowerCase()) + ':' + match[2]; });
    return 'style="' + declarations.join(';') + '"';
  });
  await sharp(Buffer.from(logo)).resize(144, 144).png().toFile(path.join(output, 'logo.png'));
  console.log('Refreshed native ReadyGoDuel icons from Lucide and the original logo.');
}

if (require.main === module) prepareDuelIcons().catch(function (error) { console.error(error.message); process.exitCode = 1; });
module.exports = { prepareDuelIcons };
