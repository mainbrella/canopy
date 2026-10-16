import type { Env } from "../env";
import { authJson, canopyConfigured, cookie, hashToken, readJSON, validPlatformSession } from "./auth-core";

const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

export async function handleCanopy(request: Request, env: Env): Promise<Response> {
  if (!canopyConfigured(env)) return authJson({ error: "not_found" }, 404);
  const url = new URL(request.url);
  if (url.search) return authJson({ error: "invalid_request" }, 400);
  if (url.pathname === "/auth/canopy") {
    if (request.method !== "POST") return authJson({ error: "method_not_allowed" }, 405);
    if (request.headers.get("origin") !== url.origin) return authJson({ error: "origin_not_allowed" }, 403);
    const body = await readJSON(request, 1000) as { code?: unknown } | null;
    if (typeof body?.code !== "string" || !/^[a-f0-9]{64}$/.test(body.code)) return authJson({ error: "invalid_handoff" }, 401);
    // DELETE RETURNING makes exchange single-use even across concurrent requests.
    const handoff = await env.DB.prepare("DELETE FROM canopy_handoffs WHERE token_hash=? AND expires_at>? RETURNING user_id,platform_session_hash")
      .bind(await hashToken(body.code), Date.now()).first<{ user_id: string; platform_session_hash: string }>();
    if (!handoff || !await validPlatformSession(env, handoff.platform_session_hash, handoff.user_id)) return authJson({ error: "invalid_handoff" }, 401);
    const session = token();
    await env.DB.prepare("INSERT INTO sessions(token_hash,password_hash,expires_at,user_id,platform_session_hash) VALUES(?,?,?,?,?)")
      .bind(await hashToken(session), await hashToken(env.CANOPY_AUTH_SECRET!), Date.now() + 8 * 60 * 60 * 1000,
        handoff.user_id, handoff.platform_session_hash).run();
    return new Response(null, { status: 204, headers: { "set-cookie": cookie(request, session, 8 * 60 * 60), "cache-control": "no-store" } });
  }
  if (request.headers.has("origin") || await hashToken(request.headers.get("authorization") || "") !== await hashToken(`Bearer ${env.CANOPY_AUTH_SECRET}`)) {
    return authJson({ error: "not_authenticated" }, 401);
  }
  if (url.pathname === "/_canopy/ready" && request.method === "GET") {
    // Exercise the installed schema. Liveness alone is insufficient for readiness.
    await env.DB.prepare("SELECT user_id,platform_session_hash FROM sessions LIMIT 1").first();
    await env.DB.prepare("SELECT token_hash FROM canopy_handoffs LIMIT 1").first();
    await env.DB.prepare("SELECT id,model FROM voice_agents LIMIT 1").first();
    const ready = Boolean(env.AI && env.RECEPTIONIST_CALL && env.VOICE_ENABLED === "true");
    return authJson({ ready, installationId: env.CANOPY_INSTALLATION_ID, version: env.CANOPY_SOURCE_VERSION }, ready ? 200 : 503);
  }
  if (url.pathname !== "/_canopy/handoffs") return authJson({ error: "not_found" }, 404);
  if (request.method !== "POST") return authJson({ error: "method_not_allowed" }, 405);
  const body = await readJSON(request, 1500) as { installationId?: unknown; userId?: unknown; sessionHash?: unknown } | null;
  if (body?.installationId !== env.CANOPY_INSTALLATION_ID || !identifier(body?.userId)
    || typeof body.sessionHash !== "string" || !/^[a-f0-9]{64}$/.test(body.sessionHash)) return authJson({ error: "invalid_request" }, 400);
  const code = token();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM canopy_handoffs WHERE expires_at<=?").bind(Date.now()),
    env.DB.prepare("INSERT INTO canopy_handoffs(token_hash,user_id,platform_session_hash,expires_at) VALUES(?,?,?,?)")
      .bind(await hashToken(code), body.userId, body.sessionHash, Date.now() + 60_000),
  ]);
  return authJson({ code }, 201);
}
