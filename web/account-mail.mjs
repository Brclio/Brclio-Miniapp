// Server-only transactional OTP delivery. SMTP credentials never enter URLs,
// message bodies, logs or client errors.
const encoder = new TextEncoder();
const ACTIONS = Object.freeze({ register: '注册', login: '登录', bind: '绑定邮箱' });

function unavailable() { return new Error('mail_unavailable'); }
function emailAddress(value) {
  if (typeof value !== 'string') throw unavailable();
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email) || email.startsWith('.') || email.includes('..') || email.includes('.@')) throw unavailable();
  return email;
}
function base64(value) {
  const bytes = encoder.encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
function encodedHeader(value) {
  const chunks = []; let chunk = '';
  for (const character of value) {
    if (encoder.encode(chunk + character).length > 42) { chunks.push(chunk); chunk = ''; }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map(part => '=?UTF-8?B?' + base64(part) + '?=').join('\r\n ');
}
function content(input) {
  const email = emailAddress(input?.email);
  const action = Object.hasOwn(ACTIONS, input?.purpose) ? ACTIONS[input.purpose] : null;
  if (!action || typeof input?.code !== 'string' || !/^\d{6}$/.test(input.code)) throw unavailable();
  return {
    email,
    subject: 'Brclio 悦创 · ' + action + '验证码',
    text: '你的' + action + '验证码是：' + input.code + '。10 分钟内有效，请勿向他人透露。\n如果不是你本人操作，请忽略此邮件。'
  };
}
function mimeMessage(message, sender, nonce) {
  const id = typeof nonce === 'string' && /^[a-f0-9]{16,64}$/.test(nonce) ? nonce : crypto.randomUUID().replace(/-/g, '');
  const headers = [
    'From: ' + encodedHeader('Brclio 悦创') + ' <' + sender + '>',
    'To: <' + message.email + '>',
    'Subject: ' + encodedHeader(message.subject),
    'Date: ' + new Date().toUTCString(),
    'Message-ID: <' + id + '@' + sender.split('@')[1] + '>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64'
  ];
  const lines = base64(message.text).match(/.{1,76}/g) || [];
  return headers.join('\r\n') + '\r\n\r\n' + lines.join('\r\n') + '\r\n.\r\n';
}

function smtpReplies(reader) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '', bytes = 0;
  async function line() {
    while (true) {
      const end = pending.indexOf('\r\n');
      if (end >= 0) {
        if (end > 8192) throw unavailable();
        const value = pending.slice(0, end); pending = pending.slice(end + 2);
        if (/[\r\n]/.test(value)) throw unavailable();
        return value;
      }
      if (pending.length > 8192 || pending.includes('\n')) throw unavailable();
      const { value, done } = await reader.read();
      if (done) throw unavailable();
      bytes += value.byteLength;
      if (bytes > 65536) throw unavailable();
      pending += decoder.decode(value, { stream: true });
    }
  }
  return async function reply(expected) {
    let code;
    for (let count = 0; count < 100; count++) {
      const match = /^(\d{3})([ -])([^\r\n]*)$/.exec(await line());
      if (!match || (code && match[1] !== code)) throw unavailable();
      code = match[1];
      if (match[2] === ' ') {
        if (!expected.includes(Number(code))) throw unavailable();
        return Number(code);
      }
    }
    throw unavailable();
  };
}

export function createGmailSender({ connectImpl, timeoutMs = 20000 } = {}) {
  return async function sendGmail(input, env = {}) {
    let socket, reader, writer, timer, expired = false;
    const close = () => {
      try { Promise.resolve(socket?.close()).catch(() => {}); } catch { /* No provider details escape. */ }
      try { Promise.resolve(reader?.cancel()).catch(() => {}); } catch { /* Already released. */ }
    };
    try {
      const message = content(input);
      const sender = emailAddress(env.SMTP_USERNAME);
      const password = typeof env.SMTP_APP_PASSWORD === 'string' ? env.SMTP_APP_PASSWORD.replace(/\s/g, '') : '';
      if (!password || password.length > 256) throw unavailable();
      if (env.EMAIL_FROM) {
        // Gmail sends only as the authenticated mailbox. A friendly display
        // name is permitted in configuration but never used as SMTP syntax.
        if (typeof env.EMAIL_FROM !== 'string' || /[\r\n]/.test(env.EMAIL_FROM)) throw unavailable();
        const match = /^(?:[^<>]*<([^<>]+)>|([^<>]+))$/.exec(env.EMAIL_FROM.trim());
        if (!match || emailAddress(match[1] || match[2]) !== sender) throw unavailable();
      }
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { expired = true; close(); reject(unavailable()); }, Math.max(1, Math.min(20000, timeoutMs)));
      });
      const delivery = (async () => {
        const connect = connectImpl || (await import('cloudflare:sockets')).connect;
        if (expired) throw unavailable();
        socket = connect({ hostname: 'smtp.gmail.com', port: 465 }, { secureTransport: 'on', allowHalfOpen: false });
        // An open promise can reject separately from stream reads.
        if (socket.closed) Promise.resolve(socket.closed).catch(() => {});
        if (socket.opened) await socket.opened;
        reader = socket.readable.getReader(); writer = socket.writable.getWriter();
        const reply = smtpReplies(reader);
        const write = value => writer.write(encoder.encode(value));
        const command = async (value, expected) => { await write(value + '\r\n'); return reply(expected); };
        await reply([220]);
        await command('EHLO miniapp.brclio.com', [250]);
        await command('AUTH PLAIN ' + base64('\0' + sender + '\0' + password), [235]);
        await command('MAIL FROM:<' + sender + '>', [250]);
        await command('RCPT TO:<' + message.email + '>', [250, 251]);
        await command('DATA', [354]);
        await write(mimeMessage(message, sender, input.nonce));
        await reply([250]);
        // The DATA acceptance is the delivery boundary. A QUIT/close failure
        // after it must not misreport an already accepted message as unsent.
        try { Promise.resolve(write('QUIT\r\n')).catch(() => {}); } catch { /* Best effort. */ }
      })();
      await Promise.race([delivery, timeout]);
    } catch { throw unavailable(); }
    finally {
      clearTimeout(timer); close();
      try { reader?.releaseLock(); } catch { /* A timed-out read may still settle. */ }
      try { writer?.releaseLock(); } catch { /* A timed-out write may still settle. */ }
    }
  };
}

const sendGmail = createGmailSender();

export async function sendAccountEmail(input, env = {}, fetchImpl = (...args) => fetch(...args)) {
  if (env.EMAIL_PROVIDER === 'gmail' || env.SMTP_USERNAME) return sendGmail(input, env);
  try {
    const message = content(input);
    if (!env.RESEND_API_KEY || typeof env.EMAIL_FROM !== 'string' || !env.EMAIL_FROM.trim() || env.EMAIL_FROM.length > 320 || /[\r\n]/.test(env.EMAIL_FROM)) throw unavailable();
    const nonce = input.nonce;
    if (typeof nonce !== 'string' || !/^[a-f0-9]{16,64}$/.test(nonce)) throw unavailable();
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000),
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': 'miniapp-code-' + nonce },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [message.email], subject: message.subject, text: message.text })
    });
    if (!response.ok) throw unavailable();
    try { await response.body?.cancel(); } catch { /* Response body is not needed. */ }
  } catch { throw unavailable(); }
}
