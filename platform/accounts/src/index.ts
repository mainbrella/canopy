import {
  AuthError, authCorsHeaders, authJson, createSession, currentUser,
  expiredSessionCookie, isLocalRequest, publicUser, readJSON, revokeSession,
} from "./auth-core.ts";
import { signInOrCreateEmailUser } from "./auth-email.ts";
import { findOrCreateGoogleUser, verifyGoogleIdToken } from "./auth-google.ts";
import type { Env } from "./env.ts";
import { handleProducts } from "./products.ts";

// Browser auth only; native tokens and product side effects remain outside Canopy.
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const cors = authCorsHeaders(request, env);
  if (!cors) return authJson({ error: "origin_not_allowed" }, 403);
  const path = new URL(request.url).pathname;
  if (path.startsWith("/products/") || path.startsWith("/internal/voice/")) {
    try { return await handleProducts(request, env, cors); }
    catch { return authJson({ error: "product_unavailable" }, 503, cors); }
  }
  if (!["/auth/email", "/auth/google", "/auth/me", "/auth/logout"].includes(path)) return authJson({ error: "not_found" }, 404, cors);
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
    const google = path === "/auth/google";
    if (google && !env.GOOGLE_CLIENT_ID?.trim()) return authJson({ error: "google_unavailable" }, 503, cors);
    const address = request.headers.get("CF-Connecting-IP") || (isLocalRequest(env, request) ? "loopback" : null);
    const limiter = google ? env.GOOGLE_AUTH_LIMIT : env.EMAIL_AUTH_LIMIT;
    if (!limiter || !address) return authJson({ error: "auth_unavailable" }, 503, cors);
    const { success } = await limiter.limit({ key: `${google ? "google" : "email"}:${address}` });
    if (!success) return authJson({ error: "rate_limited" }, 429, { ...cors, "retry-after": "60" });
    const body = await readJSON(request, google ? 20_000 : 2000);
    if (!body) return authJson({ error: "invalid_request" }, 400, cors);
    const { user, created } = google
      ? await findOrCreateGoogleUser(env, await verifyGoogleIdToken(body.credential, env))
      : await signInOrCreateEmailUser(env, body.email, body.password);
    return authJson({ user: publicUser(user), created }, 200, { ...cors, "set-cookie": await createSession(env, request, user.id) });
  } catch (error) {
    if (error instanceof AuthError) return authJson({ error: error.message }, error.status, cors);
    console.error("auth_error", error);
    return authJson({ error: "auth_unavailable" }, 503, cors);
  }
}

export default { fetch: handleRequest };
