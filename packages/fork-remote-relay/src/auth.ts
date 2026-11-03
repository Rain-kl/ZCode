import { FORK_REMOTE_SESSION_SECONDS, type ForkRemoteLoginResult } from "./contract.js";

const encoder = new TextEncoder();
const PASSWORD_ALGORITHM = "PBKDF2-SHA256";
// 修复依据：生产 Workers 的 CPU 限制会中断 210k 次 PBKDF2，导致正确密码被判为错误；
// 100k 是校验器已接受且生产环境可完成的下限预算。
const PASSWORD_ITERATIONS = 100_000;
const PASSWORD_BYTES = 32;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    PASSWORD_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  if (!password) throw new Error("Password must not be empty");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  return [PASSWORD_ALGORITHM, String(PASSWORD_ITERATIONS), base64Url(salt), base64Url(digest)].join(
    "$",
  );
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, iterationText, saltText, digestText, extra] = encoded.split("$");
  const iterations = Number(iterationText);
  if (
    algorithm !== PASSWORD_ALGORITHM ||
    extra !== undefined ||
    !Number.isSafeInteger(iterations) ||
    iterations < 100_000 ||
    iterations > 1_000_000 ||
    !saltText ||
    !digestText
  )
    return false;

  try {
    const expected = fromBase64Url(digestText);
    const actual = await derivePassword(password, fromBase64Url(saltText), iterations);
    if (actual.byteLength !== expected.byteLength) return false;
    let difference = 0;
    for (let index = 0; index < actual.byteLength; index += 1)
      difference |= actual[index] ^ expected[index];
    return difference === 0;
  } catch {
    return false;
  }
}

interface SessionClaims {
  sub: string;
  epoch: string;
  exp: number;
}

async function signingKey(secret: string, usage: Array<"sign" | "verify">) {
  if (encoder.encode(secret).byteLength < 32)
    throw new Error("AUTH_SECRET must be at least 32 bytes");
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usage,
  );
}

export async function issueSession(
  username: string,
  epoch: string,
  secret: string,
  now = Date.now(),
): Promise<ForkRemoteLoginResult> {
  const expiresAt = Math.floor(now / 1_000) + FORK_REMOTE_SESSION_SECONDS;
  const claims: SessionClaims = {
    sub: username,
    epoch,
    exp: expiresAt,
  };
  const payload = base64Url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret, ["sign"]),
    encoder.encode(payload),
  );
  return {
    token: `${payload}.${base64Url(new Uint8Array(signature))}`,
    expiresAt: new Date(expiresAt * 1_000).toISOString(),
    userInfo: { id: username, username, displayName: username },
  };
}

export async function verifySession(
  token: string,
  username: string,
  epoch: string,
  secret: string,
  now = Date.now(),
): Promise<boolean> {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return false;
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(secret, ["verify"]),
      fromBase64Url(signature),
      encoder.encode(payload),
    );
    if (!valid) return false;
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as SessionClaims;
    return (
      claims.sub === username &&
      claims.epoch === epoch &&
      Number.isSafeInteger(claims.exp) &&
      claims.exp > Math.floor(now / 1_000)
    );
  } catch {
    return false;
  }
}
