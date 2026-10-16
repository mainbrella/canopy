import { authJson, currentUser, hashToken, readJSON, sessionTokenHash, type StringHeaders } from "./auth-core.ts";
import type { Env } from "./env.ts";
import type { VoiceInstallation } from "@canopy/contracts/products";

interface Installation {
  installation_id: string; origin: string; version: string; state: "installing" | "installed" | "failed";
}

function validOrigin(value: string, env: Env): boolean {
  try {
    const url = new URL(value);
    return url.origin === value && (url.protocol === "https:" || env.LOCAL_DEVELOPMENT === "true"
      && url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname));
  } catch { return false; }
}

async function voiceRequest(env: Env, installation: Installation, path: string, body?: unknown): Promise<Response> {
  if (!validOrigin(installation.origin, env) || !env.VOICE_AUTH_SECRET || env.VOICE_AUTH_SECRET.length < 64) throw new Error("Voice configuration unavailable");
  return fetch(`${installation.origin}${path}`, {
    method: body ? "POST" : "GET", redirect: "manual", signal: AbortSignal.timeout(5000),
    headers: { authorization: `Bearer ${env.VOICE_AUTH_SECRET}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function handleProducts(request: Request, env: Env, cors: StringHeaders): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === "/internal/voice/session") {
    if (request.method !== "POST") return authJson({ error: "method_not_allowed" }, 405);
    if (!env.VOICE_AUTH_SECRET || env.VOICE_AUTH_SECRET.length < 64
      || await hashToken(request.headers.get("authorization") || "") !== await hashToken(`Bearer ${env.VOICE_AUTH_SECRET}`)) {
      return authJson({ error: "not_authenticated" }, 401);
    }
    const body = await readJSON(request, 1000);
    if (typeof body?.sessionHash !== "string" || !/^[a-f0-9]{64}$/.test(body.sessionHash)) return authJson({ error: "invalid_request" }, 400);
    const user = await env.DB.prepare("SELECT user_id AS id FROM sessions WHERE token_hash=? AND expires_at>?")
      .bind(body.sessionHash, new Date().toISOString()).first<{ id: string }>();
    return authJson({ user: user ?? null }, 200);
  }
  if (!["/products/voice", "/products/voice/open"].includes(path)) return authJson({ error: "not_found" }, 404, cors);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const opening = path.endsWith("/open");
  if (request.method !== (opening ? "POST" : "GET")) return authJson({ error: "method_not_allowed" }, 405, cors);
  // Opening mints a short-lived login credential: require an explicit trusted browser origin.
  if (opening && !request.headers.get("origin")) return authJson({ error: "origin_not_allowed" }, 403, cors);
  const user = opening ? await currentUser(env, request) : null;
  if (opening && !user) return authJson({ error: "not_authenticated" }, 401, cors);
  const installation = await env.DB.prepare("SELECT installation_id,origin,version,state FROM product_installations WHERE product='voice'").first<Installation>();
  const status: VoiceInstallation = { product: "voice", state: "not_installed", version: null, origin: null };
  if (installation) {
    status.version = installation.version;
    status.state = installation.state === "installed" ? "unavailable" : installation.state;
    if (installation.state === "installed") {
      try {
        const response = await voiceRequest(env, installation, "/_canopy/ready");
        const ready = await response.json() as Record<string, unknown>;
        if (response.ok && ready.ready === true && ready.installationId === installation.installation_id && ready.version === installation.version) {
          status.state = "ready";
          status.origin = installation.origin;
        }
      } catch { /* Missing or mismatched runtime evidence is never reported as installed. */ }
    }
  }
  if (!opening) return authJson(status, 200, cors);
  if (status.state !== "ready" || !installation) return authJson({ error: "voice_unavailable" }, 503, cors);
  const response = await voiceRequest(env, installation, "/_canopy/handoffs", {
    installationId: installation.installation_id, userId: user!.id, sessionHash: await sessionTokenHash(env, request),
  });
  const handoff = await response.json() as { code?: unknown };
  if (!response.ok || typeof handoff.code !== "string" || !/^[a-f0-9]{64}$/.test(handoff.code)) return authJson({ error: "voice_unavailable" }, 503, cors);
  return authJson({ url: `${installation.origin}/handoff.html#${handoff.code}` }, 200, cors);
}
