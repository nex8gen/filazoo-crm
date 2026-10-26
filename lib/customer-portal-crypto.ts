import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export function portalEmail(email: string) { return email.trim().toLowerCase(); }
export function portalHash(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function portalToken() { return randomBytes(32).toString("base64url"); }
export function invoicePortalKey(id: string, email: string, secret: string) {
  return createHmac("sha256", secret).update(JSON.stringify(["customer-invoice-v1", id, portalEmail(email)])).digest("base64url");
}
export function validPortalKey(key: string, id: string, email: string, secret: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) return false;
  return timingSafeEqual(Buffer.from(key), Buffer.from(invoicePortalKey(id, email, secret)));
}
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashPortalPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt-v1:${salt}:${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyPortalPassword(password: string, stored: string) {
  const [version, salt, hash] = stored.split(":");
  if (version !== "scrypt-v1" || !/^[a-f0-9]{32}$/.test(salt ?? "") || !/^[a-f0-9]{128}$/.test(hash ?? "")) return false;
  return timingSafeEqual(await derive(password, salt), Buffer.from(hash, "hex"));
}
