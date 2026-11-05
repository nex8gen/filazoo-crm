import { createHash, randomBytes } from "node:crypto";

export function invitationToken() { return randomBytes(32).toString("base64url"); }
export function invitationHash(token: string) { return createHash("sha256").update(token).digest("hex"); }
export function validInvitationToken(token: string) { return /^[A-Za-z0-9_-]{43}$/.test(token); }
