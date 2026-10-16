import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import type { D1Database, RateLimit } from "@cloudflare/workers-types/index.ts";
import type { SignInResult } from "@canopy/contracts/auth";
import { findOrCreateGoogleUser } from "../src/auth-google.ts";
import { hashToken } from "../src/auth-core.ts";
import { fixture } from "./fixture.ts";

const clientID = "canopy-unit-test.apps.googleusercontent.com";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "local-signing-key", alg: "RS256", use: "sig" };
function token(claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const signed = `${encode({ alg: "RS256", kid: jwk.kid, ...header })}.${encode({
    iss: "https://accounts.google.com", aud: clientID, sub: "google-user", email: " Person@Example.COM ",
    name: "  Test   Person  ", email_verified: true, iat: now, exp: now + 3600, ...claims,
  })}`;
  return `${signed}.${sign("RSA-SHA256", Buffer.from(signed), privateKey).toString("base64url")}`;
}
function googleFixture(t: test.TestContext) {
  const f = fixture(t);
  f.env.GOOGLE_CLIENT_ID = clientID;
  const keyFetch = t.mock.method(globalThis, "fetch", async (url: string | URL | Request, options?: RequestInit) => {
    assert.equal(url, "https://www.googleapis.com/oauth2/v3/certs");
    assert.ok(options?.signal);
    return Response.json({ keys: [jwk] });
  });
  const google = (credential: unknown = token(), origin = "http://127.0.0.1:5175") => f.request("/auth/google", {
    method: "POST", headers: { "content-type": "application/json", Origin: origin, "CF-Connecting-IP": "192.0.2.2" },
    body: JSON.stringify({ credential }),
  });
  return { ...f, google, keyFetch };
}
async function rejected(response: Response, status: number, error: string) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { error });
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
}

test("Google creates a provider account and uses the same hashed sessions, expiry and logout", async t => {
  const f = googleFixture(t);
  const first = await f.google();
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("access-control-allow-origin"), "http://127.0.0.1:5175");
  const result = await first.json() as SignInResult;
  assert.equal(result.created, true);
  assert.equal(result.user.email, "person@example.com");
  assert.equal(result.user.name, "Test Person");
  assert.deepEqual(Object.keys(result.user).sort(), ["created_at", "dob", "email", "id", "name"]);
  const stored = f.sqlite.prepare("SELECT * FROM users").get()!;
  assert.equal(stored.password_hash, null);
  assert.equal(stored.google_sub, "google-user");
  assert.equal(result.user.created_at, stored.created_at);
  const cookie = first.headers.get("set-cookie")!;
  assert.match(cookie, /^canopy_session=[a-f0-9]{64}; Max-Age=2592000; Path=\/; HttpOnly; SameSite=Lax$/);
  assert.equal(f.sqlite.prepare("SELECT token_hash FROM sessions").get()?.token_hash, await hashToken(cookie.split(";")[0].split("=")[1]));
  const headers = { Cookie: cookie.split(";")[0] };
  assert.deepEqual(await (await f.request("/auth/me", { headers })).json(), { user: result.user });
  // The stable Google subject identifies returning users even if their email changes.
  const repeat = await f.google(token({ iss: "accounts.google.com", email: "changed@example.com" }));
  assert.deepEqual(await repeat.json(), { user: result.user, created: false });
  await rejected(await f.login(), 401, "invalid_credentials");
  const logout = await f.request("/auth/logout", { method: "POST", headers });
  assert.deepEqual(await logout.json(), { ok: true });
  assert.match(logout.headers.get("set-cookie")!, /^canopy_session=; Max-Age=0;/);
  assert.deepEqual(await (await f.request("/auth/me", { headers })).json(), { user: null });
  const other = { Cookie: repeat.headers.get("set-cookie")!.split(";")[0] };
  assert.deepEqual(await (await f.request("/auth/me", { headers: other })).json(), { user: result.user });
  f.sqlite.exec("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'");
  assert.deepEqual(await (await f.request("/auth/me", { headers: other })).json(), { user: null });
});

