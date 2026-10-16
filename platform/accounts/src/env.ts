// Use the module form so Worker globals do not replace Node's Buffer types.
import type { D1Database, RateLimit } from "@cloudflare/workers-types/index.ts";

export interface Env {
  DB: D1Database;
  EMAIL_AUTH_LIMIT: RateLimit;
  AUTH_ORIGINS: string;
  LOCAL_DEVELOPMENT?: string;
}
