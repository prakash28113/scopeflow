import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** 256-bit, URL-safe client access token. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Must match public._hash_token in the database. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function keyFrom(secret: string): Buffer {
  const key = Buffer.from(secret, "base64");
  if (key.length !== 32) {
    throw new Error("SHARE_TOKEN_SECRET must be 32 bytes, base64-encoded (openssl rand -base64 32)");
  }
  return key;
}

/** AES-256-GCM. Lets the freelancer re-copy a link without storing it in plaintext. */
export function encryptToken(token: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const ct = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptToken(payload: string, secret: string): string {
  const [version, iv, tag, ct] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !ct) throw new Error("Unrecognised token format");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

export function isPlausibleToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{32,128}$/.test(token);
}
