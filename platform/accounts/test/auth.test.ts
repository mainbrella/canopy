import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { handleRequest } from "../src/index.ts";
import { hashToken } from "../src/auth-core.ts";
import type { Env } from "../src/env.ts";
import type { SignInResult } from "@canopy/contracts/auth";
import type { D1Database, RateLimit } from "@cloudflare/workers-types/index.ts";

// Adapted from backend/worker/app/auth-email.test.ts. Run real SQL and password
// hashing; only the Cloudflare D1/limiter transport is adapted for node:test.
function fixture(t: test.TestContext) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of ["001_initial.sql", "002_auth_sessions.sql", "012_email_password.sql"]) {
    sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  let limited = false;
  const keys: string[] = [];
  const env = {
    AUTH_ORIGINS: "http://127.0.0.1:5175",
    LOCAL_DEVELOPMENT: "true",
    EMAIL_AUTH_LIMIT: { async limit({ key }: { key: string }) { keys.push(key); return { success: !limited }; } },
    DB: { prepare(sql: string) {
      let values: SQLInputValue[] = [];
      return {
        bind(...args: SQLInputValue[]) { values = args; return this; },
        async first() { return sqlite.prepare(sql).get(...values) ?? null; },
        async run() { return sqlite.prepare(sql).run(...values); },
      };
    } },
  } as unknown as Env;
  const request = (path: string, init: RequestInit = {}) => handleRequest(new Request(`http://127.0.0.1:8789${path}`, init) as Request, env);
  const login = (email: unknown = "person@example.com", password: unknown = "a strong password", origin = "http://127.0.0.1:5175") => request("/auth/email", {
    method: "POST", headers: { "content-type": "application/json", Origin: origin, "CF-Connecting-IP": "192.0.2.1" },
    body: JSON.stringify({ email, password }),
  });
  return { sqlite, env, request, login, keys, setLimited() { limited = true; } };
}

test("signup, returning login, session read and logout preserve the existing auth contract", async t => {
  const f = fixture(t);
  const first = await f.login(" Person@Example.COM ");
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.equal(first.headers.get("access-control-allow-origin"), "http://127.0.0.1:5175");
  const body = await first.json() as SignInResult;
  assert.equal(body.created, true);
  assert.equal(body.user.email, "person@example.com");
  assert.deepEqual(Object.keys(body.user).sort(), ["created_at", "dob", "email", "id", "name"]);
  const stored = f.sqlite.prepare("SELECT password_hash FROM users WHERE id = ?").get(body.user.id)?.password_hash;
  assert.match(String(stored), /^scrypt:16384:8:5:[a-f0-9]{32}:[a-f0-9]{64}$/);
  assert.ok(!String(stored).includes("a strong password"));
  const cookie = first.headers.get("set-cookie")!;
  assert.match(cookie, /^canopy_session=[a-f0-9]{64}; Max-Age=2592000; Path=\/; HttpOnly; SameSite=Lax$/);
  const token = cookie.split(";")[0].split("=")[1];
  assert.equal(f.sqlite.prepare("SELECT token_hash FROM sessions").get()?.token_hash, await hashToken(token));
  const headers = { Cookie: cookie.split(";")[0] };
  assert.deepEqual(await (await f.request("/auth/me", { headers })).json(), { user: body.user });
  const repeat = await f.login("PERSON@example.com");
  assert.deepEqual(await repeat.json(), { user: body.user, created: false });
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM users").get()?.count, 1);
  const wrong = await f.login("person@example.com", "wrong password");
  assert.equal(wrong.status, 401);
  assert.deepEqual(await wrong.json(), { error: "invalid_credentials" });
  assert.equal(wrong.headers.get("set-cookie"), null);
  const logout = await f.request("/auth/logout", { method: "POST", headers });
  assert.deepEqual(await logout.json(), { ok: true });
  assert.match(logout.headers.get("set-cookie")!, /^canopy_session=; Max-Age=0;/);
  assert.deepEqual(await (await f.request("/auth/me", { headers })).json(), { user: null });
  // Revoking one browser leaves the second browser's session intact.
  const otherHeaders = { Cookie: repeat.headers.get("set-cookie")!.split(";")[0] };
  assert.deepEqual(await (await f.request("/auth/me", { headers: otherHeaders })).json(), { user: body.user });
});

test("expired, unknown and sibling-app cookies cannot authenticate", async t => {
  const f = fixture(t);
  const response = await f.login();
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  f.sqlite.exec("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'");
  for (const Cookie of [cookie, "canopy_session=unknown", cookie.replace("canopy_session", "mainbrella_session"), ""]) {
    assert.deepEqual(await (await f.request("/auth/me", { headers: { Cookie } })).json(), { user: null });
  }
  await f.login();
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM sessions").get()?.count, 1);
});

