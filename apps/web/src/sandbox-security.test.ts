import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location = { hostname: 'localhost' } as Location;
const { secretMetadata, networkSettings, createSecretsClient } = await import('./sandbox-security.ts');
const secret = { id: 'sec_d688d42a-25ef-4c13-9b28-21a0fde6e163', name: 'API token', hostname: 'api.example.com', header: 'authorization', prefix: 'Bearer ', createdAt: '2026-10-11T12:00:00Z', updatedAt: '2026-10-11T12:00:00Z' };

test('secret metadata strips credential fields and rejects malformed identities', () => {
  assert.deepEqual(secretMetadata({ ...secret, value: 'private-value', ciphertext: 'private-ciphertext' }), secret);
  assert.throws(() => secretMetadata({ ...secret, id: '../another-secret' }));
  assert.throws(() => secretMetadata({ ...secret, updatedAt: 'invalid' }));
});

test('outbound mode preserves default creation and never falls back from denied capabilities', () => {
  assert.deepEqual(networkSettings('unrestricted', '', '', [secret.id], {}), {});
  assert.deepEqual(networkSettings('blocked', '', '', [secret.id], { internetControl: true }), { internet: false });
  assert.throws(() => networkSettings('blocked', '', '', [], {}), /network_unavailable/);
  assert.throws(() => networkSettings('restricted', 'api.example.com', '', [], {}), /network_unavailable/);
  assert.throws(() => networkSettings('restricted', '', '', [], { egressPolicies: true }), /invalid_network_rules/);
});

test('restricted launch includes normalized allow and deny rules with selected secret IDs', () => {
  assert.deepEqual(networkSettings('restricted', 'api.example.com\n*.example.org,api.example.com', 'private.example.org', [secret.id], { egressPolicies: true, secrets: true }), {
    networkPolicy: { allow: ['api.example.com', '*.example.org'], deny: ['private.example.org'] }, secretBindings: [secret.id],
  });
  assert.throws(() => networkSettings('restricted', 'api.example.com', '', [secret.id], { egressPolicies: true }), /invalid_secret_bindings/);
  assert.throws(() => networkSettings('restricted', Array.from({ length: 65 }, (_, i) => `api${i}.example.com`).join('\n'), '', [], { egressPolicies: true }), /invalid_network_rules/);
});

test('secret transport sends write-only values with cookies, forbids redirects, and strips read responses', async () => {
  const calls: { url: string; options?: RequestInit }[] = [];
  const request = createSecretsClient({ fetcher: async (url, options) => {
    calls.push({ url: String(url), options }); return Response.json({ secrets: [{ ...secret, value: 'must-not-retain' }] });
  } });
  assert.deepEqual(await request(), [secret]);
  await request('PUT', secret.id, { value: 'new-value' });
  assert.equal(new URL(calls[1].url).pathname, `/secrets/${secret.id}`);
  assert.equal(calls[1].options?.credentials, 'include');
  assert.equal(calls[1].options?.redirect, 'error');
  assert.deepEqual(JSON.parse(calls[1].options?.body as string), { value: 'new-value' });
});

test('secret authentication errors notify the dashboard', async () => {
  let notified = false;
  const request = createSecretsClient({ onUnauthenticated: () => { notified = true; }, fetcher: async () => Response.json({ error: 'not_authenticated' }, { status: 401 }) });
  await assert.rejects(request(), /not_authenticated/); assert.equal(notified, true);
});
