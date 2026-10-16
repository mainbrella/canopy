import type test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { handleRequest } from "../src/index.ts";
import type { Env } from "../src/env.ts";

// Adapted from backend/worker/app/auth-email.test.ts. Real SQL and crypto;
// only the Cloudflare D1/limiter transport is adapted for node:test.
export function fixture(t: test.TestContext) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of ["001_initial.sql", "002_auth_sessions.sql", "012_email_password.sql"]) {
    sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  let limited = false;
  let googleLimited = false;
  const keys: string[] = [];
  const env = {
    AUTH_ORIGINS: "http://127.0.0.1:5175",
    LOCAL_DEVELOPMENT: "true",
    EMAIL_AUTH_LIMIT: { async limit({ key }: { key: string }) { keys.push(key); return { success: !limited }; } },
    GOOGLE_AUTH_LIMIT: { async limit({ key }: { key: string }) { keys.push(key); return { success: !googleLimited }; } },
    DB: { prepare(sql: string) {
      let values: SQLInputValue[] = [];
      return {
        bind(...args: SQLInputValue[]) { values = args; return this; },
        async first() { return sqlite.prepare(sql).get(...values) ?? null; },
        async run() { return sqlite.prepare(sql).run(...values); },
      };
    } },
  } as unknown as Env;
  const request = (path: string, init: RequestInit = {}) => handleRequest(new Request(`http://127.0.0.1:8789${path}`, init), env);
  const login = (email: unknown = "person@example.com", password: unknown = "a strong password", origin = "http://127.0.0.1:5175") => request("/auth/email", {
    method: "POST", headers: { "content-type": "application/json", Origin: origin, "CF-Connecting-IP": "192.0.2.1" },
    body: JSON.stringify({ email, password }),
  });
  return { sqlite, env, request, login, keys, setLimited() { limited = true; }, setGoogleLimited() { googleLimited = true; } };
}
