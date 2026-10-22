'use strict';

// Every published module shares the same account runtime before its app boots.
function withBrowserAccount(html) {
  if (!/<head(?:\s[^>]*)?>/i.test(html)) throw new Error('Published HTML has no head for account bootstrap');
  if (/src=["']\/account-runtime\.js["']/i.test(html)) throw new Error('Duplicate browser account bootstrap');
  return html.replace(/(<head(?:\s[^>]*)?>)/i, '$1\n    <script src="/account-runtime.js"></script>\n    <link rel="stylesheet" href="/account-widget.css">\n    <script src="/account.js" defer></script>');
}

module.exports = { withBrowserAccount };
