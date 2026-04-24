import type { JwtPayload } from '../src/auth.js';

const base64Url = {
  encode(buf: ArrayBuffer | Uint8Array): string {
    return btoa(String.fromCharCode(...new Uint8Array(buf)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  },
};

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

export async function signTestJwt(
  payload: JwtPayload,
  secret: string,
  expiresIn = 3600,
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const finalPayload = {
    ...payload,
    iat: now,
    exp: typeof payload.exp === 'number' ? payload.exp : now + expiresIn,
  };
  const headerB64 = base64Url.encode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64Url.encode(new TextEncoder().encode(JSON.stringify(finalPayload)));
  const key = await importKey(secret);
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = await crypto.subtle.sign('HMAC', key, data);
  return `${headerB64}.${payloadB64}.${base64Url.encode(signature)}`;
}
