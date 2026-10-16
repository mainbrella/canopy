import test from "node:test";
import assert from "node:assert/strict";
import { createAuthClient } from "../src/auth.ts";

const user = { id: "user-1", email: "person@example.com", name: "Person", dob: null, created_at: "2026-10-16T00:00:00.000Z" };
function client(result: unknown, status = 200) {
  return createAuthClient({ fetcher: async () => Response.json(result, { status }) });
}

test("client sends the existing credentialed paths and normalizes email", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const auth = createAuthClient({ baseUrl: "https://accounts.example/", fetcher: async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(String(url).endsWith("logout") ? { ok: true } : { user, created: true });
  } });
  assert.deepEqual(await auth.readSession(), { user });
  assert.deepEqual(await auth.signInWithEmail(" Person@Example.com ", " secret password "), { user, created: true });
  await auth.signOut();
  assert.deepEqual(calls.map(call => call.url), ["https://accounts.example/auth/me", "https://accounts.example/auth/email", "https://accounts.example/auth/logout"]);
  assert.ok(calls.every(call => call.init?.credentials === "include"));
  assert.equal(calls[1].init?.method, "POST");
  assert.equal(calls[1].init?.body, JSON.stringify({ email: "person@example.com", password: " secret password " }));
});

test("anonymous and expired sessions differ from malformed or unavailable responses", async () => {
  assert.equal(await client({ user: null }).readSession(), null);
  assert.equal(await client({ error: "unauthorized" }, 401).readSession(), null);
  for (const result of [true, [], null, {}, { user: {} }, { user: { ...user, id: 1 } }, { user: { ...user, email: false } }, { user: { ...user, dob: 3 } }]) {
    await assert.rejects(client(result).readSession(), /Could not check/);
  }
  await assert.rejects(client({ user: null }, 503).readSession(), /Could not check/);
  await assert.rejects(client({ user }).signInWithEmail("a@example.com", "password123"), /Could not finish/);
});

test("sign-in and logout errors are readable and do not report false success", async () => {
  for (const [code, message] of [["weak_password", /at least 8/], ["invalid_credentials", /incorrect/], ["rate_limited", /Too many attempts/]] as const) {
    await assert.rejects(client({ error: code }, 400).signInWithEmail("a@example.com", "short"), message);
  }
  for (const result of [null, { ok: false }, { ok: "true" }]) {
    await assert.rejects(client(result).signOut(), /Could not sign you out/);
  }
  await assert.rejects(client({ ok: true }, 503).signOut(), /Could not sign you out/);
  const offline = createAuthClient({ fetcher: async () => { throw new Error("private network details"); } });
  await assert.rejects(offline.readSession(), /Could not reach sign-in/);
  const html = createAuthClient({ fetcher: async () => new Response("<html>Proxy error</html>") });
  await assert.rejects(html.readSession(), /Could not check/);
});
