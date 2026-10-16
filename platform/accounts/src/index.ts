import {
  AuthError, authCorsHeaders, authJson, createSession, currentUser,
  expiredSessionCookie, isLocalRequest, publicUser, readJSON, revokeSession,
} from "./auth-core.ts";
import { signInOrCreateEmailUser } from "./auth-email.ts";
import type { Env } from "./env.ts";

// Only the browser email/session routes are brought over from backend/worker/app/auth.ts.
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const cors = authCorsHeaders(request, env);
  if (!cors) return authJson({ error: "origin_not_allowed" }, 403);
  const path = new URL(request.url).pathname;
  if (!["/auth/email", "/auth/me", "/auth/logout"].includes(path)) return authJson({ error: "not_found" }, 404, cors);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const method = path === "/auth/me" ? "GET" : "POST";
  if (request.method !== method) return authJson({ error: "method_not_allowed" }, 405, { ...cors, allow: `${method}, OPTIONS` });
  if (!env.DB) return authJson({ error: "auth_unavailable" }, 503, cors);

  try {
    if (path === "/auth/me") {
      const user = await currentUser(env, request);
      return authJson({ user: user ? publicUser(user) : null }, 200, cors);
    }
    if (path === "/auth/logout") {
      await revokeSession(env, request);
      return authJson({ ok: true }, 200, { ...cors, "set-cookie": expiredSessionCookie(env, request) });
    }
    const address = request.headers.get("CF-Connecting-IP") || (isLocalRequest(env, request) ? "loopback" : null);
    if (!env.EMAIL_AUTH_LIMIT || !address) return authJson({ error: "auth_unavailable" }, 503, cors);
    const { success } = await env.EMAIL_AUTH_LIMIT.limit({ key: `email:${address}` });
    if (!success) return authJson({ error: "rate_limited" }, 429, { ...cors, "retry-after": "60" });
    const body = await readJSON(request, 2000);
    if (!body) return authJson({ error: "invalid_request" }, 400, cors);
    const { user, created } = await signInOrCreateEmailUser(env, body.email, body.password);
    return authJson({ user: publicUser(user), created }, 200, { ...cors, "set-cookie": await createSession(env, request, user.id) });
  } catch (error) {
    if (error instanceof AuthError) return authJson({ error: error.message }, error.status, cors);
    console.error("auth_error", error);
    return authJson({ error: "auth_unavailable" }, 503, cors);
  }
}

export default { fetch: handleRequest };
