import { describe, expect, it } from "vitest";
import {
  base64Url,
  collectVerificationKeys,
  parseJwtHeader,
  resolveSigningSecret,
  signJwt,
  verifyJwt,
  verifyJwtAgainstKeyring,
  JWT_LEEWAY_SECONDS,
} from "../src/index.js";

const SECRET_V1 = "x".repeat(32);
const SECRET_V2 = "y".repeat(32);

async function mint(payload: Record<string, unknown>, kid: string, secret: string) {
  return signJwt({
    header: { alg: "HS256", typ: "JWT", kid },
    payload,
    secret,
  });
}

describe("base64Url", () => {
  it("round-trips an arbitrary byte sequence", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 254, 255]);
    const encoded = base64Url.encode(bytes);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
    const decoded = base64Url.decode(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });
});

describe("parseJwtHeader", () => {
  it("returns header for valid JWT", async () => {
    const token = await mint({ sub: "user1", exp: Math.floor(Date.now() / 1000) + 3600 }, "v1", SECRET_V1);
    expect(parseJwtHeader(token)).toMatchObject({ alg: "HS256", typ: "JWT", kid: "v1" });
  });

  it("returns null for malformed token", () => {
    expect(parseJwtHeader("not-a-token")).toBeNull();
    expect(parseJwtHeader("")).toBeNull();
  });
});

describe("collectVerificationKeys", () => {
  it("collects JWT_SIGNING_KEY_<kid> entries with length >= 32", () => {
    const env = {
      JWT_SIGNING_KEY_v1: SECRET_V1,
      JWT_SIGNING_KEY_v2: SECRET_V2,
      JWT_SIGNING_KEY_short: "tooshort",
      OTHER: "ignored",
    };
    const keys = collectVerificationKeys(env);
    expect(keys.size).toBe(2);
    expect(keys.get("v1")).toBe(SECRET_V1);
    expect(keys.get("v2")).toBe(SECRET_V2);
    expect(keys.has("short")).toBe(false);
  });

  it("includes legacy JWT_SECRET when >= 32 chars", () => {
    const keys = collectVerificationKeys({ JWT_SECRET: SECRET_V1 });
    expect(keys.get("legacy")).toBe(SECRET_V1);
  });
});

describe("verifyJwt", () => {
  it("accepts signed token with matching secret", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = await mint({ sub: "user1", exp }, "v1", SECRET_V1);
    const payload = await verifyJwt(token, SECRET_V1);
    expect(payload).toMatchObject({ sub: "user1", exp });
  });

  it("rejects expired token (beyond 5-min leeway)", async () => {
    const past = Math.floor(Date.now() / 1000) - 600;
    const token = await mint({ sub: "user1", exp: past }, "v1", SECRET_V1);
    expect(await verifyJwt(token, SECRET_V1)).toBeNull();
  });

  it("rejects wrong secret", async () => {
    const token = await mint({ sub: "user1", exp: Math.floor(Date.now() / 1000) + 60 }, "v1", SECRET_V1);
    expect(await verifyJwt(token, SECRET_V2)).toBeNull();
  });

  it("rejects token without sub", async () => {
    const token = await mint({ exp: Math.floor(Date.now() / 1000) + 60 }, "v1", SECRET_V1);
    expect(await verifyJwt(token, SECRET_V1)).toBeNull();
  });

  it("rejects malformed structure", async () => {
    expect(await verifyJwt("a.b", SECRET_V1)).toBeNull();
    expect(await verifyJwt("", SECRET_V1)).toBeNull();
  });
});

describe("verifyJwtAgainstKeyring", () => {
  it("verifies with header.kid first when present", async () => {
    const token = await mint({ sub: "u1", exp: Math.floor(Date.now() / 1000) + 60 }, "v2", SECRET_V2);
    const keys = new Map([
      ["v1", SECRET_V1],
      ["v2", SECRET_V2],
    ]);
    expect(await verifyJwtAgainstKeyring(token, keys)).toMatchObject({ sub: "u1" });
  });

  it("falls through to other keys when kid mismatch (graceful overlap)", async () => {
    // Mint with v1; keyring rotated to {v2, v1} with different name (legacy)
    const token = await mint({ sub: "u1", exp: Math.floor(Date.now() / 1000) + 60 }, "v1", SECRET_V1);
    const keys = new Map([
      ["v2", SECRET_V2],
      ["v1", SECRET_V1],
    ]);
    expect(await verifyJwtAgainstKeyring(token, keys)).toMatchObject({ sub: "u1" });
  });

  it("falls back to legacy when header has no kid", async () => {
    const token = await signJwt({
      header: { alg: "HS256", typ: "JWT" },
      payload: { sub: "u1", exp: Math.floor(Date.now() / 1000) + 60 },
      secret: SECRET_V1,
    });
    const keys = new Map([["legacy", SECRET_V1]]);
    expect(await verifyJwtAgainstKeyring(token, keys)).toMatchObject({ sub: "u1" });
  });

  it("returns null when no key matches", async () => {
    const token = await mint({ sub: "u1", exp: Math.floor(Date.now() / 1000) + 60 }, "rogue", "z".repeat(32));
    const keys = new Map([["v1", SECRET_V1]]);
    expect(await verifyJwtAgainstKeyring(token, keys)).toBeNull();
  });
});

describe("resolveSigningSecret", () => {
  it("prefers JWT_SIGNING_KID when present and matches keyring", () => {
    const result = resolveSigningSecret({
      JWT_SIGNING_KID: "v2",
      JWT_SIGNING_KEY_v1: SECRET_V1,
      JWT_SIGNING_KEY_v2: SECRET_V2,
    });
    expect(result).toEqual({ kid: "v2", secret: SECRET_V2 });
  });

  it("returns null when JWT_SIGNING_KID is set but secret missing", () => {
    expect(resolveSigningSecret({ JWT_SIGNING_KID: "v9", JWT_SIGNING_KEY_v1: SECRET_V1 })).toBeNull();
  });

  it("falls back to first keyring entry when no JWT_SIGNING_KID", () => {
    const result = resolveSigningSecret({ JWT_SIGNING_KEY_v1: SECRET_V1 });
    expect(result?.kid).toBe("v1");
  });

  it("returns null when keyring is empty", () => {
    expect(resolveSigningSecret({})).toBeNull();
  });
});

describe("signJwt", () => {
  it("produces a token verifiable with the same secret", async () => {
    const token = await signJwt({
      header: { alg: "HS256", typ: "JWT", kid: "v1" },
      payload: { sub: "u1", exp: Math.floor(Date.now() / 1000) + 60 },
      secret: SECRET_V1,
    });
    expect(token.split(".").length).toBe(3);
    expect(await verifyJwt(token, SECRET_V1)).toMatchObject({ sub: "u1" });
  });
});

describe("JWT_LEEWAY_SECONDS", () => {
  it("is 5 minutes (per ZX5 Q11 / kid rotation overlap)", () => {
    expect(JWT_LEEWAY_SECONDS).toBe(5 * 60);
  });
});
