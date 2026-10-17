import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoApi, DemoApiError, fetchPublicMessages, liveBoardConfig, type Board, type DemoSession, type Message } from './api.ts';

const rows: Message[] = [
  { id: 'welcome', user_id: 'alice', body: 'Welcome to the BFF message board.', created_at: '2026-10-15T18:30:00.000Z' },
  { id: 'hello', user_id: 'bob', body: 'Glad to be here.', created_at: '2026-10-15T19:00:00.000Z' },
];

const alice: DemoSession = { token: `bff_us_${'a'.repeat(64)}`, session: {
  id: 'alice-session', user_id: 'alice', created_at: '2026-10-17T00:00:00.000Z', expires_at: '2099-01-01T00:00:00.000Z',
} };
const bob: DemoSession = { token: `bff_us_${'b'.repeat(64)}`, session: { ...alice.session, id: 'bob-session', user_id: 'bob' } };
const general: Board = { id: 'general', slug: 'general', name: 'General', description: 'General discussion.', created_at: rows[0].created_at };

test('board selection loads every page with the session and validates board data', async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({ ...general, id: `board-${index}`, slug: `board-${index}` }));
  const calls: string[] = [];
  const api = createDemoApi(liveBoardConfig, async (input, init) => {
    calls.push(String(input));
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${alice.token}`);
    assert.equal(new Headers(init?.headers).get('apikey'), liveBoardConfig.publicKey);
    assert.equal(init?.credentials, 'omit');
    return Response.json({ data: calls.length === 1 ? firstPage : [general] });
  });
  assert.deepEqual(await api.listBoards(alice), [...firstPage, general]);
  assert.deepEqual(calls.map(url => new URL(url).search), [
    '?select=*&order=slug.asc&limit=100&offset=0', '?select=*&order=slug.asc&limit=100&offset=100',
  ]);
  assert.ok(calls.every(url => new URL(url).pathname.endsWith('/tables/boards')));
  const empty = createDemoApi(liveBoardConfig, async () => Response.json({ data: [] }));
  assert.deepEqual(await empty.listBoards(alice), []);
  for (const data of [null, [{ ...general, slug: 'bad/slug' }], [{ ...general, id: '' }], [{ ...general, description: null }]]) {
    const malformed = createDemoApi(liveBoardConfig, async () => Response.json({ data }));
    await assert.rejects(malformed.listBoards(alice), /unexpected format/);
  }
});

test('posting inserts only the selected board, authenticated author, and plain body, and uses the returned row', async () => {
  const posted = { ...rows[0], id: 'new-message', board_id: general.id, body: 'Saved by the backend' };
  const api = createDemoApi(liveBoardConfig, async (input, init) => {
    assert.equal(String(input), 'https://api.mainbrella.com/bff/data/90da3093-84b6-4cd7-a39a-a8afc39403b8/tables/messages');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.credentials, 'omit');
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${alice.token}`);
    assert.equal(new Headers(init?.headers).get('apikey'), liveBoardConfig.publicKey);
    assert.equal(new Headers(init?.headers).get('content-type'), 'application/json');
    assert.deepEqual(JSON.parse(String(init?.body)), { board_id: general.id, user_id: 'alice', body: 'Plain text\nwith a second line' });
    return Response.json({ data: [posted] }, { status: 201 });
  });
  assert.deepEqual(await api.create(alice, general.id, '  Plain text\nwith a second line  '), posted);
});

test('posting rejects blank and oversized input without requests and requires a confirmed row for the chosen board and author', async () => {
  const noRequest = createDemoApi(liveBoardConfig, async () => { throw new Error('Invalid input must not make a request'); });
  await assert.rejects(noRequest.create(alice, ' ', 'A body'), /Choose a board/);
  await assert.rejects(noRequest.create(alice, general.id, ' \n '), /1–2000/);
  await assert.rejects(noRequest.create(alice, general.id, 'x'.repeat(2001)), /1–2000/);
  const posted = { ...rows[0], board_id: general.id };
  for (const data of [[], [posted, posted], [{ ...posted, board_id: 'other' }], [{ ...posted, user_id: 'bob' }]]) {
    const unconfirmed = createDemoApi(liveBoardConfig, async () => Response.json({ data }, { status: 201 }));
    await assert.rejects(unconfirmed.create(alice, general.id, 'My body'), /did not confirm/);
  }
  for (const status of [401, 403]) {
    const rejected = createDemoApi(liveBoardConfig, async () => Response.json({ error: status === 401 ? 'unauthorized' : 'permission_denied' }, { status }));
    await assert.rejects(rejected.create(alice, general.id, 'My body'), error => error instanceof DemoApiError && error.status === status);
    await assert.rejects(rejected.listBoards(alice), error => error instanceof DemoApiError && error.status === status);
  }
});

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
