/* Shared, deliberately small Markdown renderer. Raw HTML is always text.
 * Brclio Design System adaptation, CC BY-NC-SA 4.0. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BrclioBlogContent = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_CONTENT = 100000;
  function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function safeUrl(value, image) {
    if (typeof value !== 'string' || value.length > 2048 || /[\s\\\u0000-\u001f\u007f<>"']/.test(value)) return '';
    if (/^https:\/\/[^/?#]+/i.test(value)) {
      const authority = value.slice(8).split(/[/?#]/)[0];
      return authority && !authority.includes('@') ? value : '';
    }
    if (!image && /^\/(?!\/)/.test(value) && !/%(?:2f|5c|00|0a|0d)/i.test(value)) return value;
    return '';
  }
  function inline(source, depth) {
    if ((depth || 0) > 5) return escapeHtml(source);
    const pattern = /`([^`\n]+)`|!\[([^\[\]\n]*)\]\(([^\s()\[\]]{1,2048})\)|\[([^\[\]\n]+)\]\(([^\s()\[\]]{1,2048})\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|\*([^*\n]+)\*/g;
    let result = '', offset = 0, match;
    while ((match = pattern.exec(source))) {
      result += escapeHtml(source.slice(offset, match.index));
      if (match[1] !== undefined) result += '<code style="background:#faf6eb;padding:2px 5px;border-radius:3px;word-break:break-word">' + escapeHtml(match[1]) + '</code>';
      else if (match[2] !== undefined) {
        const url = safeUrl(match[3], true);
        result += url ? '<img src="' + escapeHtml(url) + '" alt="' + escapeHtml(match[2].slice(0, 300)) + '" loading="lazy" referrerpolicy="no-referrer" style="max-width:100%;height:auto;border-radius:6px" />' : escapeHtml(match[2] || '[图片地址不受支持]');
      } else if (match[4] !== undefined) {
        const url = safeUrl(match[5], false);
        result += url ? '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" style="color:#2b7fd8;text-decoration:underline">' + inline(match[4], (depth || 0) + 1) + '</a>' : inline(match[4], (depth || 0) + 1);
      } else if (match[6] !== undefined || match[7] !== undefined) result += '<strong>' + inline(match[6] || match[7], (depth || 0) + 1) + '</strong>';
      else if (match[8] !== undefined) result += '<del>' + escapeHtml(match[8]) + '</del>';
      else result += '<em>' + inline(match[9], (depth || 0) + 1) + '</em>';
      offset = pattern.lastIndex;
    }
    return result + escapeHtml(source.slice(offset));
  }
  function cells(line) { return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (cell) { return cell.trim(); }); }
  function isTableRule(line) { return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line); }
  function isTableHeader(line, rule) {
    if (!line || !rule || !line.includes('|') || !isTableRule(rule)) return false;
    const headings = cells(line);
    return headings.length >= 2 && headings.length <= 32 && headings.length === cells(rule).length;
  }
  function renderMarkdown(value) {
    const lines = String(value || '').slice(0, MAX_CONTENT).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;
    function special(line, index) {
      return !line.trim() || /^\s*```|^#{1,6}\s|^\s*>|^\s*[-*+]\s|^\s*\d+[.)]\s|^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line) || isTableHeader(line, lines[index + 1]);
    }
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i += 1; continue; }
      if (/^\s*```/.test(line)) {
        const code = []; i += 1;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
        if (i < lines.length) i += 1;
        out.push('<pre style="background:#faf6eb;padding:18px;border-radius:6px;overflow:auto;white-space:pre-wrap;word-break:break-word;line-height:1.7"><code>' + escapeHtml(code.join('\n')) + '</code></pre>');
        continue;
      }
      const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (heading) { const h = heading[1].length; out.push('<h' + h + ' style="font-family:serif;line-height:1.6;margin:24px 0 12px;font-weight:700">' + inline(heading[2]) + '</h' + h + '>'); i += 1; continue; }
      if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) { out.push('<hr style="border:0;border-top:1px solid #dedbd1;margin:28px 0" />'); i += 1; continue; }
      if (/^\s*>/.test(line)) {
        const quote = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(inline(lines[i++].replace(/^\s*>\s?/, '')));
        out.push('<div class="blog-md-quote" style="background:#faf6eb;border-radius:6px;padding:20px;margin:20px 0;font-family:serif;line-height:1.9">' + quote.join('<br />') + '</div>'); continue;
      }
      if (isTableHeader(line, lines[i + 1])) {
        const head = cells(line); i += 2;
        const body = [];
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
          const row = cells(lines[i]);
          if (row.length !== head.length) break;
          body.push(row); i += 1;
        }
        const cellStyle = 'padding:10px 12px;border-bottom:1px solid #dedbd1;text-align:left;line-height:1.7;word-break:break-word';
        out.push('<div style="max-width:100%;overflow:auto;margin:20px 0"><table style="border-collapse:collapse;width:100%;font-size:14px"><thead><tr>' + head.map(function (cell) { return '<th style="' + cellStyle + ';background:#faf6eb;font-weight:600">' + inline(cell) + '</th>'; }).join('') + '</tr></thead><tbody>' + body.map(function (row) { return '<tr>' + head.map(function (_, index) { return '<td style="' + cellStyle + '">' + inline(row[index] || '') + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>'); continue;
      }
      const list = /^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/.exec(line);
      if (list) {
        const ordered = !!list[2], items = [];
        while (i < lines.length) {
          const item = /^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/.exec(lines[i]);
          if (!item || !!item[2] !== ordered) break;
          items.push('<li style="padding:4px 0 4px 3px;line-height:1.9">' + inline(item[3]) + '</li>'); i += 1;
        }
        const tag = ordered ? 'ol' : 'ul';
        out.push('<' + tag + ' style="margin:16px 0;padding-left:26px;list-style-type:' + (ordered ? 'decimal' : 'disc') + '">' + items.join('') + '</' + tag + '>'); continue;
      }
      const paragraph = [inline(line)]; i += 1;
      while (i < lines.length && !special(lines[i], i)) paragraph.push(inline(lines[i++]));
      out.push('<p style="margin:14px 0;line-height:1.95;overflow-wrap:anywhere">' + paragraph.join('<br />') + '</p>');
    }
    return out.join('\n');
  }
  function plainText(value) { return String(value || '').slice(0, MAX_CONTENT).replace(/```[^\n]*\n([\s\S]*?)(?:```|$)/g, '$1').replace(/!\[([^\[\]]*)\]\([^()\[\]]{0,2048}\)/g, '$1').replace(/\[([^\[\]]+)\]\([^()\[\]]{0,2048}\)/g, '$1').replace(/[#*>_`~|]/g, '').replace(/\s+/g, ' ').trim(); }
  function byteLength(value) {
    let bytes = 0;
    for (let i = 0; i < value.length; i += 1) {
      const code = value.charCodeAt(i);
      if (code < 128) bytes += 1;
      else if (code < 2048) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i += 1; }
      else bytes += 3;
    }
    return bytes;
  }
  // WeChat's data bridge has a per-update size limit. Split only generated,
  // trusted markup, balance each fragment, and preserve every text character.
  function renderMarkdownChunks(value, maxBytes) {
    const budget = Math.max(16384, Math.min(262144, Number(maxBytes) || 65536));
    const html = renderMarkdown(value), chunks = [], stack = [];
    let chunk = '', size = 0, payload = false;
    function closing() { return stack.slice().reverse().map(function (entry) { return '</' + entry.name + '>'; }).join(''); }
    function flush() {
      if (!payload) return;
      chunks.push(chunk + closing());
      chunk = stack.map(function (entry) { return entry.tag; }).join('');
      size = byteLength(chunk); payload = false;
    }
    const pattern = /<[^>]*>|[^<]+/g;
    let match;
    while ((match = pattern.exec(html))) {
      const token = match[0];
      if (token[0] === '<') {
        const nameMatch = /^<\/?([a-z][a-z0-9]*)/i.exec(token), name = nameMatch && nameMatch[1];
        if (payload && size + byteLength(token) + byteLength(closing()) + 32 > budget) flush();
        chunk += token; size += byteLength(token); payload = true;
        if (/^<\//.test(token)) { if (stack.length && stack[stack.length - 1].name === name) stack.pop(); }
        else if (name && !['br', 'hr', 'img'].includes(name)) stack.push({ name: name, tag: token });
      } else {
        let offset = 0;
        while (offset < token.length) {
          const remaining = budget - size - byteLength(closing()) - 32;
          if (remaining < 12) { flush(); continue; }
          let end = offset, used = 0;
          while (end < token.length) {
            const first = token.charCodeAt(end), next = token.charCodeAt(end + 1);
            const units = first >= 0xd800 && first <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? 2 : 1;
            const length = units === 2 ? 4 : first < 128 ? 1 : first < 2048 ? 2 : 3;
            if (used + length > remaining) break;
            used += length; end += units;
          }
          // Escaping entities must remain intact between rich-text elements.
          if (end < token.length) {
            const amp = token.lastIndexOf('&', end - 1);
            if (amp >= offset && amp > token.lastIndexOf(';', end - 1) && end - amp < 12) { end = amp; used = byteLength(token.slice(offset, end)); }
          }
          chunk += token.slice(offset, end); size += used; payload = true; offset = end;
          if (offset < token.length) flush();
        }
      }
    }
    if (payload) chunks.push(chunk + closing());
    return chunks;
  }
  function summarize(value, length) { const text = plainText(value); return text.slice(0, length || 160); }
  function readingMinutes(value) { const text = plainText(value); return Math.max(1, Math.ceil(text.length / 400)); }
  return { renderMarkdown: renderMarkdown, renderMarkdownChunks: renderMarkdownChunks, escapeHtml: escapeHtml, safeUrl: safeUrl, summarize: summarize, readingMinutes: readingMinutes };
});
