// Short-lived, purpose-limited access to the online PK lobby. Account sessions
// never leave the account API or enter a websocket URL.
const encoder = new TextEncoder();
export const DUEL_TICKET_TTL = 60000;
const audience = 'brclio-online-duel-v1';

function encode(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : new Uint8Array(value);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid_ticket');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
}
async function key(secret, usage) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('duel_unavailable');
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}
export function duelSocketUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'wss:' || url.username || url.password || url.search || url.hash || url.pathname !== '/connect') return '';
    return url.toString();
  } catch { return ''; }
}
export async function issueDuelTicket(user, secret, socketUrl, at = Date.now()) {
  const url = duelSocketUrl(socketUrl);
  if (!url) throw new Error('duel_unavailable');
  const claims = {
    v: 1, aud: audience, sub: user.id, name: String(user.displayName || 'Brclio 用户').slice(0, 64),
    avatar: typeof user.avatarUrl === 'string' && /^https:\/\//.test(user.avatarUrl) ? user.avatarUrl.slice(0, 2048) : '',
    iat: at, exp: at + DUEL_TICKET_TTL, nonce: crypto.randomUUID()
  };
  const payload = encode(JSON.stringify(claims));
  const signature = await crypto.subtle.sign('HMAC', await key(secret, 'sign'), encoder.encode(payload));
  return { ticket: payload + '.' + encode(signature), socketUrl: url, expiresAt: claims.exp };
}
export async function verifyDuelTicket(ticket, secret, at = Date.now()) {
  try {
    if (typeof ticket !== 'string' || ticket.length > 4096) return null;
    const parts = ticket.split('.');
    if (parts.length !== 2 || !(await crypto.subtle.verify('HMAC', await key(secret, 'verify'), decode(parts[1]), encoder.encode(parts[0])))) return null;
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decode(parts[0])));
    if (value.v !== 1 || value.aud !== audience || !/^[a-f0-9]{32}$/.test(value.sub) ||
        !Number.isSafeInteger(value.iat) || !Number.isSafeInteger(value.exp) || value.exp - value.iat !== DUEL_TICKET_TTL ||
        value.iat > at + 1000 || value.exp <= at || typeof value.name !== 'string' || value.name.length > 64 ||
        typeof value.avatar !== 'string' || value.avatar.length > 2048 || (value.avatar && !/^https:\/\//.test(value.avatar)) ||
        typeof value.nonce !== 'string' || value.nonce.length !== 36) return null;
    return { user: { id: value.sub, displayName: value.name, avatarUrl: value.avatar }, nonce: value.nonce, expiresAt: value.exp };
  } catch { return null; }
}
