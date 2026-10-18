import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fetchPublicBoard, fetchPublicBoards, fetchPublicMessages, liveBoardConfig, type Board, type Message, type PublicBoardConfig } from './api.ts';
import { BoardLink } from './BoardLink.tsx';
import { BoardNavigation, RecentMessages } from './BoardSidebars.tsx';

type Options = {
  template: string;
  config?: PublicBoardConfig;
  fetcher?: typeof fetch;
  homeHref?: string;
};

// Return null for unrelated paths so each host can keep serving its own assets.
export async function renderBoardRequest(request: Request, { template, config = liveBoardConfig, fetcher = fetch, homeHref = '/' }: Options): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  const boardPrefix = `${homeHref}boards/`;
  if (!pathname.startsWith(boardPrefix)) return null;
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  const slug = /^([a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?)\/?$/.exec(pathname.slice(boardPrefix.length))?.[1];
  let status = 200;
  let data: Awaited<ReturnType<typeof fetchPublicBoard>> = null;
  let boards: Board[] = [];
  let recentMessages: Message[] = [];
  let recentLoaded = false;
  let error = '';
  try {
    if (slug) data = await fetchPublicBoard(slug, config, fetcher);
    if (!data) { status = 404; error = 'Board not found.'; }
  } catch {
    status = 502;
    error = 'Could not load this board. Please try again.';
  }
  if (data) {
    const [boardResult, messageResult] = await Promise.allSettled([
      fetchPublicBoards(config, fetcher), fetchPublicMessages(config, fetcher),
    ]);
    if (boardResult.status === 'fulfilled') boards = boardResult.value;
    if (messageResult.status === 'fulfilled') { recentMessages = messageResult.value; recentLoaded = true; }
  }
  if (data && !boards.some(board => board.id === data!.board.id)) boards = [...boards, data.board];
  const boardCounts = new Map<string, number>();
  recentMessages.forEach(message => { if (message.board_id) boardCounts.set(message.board_id, (boardCounts.get(message.board_id) ?? 0) + 1); });
  const title = data ? `board/${data.board.slug}` : status === 404 ? 'Board not found' : 'Board unavailable';
  const markup = renderToStaticMarkup(<>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="topbar"><a className="wordmark" href={homeHref}>bff<span aria-hidden="true">.</span></a><a className="back-link" href={homeHref}>All messages</a></header>
    <main id="main" className="workspace workspace--authenticated">
      <div className="board-layout">
        <BoardNavigation boards={boards} boardCounts={boardCounts} basePath={homeHref} activeSlug={data?.board.slug} footerHref={homeHref} />
        <div className="board-feed"><section className="board" aria-labelledby="board-title">
        <div className="feed-toolbar feed-toolbar--board-detail"><div><h1 id="board-title">{title}</h1></div></div>
        {error ? <p role="alert">{error}</p> : data && <>
          {data.board.description && <p className="board-description board-detail-description">{data.board.description}</p>}
          <p className="status-line">Latest {data.messages.length} {data.messages.length === 1 ? 'post' : 'posts'}</p>
          <div className="message-list">{data.messages.map(message => <article key={message.id} id={`message-${encodeURIComponent(message.id)}`} className="message-row">
            <div className="post-header"><BoardLink board={data.board} basePath={homeHref} className="message-board" /><span className="meta-dot" aria-hidden="true">·</span><time className="message-time" dateTime={message.created_at}>{new Date(message.created_at).toISOString().slice(0, 10)}</time></div>
            <h2 className="message-title">{message.title}</h2><p className="message-body">{message.body}</p>
            <footer className="post-footer"><span className="message-author">{message.user_id}</span></footer>
          </article>)}</div>
          {data.messages.length === 0 && <p className="board-state">No messages yet.</p>}
        </>}
        </section></div>
        <RecentMessages messages={recentMessages} boards={boards} basePath={homeHref} currentBoardSlug={data?.board.slug} loaded={recentLoaded} />
      </div>
    </main>
  </>);
  const html = template.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title} · BFF</title>`)
    .replace(/<noscript>[\s\S]*?<\/noscript>/gi, '')
    .replace('<div id="message-board-root"></div>', () => `<div id="message-board-root" data-server-rendered="true" data-base-path="${homeHref}"${data ? ` data-board-slug="${data.board.slug}"` : ''}>${markup}</div>`);
  return new Response(request.method === 'HEAD' ? null : html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
