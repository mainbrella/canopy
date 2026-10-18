import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { BoardLink } from './BoardLink.tsx';
import { renderBoardRequest } from './server.tsx';
import { liveBoardConfig, type Board, type Message } from './api.ts';

const board: Board = { id: 'board-123', slug: 'general', name: 'General', description: 'General <discussion>', created_at: '2026-10-18T12:00:00Z' };
const message: Message = { id: 'post-123', board_id: board.id, title: 'Hello <script>alert(1)</script>', body: 'A message & a reply', user_id: 'alice', created_at: board.created_at };
const template = '<!doctype html><html><head><title>Message board</title><link rel="stylesheet" href="/assets/app.css"></head><body><div id="message-board-root"></div><noscript>Enable JavaScript</noscript></body></html>';
const request = (path = '/boards/general', method = 'GET') => new Request(`https://example.com${path}`, { method });

test('board labels are real root-relative links', () => {
  assert.equal(renderToStaticMarkup(<BoardLink board={board} className="message-board" />),
    '<a class="message-board" href="/boards/general">board/general</a>');
  assert.equal(renderToStaticMarkup(<BoardLink board={board} basePath="/bff/demo/" />),
    '<a href="/bff/demo/boards/general">board/general</a>');
});

test('mounted board pages match and link within the demo path', async () => {
  const options = { template, homeHref: '/bff/demo/', fetcher: (async (input: RequestInfo | URL) =>
    Response.json({ data: String(input).includes('/tables/boards?') ? [board] : [message] })) as typeof fetch };
  assert.equal(await renderBoardRequest(request('/boards/general'), options), null);
  const response = await renderBoardRequest(request('/bff/demo/boards/general'), options);
  assert.equal(response?.status, 200);
  const html = await response!.text();
  assert.match(html, /href="\/bff\/demo\/boards\/general"/);
  assert.doesNotMatch(html, /href="\/boards\//);
});

test('direct board requests contain escaped board messages in the initial HTML and filter the API before limiting', async () => {
  const calls: URL[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push(url);
    assert.equal(new Headers(init?.headers).get('apikey'), liveBoardConfig.publicKey);
    assert.equal(new Headers(init?.headers).get('authorization'), null);
    assert.equal(init?.credentials, 'omit');
    return Response.json({ data: url.pathname.endsWith('/boards') ? [board] : [message] });
  };
  const response = await renderBoardRequest(request(), { template, fetcher });
  assert.equal(response?.status, 200);
  assert.match(response!.headers.get('content-type')!, /text\/html/);
  const html = await response!.text();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].searchParams.get('slug'), 'eq.general');
  assert.equal(calls[1].searchParams.get('board_id'), 'eq.board-123');
  assert.equal(calls[1].searchParams.get('order'), 'created_at.desc');
  assert.equal(calls[1].searchParams.get('limit'), '20');
  assert.match(html, /<h1 id="board-title">board\/general<\/h1>/);
  assert.match(html, /data-server-rendered="true"/);
  assert.match(html, /Hello &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /A message &amp; a reply/);
  assert.match(html, /href="\/assets\/app.css"/);
  assert.doesNotMatch(html, /Enable JavaScript|<script>alert/);
});

test('empty boards, missing boards, invalid paths and API failures have distinct server responses', async () => {
  const empty: typeof fetch = async input => Response.json({ data: String(input).includes('/tables/boards?') ? [board] : [] });
  const response = await renderBoardRequest(request('/boards/general/'), { template, fetcher: empty });
  assert.equal(response?.status, 200);
  assert.match(await response!.text(), /No messages yet\./);
  let calls = 0;
  const missing: typeof fetch = async () => { calls++; return Response.json({ data: [] }); };
  const notFound = await renderBoardRequest(request(), { template, fetcher: missing });
  assert.equal(notFound?.status, 404);
  assert.equal(calls, 1);
  assert.match(await notFound!.text(), /Board not found/);
  const invalid = await renderBoardRequest(request('/boards/invalid/nested'), { template, fetcher: missing });
  assert.equal(invalid?.status, 404);
  assert.equal(calls, 1);
  const unavailable = await renderBoardRequest(request(), { template, fetcher: async () => { throw new Error('private backend details'); } });
  assert.equal(unavailable?.status, 502);
  assert.doesNotMatch(await unavailable!.text(), /private backend details/);
});

test('server refuses unrelated board rows and keeps other routes and HTTP methods separate', async () => {
  const mismatch = await renderBoardRequest(request(), { template, fetcher: async input => Response.json({
    data: String(input).includes('/tables/boards?') ? [board] : [{ ...message, board_id: 'another-board' }],
  }) });
  assert.equal(mismatch?.status, 502);
  assert.doesNotMatch(await mismatch!.text(), /A message/);
  assert.equal(await renderBoardRequest(request('/'), { template }), null);
  assert.equal((await renderBoardRequest(request('/boards/general', 'POST'), { template }))?.status, 405);
  const head = await renderBoardRequest(request('/boards/general', 'HEAD'), { template, fetcher: async () => Response.json({ data: [] }) });
  assert.equal(head?.status, 404);
  assert.equal(await head!.text(), '');
});
