const base64Url = {
  encode(buf) {
    return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  },
};

async function importKey(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

export async function signOrchestratorJwt(payload, secret, expiresIn = 3600, options = {}) {
  const now = Math.floor(Date.now() / 1000);
  const headerB64 = base64Url.encode(new TextEncoder().encode(JSON.stringify({
    alg: "HS256",
    typ: "JWT",
    ...(options.kid ? { kid: options.kid } : {}),
  })));
  const payloadB64 = base64Url.encode(new TextEncoder().encode(JSON.stringify({ ...payload, iat: now, exp: now + expiresIn })));
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${headerB64}.${payloadB64}`));
  return `${headerB64}.${payloadB64}.${base64Url.encode(signature)}`;
}
