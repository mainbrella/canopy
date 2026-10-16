import { authJson, currentUser, hashToken, readJSON, sessionTokenHash, type StringHeaders } from "./auth-core.ts";
import { isOperator, productAllowed } from "./product-access.ts";
import type { Env } from "./env.ts";
import type { VoiceInstallation } from "@canopy/contracts/products";
import type { RequestInit as WorkerRequestInit } from "@cloudflare/workers-types/index.ts";

interface Installation {
  installation_id: string; origin: string; version: string; state: "installing" | "installed" | "failed";
  verification_json: string | null;
  base_path: string;
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
  const base = installation.base_path;
  if (base && (base !== "/installed/voice" || !env.VOICE || !env.AUTH_ORIGINS.split(",").map(value => value.trim()).includes(installation.origin))) {
    throw new Error("Voice mount unavailable");
  }
  const options = {
    method: body ? "POST" : "GET", redirect: "manual", signal: AbortSignal.timeout(5000),
    headers: { authorization: `Bearer ${env.VOICE_AUTH_SECRET}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  } as const;
  const url = `${installation.origin}${base}${path}`;
  return base ? await env.VOICE!.fetch(url, options as unknown as WorkerRequestInit) as unknown as Response : fetch(url, options);
}

async function internal(request: Request, env: Env, path: string): Promise<Response> {
  if (request.method !== "POST") return authJson({ error: "method_not_allowed" }, 405);
  if (request.headers.has("origin") || !env.VOICE_AUTH_SECRET || env.VOICE_AUTH_SECRET.length < 64
    || await hashToken(request.headers.get("authorization") || "") !== await hashToken(`Bearer ${env.VOICE_AUTH_SECRET}`)) {
    return authJson({ error: "not_authenticated" }, 401);
  }
  const body = await readJSON(request, 1000);
  const installation = await env.DB.prepare("SELECT installation_id FROM product_installations WHERE product='voice' AND state='installed'").first();
  if (path === "/internal/voice/authorize") {
    if (typeof body?.userId !== "string" || body.userId.length > 128) return authJson({ error: "invalid_request" }, 400);
    const allowed = Boolean(installation) && await productAllowed(env, "voice", body.userId);
    return authJson({ allowed, billingMode: env.VOICE_BILLING_MODE ?? null }, allowed ? 200 : 403);
  }
  if (typeof body?.sessionHash !== "string" || !/^[a-f0-9]{64}$/.test(body.sessionHash)) return authJson({ error: "invalid_request" }, 400);
  const user = await env.DB.prepare("SELECT user_id AS id FROM sessions WHERE token_hash=? AND expires_at>?")
    .bind(body.sessionHash, new Date().toISOString()).first<{ id: string }>();
  return authJson({ user: installation && user && await productAllowed(env, "voice", user.id) ? user : null }, 200);
}

export async function handleProducts(request: Request, env: Env, cors: StringHeaders): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (["/internal/voice/session", "/internal/voice/authorize"].includes(path)) return internal(request, env, path);
  const match = /^\/products\/(voice|cut)(?:\/(open|install|access))?$/.exec(path);
  if (!match) return authJson({ error: "not_found" }, 404, cors);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const [, product, action] = match;
  if (request.method !== (action ? "POST" : "GET")) return authJson({ error: "method_not_allowed" }, 405, cors);
  if (action && !request.headers.get("origin")) return authJson({ error: "origin_not_allowed" }, 403, cors);
  const user = await currentUser(env, request);
  if (action && !user) return authJson({ error: "not_authenticated" }, 401, cors);
  const operator = Boolean(user && isOperator(env, user.id));
  if (action === "install" || action === "access") {
    if (!operator) return authJson({ error: "operator_required" }, 403, cors);
    if (action === "access") {
      const body = await readJSON(request, 1000);
      if (typeof body?.userId !== "string" || body.userId.length > 128 || typeof body.allowed !== "boolean") return authJson({ error: "invalid_request" }, 400, cors);
      if (!await env.DB.prepare("SELECT id FROM users WHERE id=?").bind(body.userId).first()) return authJson({ error: "user_not_found" }, 404, cors);
      if (body.allowed) await env.DB.prepare("INSERT OR IGNORE INTO product_access(product,user_id,granted_by,created_at) VALUES(?,?,?,?)")
        .bind(product, body.userId, user!.id, new Date().toISOString()).run();
      else await env.DB.prepare("DELETE FROM product_access WHERE product=? AND user_id=?").bind(product, body.userId).run();
      return authJson({ ok: true }, 200, cors);
    }
    if (product === "voice" && (env.VOICE_INSTALL_ENABLED !== "true" || env.VOICE_BILLING_MODE !== "owner_funded")) return authJson({ error: "installation_unavailable" }, 503, cors);
    if (product === "cut" && (!env.APPFLARE_ORIGIN || !validOrigin(env.APPFLARE_ORIGIN, env))) return authJson({ error: "installation_unavailable" }, 503, cors);
    const installed = await env.DB.prepare("SELECT state FROM product_installations WHERE product=?").bind(product).first<{state: string}>();
    if (installed?.state === "installed") return authJson({ error: "already_installed" }, 409, cors);
    // One durable request per product; duplicates and retries retain its identity.
    await env.DB.prepare(`INSERT INTO product_install_requests(product,request_id,requested_by,state,updated_at) VALUES(?,?,?,'pending',?)
      ON CONFLICT(product) DO UPDATE SET state='pending',updated_at=excluded.updated_at WHERE product_install_requests.state='failed'`)
      .bind(product, crypto.randomUUID(), user!.id, new Date().toISOString()).run();
    const job = await env.DB.prepare("SELECT request_id,state FROM product_install_requests WHERE product=?").bind(product).first();
    return authJson({ ...job, ...(product === "cut" ? { url: `${env.APPFLARE_ORIGIN}/install/cut` } : {}) }, 202, cors);
  }
  const allowed = Boolean(user && await productAllowed(env, product, user.id));
  if (action === "open" && !allowed) return authJson({ error: "product_access_denied" }, 403, cors);
  const installation = await env.DB.prepare("SELECT installation_id,origin,version,state,verification_json,base_path FROM product_installations WHERE product=?").bind(product).first<Installation>();
  const job = await env.DB.prepare("SELECT state FROM product_install_requests WHERE product=?").bind(product).first<{state: string}>();
  const status: VoiceInstallation = {
    product: product as "voice" | "cut", state: "not_installed", version: null, origin: null,
    access: !user ? "sign_in" : allowed ? "allowed" : "denied",
    canManageAccess: operator,
    canInstall: operator && (product === "voice" ? env.VOICE_INSTALL_ENABLED === "true" && env.VOICE_BILLING_MODE === "owner_funded" : Boolean(env.APPFLARE_ORIGIN && validOrigin(env.APPFLARE_ORIGIN, env))),
    identity: product === "voice" ? "canopy" : "own", billing: false,
  };
  if (installation) {
    status.version = installation.version;
    status.state = installation.state === "installed" ? "unavailable" : installation.state;
    if (installation.state === "installed") {
      try {
        if (product === "voice") {
          const response = await voiceRequest(env, installation, "/_canopy/ready");
          const ready = await response.json() as Record<string, unknown>;
          if (response.ok && ready.ready === true && ready.installationId === installation.installation_id && ready.version === installation.version) {
            status.state = "ready"; status.origin = installation.origin;
            if (installation.base_path) status.basePath = "/installed/voice";
          }
        } else if (installation.verification_json && validOrigin(installation.origin, env)) {
          // Registration evidence proves ownership/version; this probe proves reachability only.
          const response = await fetch(`${installation.origin}/admin`, { redirect: "manual", signal: AbortSignal.timeout(5000) });
          if (response.status >= 200 && response.status < 400) { status.state = "registered"; status.origin = installation.origin; }
        }
      } catch { /* Missing runtime evidence stays unavailable. */ }
    }
  }
  if ((!installation || installation.state !== "installed") && job) {
    if (job.state === "pending") status.state = "pending";
    if (job.state === "failed") status.state = "failed";
  }
  if (!action) return authJson(status, 200, cors);
  if (!installation || !["ready", "registered"].includes(status.state)) return authJson({ error: "product_unavailable" }, 503, cors);
  if (product === "cut") return authJson({ url: `${installation.origin}/admin` }, 200, cors);
  const response = await voiceRequest(env, installation, "/_canopy/handoffs", {
    installationId: installation.installation_id, userId: user!.id, sessionHash: await sessionTokenHash(env, request),
  });
  const handoff = await response.json() as { code?: unknown };
  if (!response.ok || typeof handoff.code !== "string" || !/^[a-f0-9]{64}$/.test(handoff.code)) return authJson({ error: "voice_unavailable" }, 503, cors);
  return authJson({ url: `${installation.origin}${installation.base_path}/handoff.html#${handoff.code}` }, 200, cors);
}
