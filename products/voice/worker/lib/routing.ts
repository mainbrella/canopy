import type { Env } from "../env";

export function voiceBasePath(env: Env): string {
  const path = env.VOICE_BASE_PATH ?? "";
  if (path !== "" && (path !== "/installed/voice" || env.VOICE_AUTH_MODE !== "canopy")) {
    throw new Error("Invalid Voice mount configuration");
  }
  return path;
}

// Preserve the original request URL for carrier signatures and origin checks.
export function voiceURL(request: Request, env: Env): URL {
  const url = new URL(request.url);
  const base = voiceBasePath(env);
  if (base) {
    if (!url.pathname.startsWith(`${base}/`)) throw new Error("Request is outside the Voice mount");
    url.pathname = url.pathname.slice(base.length);
  }
  return url;
}
