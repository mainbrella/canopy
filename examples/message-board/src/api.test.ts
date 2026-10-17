import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoApi, DemoApiError, fetchPublicMessages, liveBoardConfig, type DemoSession, type Message } from './api.ts';

const rows: Message[] = [
  { id: 'welcome', user_id: 'alice', body: 'Welcome to the BFF message board.', created_at: '2026-10-15T18:30:00.000Z' },
  { id: 'hello', user_id: 'bob', body: 'Glad to be here.', created_at: '2026-10-15T19:00:00.000Z' },
];

const alice: DemoSession = { token: `bff_us_${'a'.repeat(64)}`, session: {
  id: 'alice-session', user_id: 'alice', created_at: '2026-10-17T00:00:00.000Z', expires_at: '2099-01-01T00:00:00.000Z',
} };
const bob: DemoSession = { token: `bff_us_${'b'.repeat(64)}`, session: { ...alice.session, id: 'bob-session', user_id: 'bob' } };

test('public board reads the configured messages table with only its browser key', async () => {
  let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  const result = await fetchPublicMessages(liveBoardConfig, async (input, init) => {
    request = { input, init };
    return Response.json({ data: rows, meta: { count: 2 } });
  });

  assert.deepEqual(result, rows);
  assert.equal(request?.input, 'https://api.mainbrella.com/bff/data/90da3093-84b6-4cd7-a39a-a8afc39403b8/tables/messages?select=*');
  assert.deepEqual(request?.init?.headers, { apikey: 'bff_pk_1f9bb9fd543d6a5476ad7ce210577c2479d290a5cdc06282de9eb884d57005c4' });
  assert.equal(request?.init?.credentials, 'omit');
  assert.ok(request?.init?.signal instanceof AbortSignal);
  assert.equal(request?.init?.method, undefined);
});

test('public board rejects unavailable and malformed responses with useful errors', async () => {
  await assert.rejects(
    fetchPublicMessages(liveBoardConfig, async () => Response.json({ error: 'permission_denied' }, { status: 403 })),
    /public demo is unavailable/,
  );
  await assert.rejects(
    fetchPublicMessages(liveBoardConfig, async () => Response.json({ data: [{ ...rows[0], created_at: 'not-a-date' }] })),
    /unexpected format/,
  );
  await assert.rejects(
    fetchPublicMessages(liveBoardConfig, async () => Response.json({ data: null })),
    /unexpected format/,
  );
});

test('demo login obtains a server session and uses it for data requests and revocation without cookies', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const api = createDemoApi(liveBoardConfig, async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (init.method === 'POST') {
      assert.equal(init.body, JSON.stringify({ userId: 'alice' }));
      assert.equal(new Headers(init.headers).has('authorization'), false);
      return Response.json(alice, { status: 201 });
    }
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${alice.token}`);
    return Response.json(init.method === 'DELETE' ? { revoked: true } : { data: rows });
  });

  const session = await api.login('alice');
  assert.deepEqual(session, alice);
  assert.deepEqual(await api.list(session), rows);
  await api.logout(session);
  assert.deepEqual(calls.map(call => [call.url, call.init.method ?? 'GET']), [
    ['https://api.mainbrella.com/bff/demo/session', 'POST'],
    ['https://api.mainbrella.com/bff/data/90da3093-84b6-4cd7-a39a-a8afc39403b8/tables/messages?select=*', 'GET'],
    ['https://api.mainbrella.com/bff/demo/session', 'DELETE'],
  ]);
  for (const { init } of calls) {
    assert.equal(init.credentials, 'omit');
    assert.equal(new Headers(init.headers).get('apikey'), liveBoardConfig.publicKey);
  }
});

test('edits reach the backend for every author and preserve its exact denial without pretending the save succeeded', async () => {
  const forbidden = createDemoApi(liveBoardConfig, async (input, init) => {
    assert.equal(String(input), 'https://api.mainbrella.com/bff/data/90da3093-84b6-4cd7-a39a-a8afc39403b8/tables/messages?id=eq.welcome');
    assert.equal(init?.method, 'PATCH');
    assert.equal(init?.credentials, 'omit');
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${bob.token}`);
    assert.deepEqual(JSON.parse(String(init?.body)), { body: 'Trying to edit Alice’s post', user_id: 'alice' });
    return Response.json({ error: 'permission_denied' }, { status: 403 });
  });
  await assert.rejects(forbidden.update(bob, rows[0], ' Trying to edit Alice’s post '), error => {
    assert.ok(error instanceof DemoApiError);
    assert.equal(error.message, 'permission_denied');
    assert.equal(error.status, 403);
    return true;
  });
  const noChanges = createDemoApi(liveBoardConfig, async () => Response.json({ data: [], meta: { changes: 0 } }));
  assert.equal(await noChanges.update(alice, rows[0], 'Still here'), null);
});

test('successful edits use the returned row, escape the row filter, and reject unrelated response rows', async () => {
  const message = { ...rows[0], id: 'id&user_id=eq.bob' };
  const updated = { ...message, body: 'Saved by the backend' };
  const api = createDemoApi(liveBoardConfig, async (input, init) => {
    assert.ok(String(input).endsWith('?id=eq.id%26user_id%3Deq.bob'));
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${alice.token}`);
    return Response.json({ data: [updated] });
  });
  assert.deepEqual(await api.update(alice, message, 'My draft'), updated);
  const wrongRow = createDemoApi(liveBoardConfig, async () => Response.json({ data: [rows[1]] }));
  await assert.rejects(wrongRow.update(alice, rows[0], 'My draft'), /unexpected message/);
});

test('invalid or mismatched login sessions cannot enter the board, and expired credentials retain the server status', async () => {
  for (const payload of [{}, { ...alice, token: 'not-a-session-token' }, bob,
    { ...alice, session: { ...alice.session, expires_at: '2000-01-01T00:00:00.000Z' } }]) {
    const api = createDemoApi(liveBoardConfig, async () => Response.json(payload));
    await assert.rejects(api.login('alice'), /invalid session/);
  }
  const expired = createDemoApi(liveBoardConfig, async () => Response.json({ error: 'unauthorized' }, { status: 401 }));
  await assert.rejects(expired.list(alice), error => error instanceof DemoApiError && error.message === 'unauthorized' && error.status === 401);
});

test('an interrupted network request times out and does not leave the form waiting indefinitely', async () => {
  await assert.rejects(fetchPublicMessages(liveBoardConfig, (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }), 5), /request took too long/);
});
