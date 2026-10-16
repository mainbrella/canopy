import { handleRequest } from "../src/index.ts";
import type { Env } from "../src/env.ts";

// Deterministic test limiter; the production entrypoint and SQL are unchanged.
export default {
  fetch(request: Request, env: Env) {
    return handleRequest(request, { ...env, EMAIL_AUTH_LIMIT: { async limit() { return { success: true }; } } as Env["EMAIL_AUTH_LIMIT"] });
  },
};