test("Google checks issuer, audience, subject, verified email and strict token times", async t => {
  const f = googleFixture(t);
  const now = Math.floor(Date.now() / 1000);
  for (const claims of [
    { iss: "https://attacker.example" }, { iss: undefined }, { aud: "another-client" }, { aud: [clientID] },
    { sub: "" }, { sub: null }, { sub: "s".repeat(256) }, { email_verified: false }, { email_verified: "true" },
    { email_verified: undefined }, { email: undefined }, { email: "not-an-email" }, { email: "p @example.com" },
    { email: `${"a".repeat(250)}@example.com` }, { exp: now }, { exp: now - 1 }, { exp: String(now + 3600) },
    { exp: undefined }, { exp: null }, { iat: now + 61 }, { iat: undefined }, { iat: null }, { iat: "0" },
    { iat: now + 50, exp: now + 40 }, { nbf: now + 60 }, { nbf: "0" },
  ]) {
    await rejected(await f.google(token(claims)), 401, "invalid_google_credential");
  }
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM users").get()?.n, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get()?.n, 0);
});

test("Google rejects malformed JWTs, unsigned or tampered data, algorithms and unknown keys", async t => {
  const f = googleFixture(t);
  const valid = token();
  const parts = valid.split(".");
  const alteredPayload = Buffer.from(JSON.stringify({ email: "attacker@example.com" })).toString("base64url");
  for (const credential of [
    null, false, {}, "", "not-a-token", "a.b.c.d", "a.b.c", "x".repeat(10_001),
    `${parts[0]}.${alteredPayload}.${parts[2]}`, `${parts[0]}.${parts[1]}.AA`, `${parts[0]}.${parts[1]}.`,
    token({}, { alg: "none" }), token({}, { alg: "HS256" }), token({}, { kid: undefined }),
    token({}, { kid: "unknown" }), token({}, { kid: "" }), token({}, { crit: ["unhandled"] }),
  ]) {
    await rejected(await f.google(credential), 401, "invalid_google_credential");
  }
  // A URL supplied by a token is ignored; only the fixed Google key URL is used.
  assert.equal((await f.google(token({}, { jku: "https://attacker.example/keys" }))).status, 200);
});

test("Google provider failures return a private retryable error without issuing sessions", async t => {
  const f = googleFixture(t);
  for (const result of [null, {}, { keys: {} }, { keys: [] }, { keys: [null] }, { keys: [{ kid: jwk.kid, kty: "RSA" }] },
    { keys: [{ ...jwk, alg: "HS256" }] }, { keys: [{ ...jwk, use: "enc" }] }]) {
    f.keyFetch.mock.mockImplementation(async () => Response.json(result));
    await rejected(await f.google(), 503, "google_unavailable");
  }
  for (const makeResponse of [
    async () => new Response("private upstream error", { status: 503 }),
    async () => new Response("not JSON"),
    async () => { throw new Error("private network failure"); },
    async () => { throw new DOMException("timed out", "TimeoutError"); },
  ]) {
    f.keyFetch.mock.mockImplementation(makeResponse);
    await rejected(await f.google(), 503, "google_unavailable");
  }
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM users").get()?.n, 0);
  f.keyFetch.mock.mockImplementation(async () => Response.json({ keys: [jwk] }));
  assert.equal((await f.google()).status, 200);
});

test("Google cannot link a password account or a different Google subject, including mixed-case email", async t => {
  const f = googleFixture(t);
  const email = await (await f.login()).json() as SignInResult;
  f.sqlite.exec("UPDATE users SET email = 'Person@Example.COM'");
  const before = f.sqlite.prepare("SELECT * FROM users").get();
  await rejected(await f.google(), 409, "identity_conflict");
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM users").get(), before);
  assert.equal((await (await f.login()).json() as SignInResult).user.id, email.user.id);
  assert.equal((await f.google(token({ email: "google@example.com" }))).status, 200);
  await rejected(await f.google(token({ email: "google@example.com", sub: "someone-else" })), 409, "identity_conflict");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM users").get()?.n, 2);
});

