import type { User } from "@canopy/contracts/auth";
import type { Env } from "./env.ts";

// Browser session subset of backend/worker/app/auth-core.ts.
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export interface AuthUser extends User { google_sub: string | null }
export type StringHeaders = Record<string, string>;

export class AuthError extends Error {
  constructor(message: string, readonly status = 401) {
    super(message);
    this.name = "AuthError";
  }
}

export function isLocalRequest(env: Env, request: Request): boolean {
  return env.LOCAL_DEVELOPMENT === "true"
    && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname);
}

export function authCorsHeaders(request: Request, env: Env): StringHeaders | null {
  const origin = request.headers.get("Origin");
  if (!origin) return {};
  if (!(env.AUTH_ORIGINS || "").split(",").map(value => value.trim()).includes(origin)) return null;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

export function authJson(body: unknown, status: number, headers: StringHeaders = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export async function readJSON(request: Request, maxBytes: number): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get("Content-Length") || 0) > maxBytes || !request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export function publicUser(user: AuthUser): User {
  return { id: user.id, email: user.email, name: user.name, created_at: user.created_at, dob: user.dob };
}

export function randomToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function cookieName(env: Env, request: Request): string {
  // Local cookies must not replace sessions from the sibling apps on localhost.
  return isLocalRequest(env, request) ? "canopy_session" : env.SESSION_COOKIE_NAME || "mainbrella_session";
}

function readToken(env: Env, request: Request): string | null {
  const prefix = `${cookieName(env, request)}=`;
  const cookie = (request.headers.get("Cookie") || "").split(";")
    .map(part => part.trim()).find(part => part.startsWith(prefix));
  return cookie ? cookie.slice(prefix.length) : null;
}

function sessionCookie(env: Env, request: Request, token: string, maxAge: number): string {
  const attributes = isLocalRequest(env, request) ? "SameSite=Lax" : "SameSite=None; Secure";
  return `${cookieName(env, request)}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; ${attributes}`;
}

export function expiredSessionCookie(env: Env, request: Request): string {
  return sessionCookie(env, request, "", 0);
}

export async function createSession(env: Env, request: Request, userID: string): Promise<string> {
  const token = randomToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now.toISOString()).run();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await hashToken(token), userID, expiresAt).run();
  return sessionCookie(env, request, token, SESSION_MAX_AGE_SECONDS);
}

export async function currentUser(env: Env, request: Request): Promise<AuthUser | null> {
  const token = readToken(env, request);
  if (!token) return null;
  return env.DB.prepare(
    `SELECT users.id, users.email, users.name, users.dob, users.google_sub, users.created_at
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ? LIMIT 1`,
  ).bind(await hashToken(token), new Date().toISOString()).first<AuthUser>();
}

export async function revokeSession(env: Env, request: Request): Promise<void> {
  const token = readToken(env, request);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await hashToken(token)).run();
}
