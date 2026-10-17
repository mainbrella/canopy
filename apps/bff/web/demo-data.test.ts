import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPublicMessages, liveBoardConfig, type Message } from './demo-data.ts';

const rows: Message[] = [
  { id: 'welcome', user_id: 'alice', body: 'Welcome to the BFF message board.', created_at: '2026-10-15T18:30:00.000Z' },
  { id: 'hello', user_id: 'bob', body: 'Glad to be here.', created_at: '2026-10-15T19:00:00.000Z' },
];

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
