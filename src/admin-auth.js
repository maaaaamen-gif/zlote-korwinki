import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const ADMIN_SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

function secureEqual(left, right) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function signature(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function credentialsMatch(provided, configured) {
  return typeof provided === "string"
    && typeof configured === "string"
    && secureEqual(provided, configured);
}

export function createAdminSession(username, secret, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    username,
    expiresAt: now + ADMIN_SESSION_DURATION_MS,
    nonce: randomUUID(),
  })).toString("base64url");

  return `${payload}.${signature(payload, secret)}`;
}

export function verifyAdminSession(token, username, secret, now = Date.now()) {
  if (typeof token !== "string") return false;
  const [payload, providedSignature, ...extra] = token.split(".");
  if (!payload || !providedSignature || extra.length > 0) return false;
  if (!secureEqual(providedSignature, signature(payload, secret))) return false;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return session.username === username
      && Number.isFinite(session.expiresAt)
      && session.expiresAt > now
      && typeof session.nonce === "string";
  } catch {
    return false;
  }
}
