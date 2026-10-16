import type { Env } from "../worker/env";
import fixture from "./fixture-worker";
export { ReceptionistCall } from "./fixture-worker";

// This entrypoint is only bundled by the browser test server, never Wrangler.
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const path = new URL(request.url).pathname;
    if (path === "/__ready") {
      try {
        await env.DB.prepare("SELECT COUNT(*) FROM number_search_attempts").first();
        return new Response("ready");
      } catch { return new Response("starting", { status: 503 }); }
    }
    if (path.startsWith("/__")) return new Response(null, { status: 404 });
    return fixture.fetch(request, env, ctx);
  },
};
