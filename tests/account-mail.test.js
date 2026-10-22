const test = require('node:test');
const assert = require('node:assert/strict');

const input = { email: 'PERSON@example.com', code: '012345', purpose: 'register', nonce: 'a'.repeat(32) };
const env = { SMTP_USERNAME: 'sender@gmail.com', SMTP_APP_PASSWORD: 'abcd efgh ijkl mnop', EMAIL_FROM: 'Brclio 悦创 <sender@gmail.com>' };
let modulePromise;
const mail = () => modulePromise ||= import('../web/account-mail.mjs');

function smtp({ rejection, greeting = '220 smtp.gmail.com ESMTP ready\r\n', fragmented = true, stall = false } = {}) {
  const commands = []; let controller, closed = false, inData = false;
  function push(value) {
    const bytes = new TextEncoder().encode(value);
    if (fragmented && bytes.length > 3) { controller.enqueue(bytes.subarray(0, 3)); controller.enqueue(bytes.subarray(3)); }
    else controller.enqueue(bytes);
  }
  const readable = new ReadableStream({ start(value) { controller = value; if (!stall) push(greeting); }, cancel() { closed = true; } });
  const writable = new WritableStream({ write(bytes) {
    const value = new TextDecoder().decode(bytes); commands.push(value);
    if (inData) { inData = false; push(rejection === 'data' ? '550 mailbox refused\r\n' : '250 2.0.0 accepted\r\n'); return; }
    if (value.startsWith('EHLO ')) push('250-smtp.gmail.com ready\r\n250-AUTH LOGIN PLAIN XOAUTH2\r\n250 SIZE 35882577\r\n');
    else if (value.startsWith('AUTH PLAIN ')) push(rejection === 'auth' ? '535 5.7.8 rejected private-provider-details\r\n' : '235 2.7.0 accepted\r\n');
    else if (value.startsWith('MAIL FROM:')) push('250 sender accepted\r\n');
    else if (value.startsWith('RCPT TO:')) push(rejection === 'recipient' ? '550 recipient rejected\r\n' : '250 recipient accepted\r\n');
    else if (value === 'DATA\r\n') { inData = true; push('354 continue\r\n'); }
  } });
  const socket = { readable, writable, opened: Promise.resolve(), closed: Promise.resolve(), close() { closed = true; } };
  return { commands, connect(address, options) { assert.deepEqual(address, { hostname: 'smtp.gmail.com', port: 465 }); assert.equal(options.secureTransport, 'on'); return socket; }, get closed() { return closed; } };
}

test('Gmail SMTP uses implicit TLS, bounded multiline replies, AUTH PLAIN and UTF-8 MIME', async () => {
  const { createGmailSender } = await mail(); const server = smtp();
  await createGmailSender({ connectImpl: server.connect })(input, env);
  assert.equal(server.closed, true);
  assert.equal(server.commands[0], 'EHLO miniapp.brclio.com\r\n');
  const auth = server.commands.find(value => value.startsWith('AUTH PLAIN ')).slice(11).trim();
  assert.equal(Buffer.from(auth, 'base64').toString(), '\0sender@gmail.com\0abcdefghijklmnop');
  assert.equal(server.commands[2], 'MAIL FROM:<sender@gmail.com>\r\n');
  assert.equal(server.commands[3], 'RCPT TO:<person@example.com>\r\n');
  const message = server.commands.find(value => value.startsWith('From: '));
  assert.ok(message.includes('Content-Transfer-Encoding: base64\r\n'));
  assert.ok(message.includes('Subject: =?UTF-8?B?'));
  assert.ok(message.endsWith('\r\n.\r\n'));
  assert.ok(!message.includes(env.SMTP_APP_PASSWORD));
  const body = message.split('\r\n\r\n')[1].slice(0, -5);
  assert.ok(body.split('\r\n').every(line => line.length <= 76));
  assert.match(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString(), /注册验证码是：012345/);
});

test('Gmail SMTP rejects provider failures without exposing server details or credentials', async () => {
  const { createGmailSender } = await mail();
  for (const rejection of ['auth', 'recipient', 'data']) {
    const server = smtp({ rejection });
    await assert.rejects(createGmailSender({ connectImpl: server.connect })(input, env), error => error.message === 'mail_unavailable');
    assert.equal(server.closed, true);
    if (rejection !== 'data') assert.ok(!server.commands.some(value => value.startsWith('From: ')));
  }
});

test('Gmail SMTP rejects command/header injection and mismatched sender before connecting', async () => {
  const { createGmailSender } = await mail(); let called = false;
  const sender = createGmailSender({ connectImpl() { called = true; throw Error(); } });
  for (const bad of [{ ...input, email: 'a@example.com\r\nRCPT TO:<victim@example.com>' }, { ...input, code: '123456\r\nDATA' }, { ...input, purpose: 'unknown' }, { ...input, purpose: 'constructor' }]) await assert.rejects(sender(bad, env), /mail_unavailable/);
  await assert.rejects(sender(input, { ...env, EMAIL_FROM: 'other@gmail.com' }), /mail_unavailable/);
  await assert.rejects(sender(input, { ...env, EMAIL_FROM: 'x\r\nBcc: victim@example.com' }), /mail_unavailable/);
  assert.equal(called, false);
});

test('Gmail SMTP rejects malformed or oversized replies and closes stalled sockets at total timeout', async () => {
  const { createGmailSender } = await mail();
  for (const greeting of ['220-first\r\n250 wrong-code\r\n', '220 ' + 'x'.repeat(9000) + '\r\n', '220 invalid\n']) {
    const server = smtp({ greeting });
    await assert.rejects(createGmailSender({ connectImpl: server.connect })(input, env), /mail_unavailable/);
    assert.equal(server.closed, true);
  }
  const server = smtp({ stall: true });
  await assert.rejects(createGmailSender({ connectImpl: server.connect, timeoutMs: 20 })(input, env), /mail_unavailable/);
  assert.equal(server.closed, true);
});

test('Resend fallback sends only OTP content and treats provider errors as generic', async () => {
  const { sendAccountEmail } = await mail(); let request;
  const resendEnv = { RESEND_API_KEY: 'test-api-key', EMAIL_FROM: 'Brclio <account@example.com>' };
  await sendAccountEmail(input, resendEnv, async (url, options) => { request = { url, options }; return new Response('{}', { status: 200 }); });
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.options.redirect, 'manual');
  assert.equal(request.options.headers['Idempotency-Key'], 'miniapp-code-' + input.nonce);
  assert.deepEqual(JSON.parse(request.options.body).to, ['person@example.com']);
  assert.match(JSON.parse(request.options.body).text, /012345/);
  await assert.rejects(sendAccountEmail(input, resendEnv, async () => new Response('provider private diagnostics', { status: 403 })), error => error.message === 'mail_unavailable');
  await assert.rejects(sendAccountEmail(input, resendEnv, async (_url, options) => {
    assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example/' } });
  }), /mail_unavailable/);
});
