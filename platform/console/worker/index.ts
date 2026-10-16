import type { Fetcher } from "@cloudflare/workers-types/index.ts";

interface Env { ASSETS: Fetcher; VOICE?: Fetcher }
const mount = "/installed/voice";

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== mount && !url.pathname.startsWith(`${mount}/`)) return env.ASSETS.fetch(request);
  if (!env.VOICE) return Response.json({ error: "voice_not_installed" }, { status: 404 });
  const readiness = url.pathname === `${mount}/_canopy/ready` && request.method === "GET"
    && !request.headers.has("origin") && /^Bearer [a-f0-9]{64}$/.test(request.headers.get("authorization") ?? "");
  if (url.pathname.startsWith(`${mount}/_canopy/`) && !readiness) return new Response(null, { status: 404 });
  const headers = new Headers(request.headers);
  // Only the product's session belongs in this product's runtime.
  const cookie = headers.get("cookie")?.split(";").map(value => value.trim())
    .filter(value => /^(?:__Host-)?canopy_voice_session=/.test(value)).join("; ");
  headers.delete("cookie");
  if (!readiness) headers.delete("authorization");
  if (cookie) headers.set("cookie", cookie);
  try { return await env.VOICE.fetch(new Request(request, { headers })); }
  catch { return Response.json({ error: "voice_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } }); }
}

export default { fetch: handleRequest };