test("email validation, password bounds and salts retain the existing behavior", async t => {
  const f = fixture(t);
  for (const [email, password, error] of [
    ["invalid", "password123", "invalid_request"], ["user@example.com", "short", "weak_password"],
    ["user@example.com", "", "invalid_request"], ["user@example.com", "x".repeat(129), "invalid_request"],
    [null, "password123", "invalid_request"], ["user@example.com", null, "invalid_request"],
  ]) {
    const response = await f.login(email, password);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error });
  }
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM users").get()?.count, 0);
  await f.login("one@example.com");
  await f.login("two@example.com");
  const rows = f.sqlite.prepare("SELECT password_hash FROM users").all();
  assert.notEqual(rows[0].password_hash, rows[1].password_hash);
});

test("provider accounts cannot be claimed with an email password", async t => {
  const f = fixture(t);
  f.sqlite.prepare("INSERT INTO users (id, email, google_sub) VALUES (?, ?, ?)").run("google", "Google@Example.com", "google-sub");
  const response = await f.login("GOOGLE@example.com");
  assert.equal(response.status, 401);
  assert.equal(f.sqlite.prepare("SELECT password_hash FROM users WHERE id = 'google'").get()?.password_hash, null);
});

test("concurrent signups only authenticate the winning password", async t => {
  const f = fixture(t);
  const responses = await Promise.all([f.login("race@example.com", "password one"), f.login("race@example.com", "password two")]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 401]);
  const winner = responses[0].status === 200 ? "password one" : "password two";
  assert.equal((await f.login("race@example.com", winner)).status, 200);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM users").get()?.count, 1);
  const same = await Promise.all([f.login("same@example.com"), f.login("same@example.com")]);
  assert.deepEqual(same.map(response => response.status), [200, 200]);
  const results = await Promise.all(same.map(response => response.json() as Promise<SignInResult>));
  assert.deepEqual(results.map(result => result.created).sort(), [false, true]);
});

test("untrusted origins and rate limits fail before creating accounts", async t => {
  const f = fixture(t);
  assert.equal((await f.login("person@example.com", "password123", "https://untrusted.example")).status, 403);
  assert.equal((await f.request("/auth/logout", { method: "POST", headers: { Origin: "null" } })).status, 403);
  assert.equal(f.keys.length, 0);
  const options = await f.request("/auth/email", { method: "OPTIONS", headers: { Origin: "http://127.0.0.1:5175" } });
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("access-control-allow-credentials"), "true");
  f.setLimited();
  const response = await f.login();
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "60");
  assert.deepEqual(f.keys, ["email:192.0.2.1"]);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM users").get()?.count, 0);
});

test("missing infrastructure fails closed and internal failures remain private", async t => {
  const f = fixture(t);
  f.env.EMAIL_AUTH_LIMIT = undefined as unknown as RateLimit;
  assert.equal((await f.login()).status, 503);
  f.env.DB = undefined as unknown as D1Database;
  for (const [path, method] of [["/auth/me", "GET"], ["/auth/logout", "POST"]]) {
    assert.equal((await f.request(path, { method })).status, 503);
  }
  const second = fixture(t);
  t.mock.method(console, "error", () => {});
  second.env.DB.prepare = () => { throw new Error("private database failure"); };
  const response = await second.login();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "auth_unavailable" });
});

test("local cookie relaxation requires both explicit configuration and loopback", async t => {
  const f = fixture(t);
  const request = () => new Request("https://accounts.example/auth/email", {
    method: "POST", headers: { "CF-Connecting-IP": "192.0.2.1" },
    body: JSON.stringify({ email: "secure@example.com", password: "password123" }),
  }) as Request;
  const response = await handleRequest(request(), f.env);
  assert.match(response.headers.get("set-cookie")!, /^mainbrella_session=.*HttpOnly; SameSite=None; Secure$/);
  f.env.LOCAL_DEVELOPMENT = "false";
  const loopback = await f.login();
  assert.match(loopback.headers.get("set-cookie")!, /^mainbrella_session=.*HttpOnly; SameSite=None; Secure$/);
  const missingAddress = new Request("https://accounts.example/auth/email", { method: "POST", body: "{}" });
  assert.equal((await handleRequest(missingAddress as Request, f.env)).status, 503);
});

test("malformed and oversized bodies, unsupported routes and methods are rejected", async t => {
  const f = fixture(t);
  for (const body of ["null", "[]", "true", "{", JSON.stringify({ email: "a@example.com", password: "p".repeat(2100) })]) {
    const response = await f.request("/auth/email", { method: "POST", body });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_request" });
  }
  assert.equal((await f.request("/auth/google", { method: "POST" })).status, 404);
  const wrongMethod = await f.request("/auth/logout");
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "POST, OPTIONS");
});
