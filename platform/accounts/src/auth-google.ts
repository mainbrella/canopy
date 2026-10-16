// Browser Google verification/account lookup adapted from backend/worker/app/auth-core.ts.
// No native tokens, review users, welcome email, or product side effects.
import { isRecord } from "@canopy/contracts/auth";
import { AuthError, type AuthUser } from "./auth-core.ts";
import type { Env } from "./env.ts";

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
interface GoogleIdentity { googleSub: string; email: string; name: string }
type StoredUser = AuthUser & { password_hash: string | null };

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new AuthError("invalid_google_credential");
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), char => char.charCodeAt(0));
  } catch { throw new AuthError("invalid_google_credential"); }
}

function decodeJSONPart(value: string): Record<string, unknown> {
  try {
    const decoded: unknown = JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
    if (isRecord(decoded)) return decoded;
  } catch { /* Invalid input receives the same public error. */ }
  throw new AuthError("invalid_google_credential");
}

export async function verifyGoogleIdToken(credential: unknown, env: Env): Promise<GoogleIdentity> {
  const clientID = env.GOOGLE_CLIENT_ID?.trim();
  if (!clientID) throw new AuthError("google_unavailable", 503);
  if (typeof credential !== "string" || credential.length > 10_000) throw new AuthError("invalid_google_credential");
  const parts = credential.split(".");
  if (parts.length !== 3) throw new AuthError("invalid_google_credential");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJSONPart(encodedHeader);
  const claims = decodeJSONPart(encodedPayload);
  const signature = decodeBase64Url(encodedSignature);
  if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid || "crit" in header) {
    throw new AuthError("invalid_google_credential");
  }

  let keys: Record<string, unknown>[];
  try {
    // Only Google's fixed endpoint is trusted; token headers cannot select a URL.
    const response = await fetch(GOOGLE_JWKS_URL, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Google keys unavailable");
    const keySet: unknown = await response.json();
    if (!isRecord(keySet) || !Array.isArray(keySet.keys) || !keySet.keys.length || !keySet.keys.every(isRecord)) {
      throw new Error("Invalid Google key response");
    }
    keys = keySet.keys;
  } catch { throw new AuthError("google_unavailable", 503); }
  const jwk = keys.find(key => key.kid === header.kid);
  if (!jwk) throw new AuthError("invalid_google_credential");
  let publicKey: CryptoKey;
  try {
    if (jwk.kty !== "RSA" || (jwk.alg !== undefined && jwk.alg !== "RS256") || (jwk.use !== undefined && jwk.use !== "sig")) {
      throw new Error("Invalid Google signing key");
    }
    publicKey = await crypto.subtle.importKey(
      "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
    );
  } catch { throw new AuthError("google_unavailable", 503); }
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", publicKey, signature, new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!valid) throw new AuthError("invalid_google_credential");

  const now = Math.floor(Date.now() / 1000);
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (typeof claims.iss !== "string" || !GOOGLE_ISSUERS.has(claims.iss) || claims.aud !== clientID
    || typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255
    || claims.email_verified !== true || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254
    || typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= now
    || typeof claims.iat !== "number" || !Number.isFinite(claims.iat) || claims.iat > now + 60 || claims.exp <= claims.iat
    || (claims.nbf !== undefined && (typeof claims.nbf !== "number" || !Number.isFinite(claims.nbf) || claims.nbf > now))) {
    throw new AuthError("invalid_google_credential");
  }
  return { googleSub: claims.sub, email, name: typeof claims.name === "string" ? claims.name : "" };
}

export async function findOrCreateGoogleUser(env: Env, identity: GoogleIdentity): Promise<{ user: AuthUser; created: boolean }> {
  if (!env.DB) throw new AuthError("auth_unavailable", 503);
  const readUser = async () => await env.DB.prepare(
    "SELECT id, email, name, dob, google_sub, created_at, password_hash FROM users WHERE google_sub = ? LIMIT 1",
  ).bind(identity.googleSub).first<StoredUser>() || await env.DB.prepare(
    "SELECT id, email, name, dob, google_sub, created_at, password_hash FROM users WHERE lower(email) = ? LIMIT 1",
  ).bind(identity.email).first<StoredUser>();
  const existing = await readUser();
  if (existing?.google_sub === identity.googleSub) return { user: existing, created: false };
  if (existing && (existing.google_sub !== null || existing.password_hash !== null)) {
    throw new AuthError("identity_conflict", 409);
  }
  const name = identity.name.trim().replace(/\s+/g, " ").slice(0, 120) || identity.email.split("@")[0].slice(0, 120);
  const id = crypto.randomUUID();
  try {
    if (existing) {
      // Preserve legacy credential-free linking, but never replace a credential
      // installed by a concurrent request after the lookup above.
      await env.DB.prepare(
        "UPDATE users SET google_sub = ?, name = ? WHERE id = ? AND google_sub IS NULL AND password_hash IS NULL",
      ).bind(identity.googleSub, name, existing.id).run();
    } else {
      // Respect mixed-case emails and both provider races atomically.
      await env.DB.prepare(
        `INSERT INTO users (id, email, name, google_sub)
         SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(email) = ? OR google_sub = ?)`,
      ).bind(id, identity.email, name, identity.googleSub, identity.email, identity.googleSub).run();
    }
  } catch (error) {
    if (!String(error instanceof Error ? error.message : error).toLowerCase().includes("unique")) throw error;
  }
  // Re-read once rather than recursively retrying; only the winning identity
  // may get a session. A password signup winning the race is a conflict too.
  const saved = await readUser();
  if (!saved) throw new AuthError("auth_unavailable", 503);
  if (saved.google_sub !== identity.googleSub) throw new AuthError("identity_conflict", 409);
  return { user: saved, created: saved.id === id };
}
