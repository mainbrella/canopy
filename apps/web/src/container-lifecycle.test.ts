import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location = { hostname: 'localhost' } as Location;
const { canResumeContainer, createLifecycleClient } = await import('./container-lifecycle.ts');
const container = { id: 'machine', createdAt: '2026-10-11T12:00:00Z', status: 'stopped', expiresAt: 0, workspaceId: 'snapshot', persistenceExpiresAt: 2000 };

test('resume needs an unexpired snapshot and the runtime capability', () => {
  assert.equal(canResumeContainer(container, { filesystemAfterStop: true }, 1000), true);
  assert.equal(canResumeContainer(container, {}, 1000), false);
  assert.equal(canResumeContainer(container, { filesystemAfterStop: true }, 2000), false);
  assert.equal(canResumeContainer({ ...container, workspaceId: undefined }, { filesystemAfterStop: true }, 1000), false);
  assert.equal(canResumeContainer({ ...container, status: 'running' }, { filesystemAfterStop: true }, 1000), false);
});

test('lifecycle requests fence the generation and preserve retry keys without sending status metadata', async () => {
  const calls: { url: string; options?: RequestInit }[] = [];
  const result = { containers: [], usage: { starts: 1 }, limits: { maxStartsPerMonth: 100 } };
  const request = createLifecycleClient({ fetcher: async (url, options) => {
    calls.push({ url: String(url), options }); return Response.json(result);
  } });
  await request('fork', container, 'same-attempt', 'Parallel agent');
  await request('fork', container, 'same-attempt', 'Parallel agent');
  assert.equal(new URL(calls[0].url).pathname, '/containers/fork');
  assert.equal(calls[0].options?.credentials, 'include');
  assert.equal(calls[0].options?.redirect, 'error');
  assert.equal((calls[1].options?.headers as Record<string, string>)['Idempotency-Key'], 'same-attempt');
  assert.deepEqual(JSON.parse(calls[0].options?.body as string), { id: container.id, createdAt: container.createdAt, name: 'Parallel agent' });
});

test('lifecycle errors preserve server error codes and reject incomplete successes', async () => {
  let signedOut = false;
  const denied = createLifecycleClient({ onUnauthenticated: () => { signedOut = true; }, fetcher: async () => Response.json({ error: 'not_authenticated' }, { status: 401 }) });
  await assert.rejects(denied('stop', container, 'retry'), /not_authenticated/);
  assert.equal(signedOut, true);
  await assert.rejects(createLifecycleClient({ fetcher: async () => Response.json({ ok: true }) })('resume', container, 'retry'), /invalid_response/);
});
