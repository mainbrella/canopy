import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location = { hostname: 'localhost' } as Location;
const { startupRecipe, createStartupClient } = await import('./container-startup.ts');
const container = { id: 'machine', createdAt: '2026-10-12T12:00:00.000Z', status: 'running' };
const recipe = { command: 'npm start', cwd: '/workspace/app', readiness: { port: 3000, path: '/health', timeoutMs: 20_000 } };

test('startup settings target the exact generation and send only the recipe', async () => {
  let call!: { url: string; options?: RequestInit };
  const request = createStartupClient({ fetcher: async (url, options) => {
    call = { url: String(url), options }; return Response.json({ id: container.id, createdAt: container.createdAt, launch: recipe });
  } });
  assert.deepEqual(await request(container, recipe), recipe);
  assert.equal(new URL(call.url).pathname, '/containers/startup');
  assert.equal(call.options?.method, 'PATCH');
  assert.equal(call.options?.credentials, 'include');
  assert.equal(call.options?.redirect, 'error');
  assert.deepEqual(JSON.parse(call.options?.body as string), { id: container.id, createdAt: container.createdAt, launch: recipe });
});

test('clearing startup is explicit and never sends an empty command', async () => {
  const bodies: unknown[] = [];
  const request = createStartupClient({ fetcher: async (_url, options) => {
    bodies.push(JSON.parse(options?.body as string)); return Response.json({ ...container, launch: null });
  } });
  assert.equal(await request(container, null), null);
  assert.deepEqual(bodies, [{ id: container.id, createdAt: container.createdAt, launch: null }]);
});

test('default recipe fields match restored application readiness', () => {
  assert.deepEqual(startupRecipe({ command: 'node app.mjs', readiness: { port: 5173 } }), {
    command: 'node app.mjs', cwd: '/workspace', readiness: { port: 5173, path: '/', timeoutMs: 30_000 },
  });
});

test('invalid recipes cannot reach the network', async () => {
  let calls = 0;
  const request = createStartupClient({ fetcher: async () => { calls++; return Response.json({}); } });
  for (const invalid of [
    { ...recipe, command: '  ' }, { ...recipe, command: 'npm start\nrm app' }, { ...recipe, cwd: 'relative/path' },
    { ...recipe, readiness: { ...recipe.readiness, port: 22 } },
    { ...recipe, readiness: { ...recipe.readiness, path: '//another-host/path' } },
    { ...recipe, readiness: { ...recipe.readiness, timeoutMs: 60_001 } },
  ]) await assert.rejects(request(container, invalid), /invalid_launch_recipe/);
  assert.equal(calls, 0);
});

test('startup acknowledgement must match generation and exact saved recipe', async () => {
  for (const response of [
    { ...container, createdAt: '2026-10-12T13:00:00.000Z', launch: recipe },
    { ...container, launch: { ...recipe, command: 'wrong command' } },
    { ...container, launch: null }, { ...container },
  ]) {
    const request = createStartupClient({ fetcher: async () => Response.json(response) });
    await assert.rejects(request(container, recipe), /invalid_response/);
  }
});

test('startup transport reports authentication and exact server error codes', async () => {
  let signedOut = false;
  const denied = createStartupClient({ onUnauthenticated: () => { signedOut = true; }, fetcher: async () => Response.json({ error: 'not_authenticated' }, { status: 401 }) });
  await assert.rejects(denied(container, recipe), /not_authenticated/);
  assert.equal(signedOut, true);
  const stale = createStartupClient({ fetcher: async () => Response.json({ error: 'container_not_running' }, { status: 409 }) });
  await assert.rejects(stale(container, recipe), /container_not_running/);
});
