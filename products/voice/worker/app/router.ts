import type { Env } from "../env";
import { authJson, canopyConfigured, handleAuth } from "./auth-core";
import { handleVoiceRequest } from "./voice";
import { handleCanopy } from "./canopy";
import { voiceBasePath, voiceURL } from "../lib/routing";

export async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const publicURL = new URL(request.url);
    const base = voiceBasePath(env);
    if (base && publicURL.origin === env.VOICE_LEGACY_ORIGIN) {
      if (!["GET", "HEAD"].includes(request.method)) return authJson({ error: "voice_moved" }, 410);
      return Response.redirect(`${env.VOICE_PUBLIC_ORIGIN}${base}${publicURL.pathname}${publicURL.search}`, 308);
    }
    if (base && publicURL.origin !== env.VOICE_PUBLIC_ORIGIN) return authJson({ error: "not_found" }, 404);
    if (base && publicURL.pathname === base) return Response.redirect(`${publicURL.origin}${base}/${publicURL.search}`, 308);
    if (base && !publicURL.pathname.startsWith(`${base}/`)) return authJson({ error: "not_found" }, 404);
    const url = voiceURL(request, env);
    const path = url.pathname;
    if (path === "/health" && request.method === "GET") return authJson({ ok: true });
    if (path.startsWith("/_canopy/") || path === "/auth/canopy") return await handleCanopy(request, env);
    if (["/login", "/login.html"].includes(path) && env.VOICE_AUTH_MODE === "canopy") {
      return canopyConfigured(env) ? Response.redirect(`${env.CANOPY_CONSOLE_ORIGIN}/#/products/voice`, 302)
        : authJson({ error: "login_unavailable" }, 503);
    }
    if (path.startsWith("/auth/")) return await handleAuth(request, env);
    if (path.startsWith("/voice/")) return await handleVoiceRequest(request, env, ctx);
    // Never expose the SDK's unauthenticated /agents RPC/state endpoints.
    if (path.startsWith("/agents/") || path.startsWith("/__")) return authJson({ error: "not_found" }, 404);
    const response = await env.ASSETS.fetch(base ? new Request(url, request) : request);
    const location = response.headers.get("location");
    if (base && location) {
      const redirect = new URL(location, url);
      if (redirect.origin === url.origin) {
        redirect.pathname = `${base}${redirect.pathname}`;
        const headers = new Headers(response.headers);
        headers.set("location", redirect.href);
        return new Response(response.body, { status: response.status, headers });
      }
    }
    return response;
  } catch {
    console.error("receptionist_request_failed");
    return authJson({ error: "voice_unavailable" }, 503);
  }
}