test("Google signup races return the saved identity and never claim the losing account", async t => {
  const f = googleFixture(t);
  const same = await Promise.all([f.google(), f.google()]);
  assert.deepEqual(same.map(response => response.status), [200, 200]);
  const results = await Promise.all(same.map(response => response.json() as Promise<SignInResult>));
  assert.deepEqual(results.map(result => result.created).sort(), [false, true]);
  assert.deepEqual(results[0].user, results[1].user);
  const different = await Promise.all(["one", "two"].map(sub => f.google(token({ sub, email: "race@example.com" }))));
  assert.deepEqual(different.map(response => response.status).sort(), [200, 409]);
  const providers = await Promise.all([f.login("providers@example.com"), f.google(token({ sub: "providers", email: "providers@example.com" }))]);
  assert.equal(providers.filter(response => response.status === 200).length, 1);
  assert.ok(providers[0].status === 401 || providers[1].status === 409);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM users WHERE lower(email) = 'providers@example.com'").get()?.n, 1);
});

test("legacy credential-free linking returns updated data and conditionally guards competing credentials", async t => {
  const f = googleFixture(t);
  f.sqlite.exec("INSERT INTO users (id, email) VALUES ('legacy', 'Person@Example.com')");
  const identities = ["one", "two"].map(googleSub => ({ googleSub, email: "person@example.com", name: " New   Name " }));
  const results = await Promise.allSettled(identities.map(identity => findOrCreateGoogleUser(f.env, identity)));
  const winner = results.find(result => result.status === "fulfilled");
  assert.ok(winner?.status === "fulfilled");
  assert.equal(winner.value.created, false);
  assert.equal(winner.value.user.name, "New Name");
  assert.equal(results.filter(result => result.status === "rejected" && result.reason.message === "identity_conflict").length, 1);
  f.sqlite.exec("INSERT INTO users (id, email) VALUES ('password-race', 'race@example.com')");
  const prepare = f.env.DB.prepare.bind(f.env.DB);
  t.mock.method(f.env.DB, "prepare", (sql: string) => {
    if (sql.startsWith("UPDATE users SET google_sub")) {
      f.sqlite.exec("UPDATE users SET password_hash = 'concurrent-password' WHERE id = 'password-race'");
    }
    return prepare(sql);
  });
  await assert.rejects(findOrCreateGoogleUser(f.env, { googleSub: "new-sub", email: "race@example.com", name: "" }), /identity_conflict/);
  assert.equal(f.sqlite.prepare("SELECT google_sub FROM users WHERE id = 'password-race'").get()?.google_sub, null);
});

test("Google configuration, origin, rate, body and infrastructure checks fail closed", async t => {
  const f = googleFixture(t);
  f.env.GOOGLE_CLIENT_ID = " ";
  await rejected(await f.google(), 503, "google_unavailable");
  assert.equal((await f.login()).status, 200);
  f.env.GOOGLE_CLIENT_ID = clientID;
  await rejected(await f.google(token(), "https://untrusted.example"), 403, "origin_not_allowed");
  assert.equal((await f.request("/auth/google", { method: "OPTIONS", headers: { Origin: "http://127.0.0.1:5175" } })).status, 204);
  assert.equal((await f.request("/auth/google")).status, 405);
  for (const body of ["null", "[]", "{", JSON.stringify({ credential: "x".repeat(20_000) })]) {
    await rejected(await f.request("/auth/google", { method: "POST", body }), 400, "invalid_request");
  }
  f.setGoogleLimited();
  const limited = await f.google();
  assert.equal(limited.headers.get("retry-after"), "60");
  await rejected(limited, 429, "rate_limited");
  assert.equal(f.keys.at(-1), "google:192.0.2.2");
  assert.equal((await f.login()).status, 200);
  f.env.GOOGLE_AUTH_LIMIT = undefined as unknown as RateLimit;
  await rejected(await f.google(), 503, "auth_unavailable");
  f.env.DB = undefined as unknown as D1Database;
  await rejected(await f.google(), 503, "auth_unavailable");
  assert.equal(f.keyFetch.mock.callCount(), 0);
});

test("Google database failures are not leaked to the browser", async t => {
  const f = googleFixture(t);
  t.mock.method(console, "error", () => {});
  f.env.DB.prepare = () => { throw new Error("private database failure"); };
  await rejected(await f.google(), 503, "auth_unavailable");
});
