import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { createDemoApi, type Board as BoardRecord, type DemoSession, type Message } from './api.ts';
import type { DemoUser } from './config.ts';
import { CreateMessageDialog } from './CreateMessageDialog.tsx';
import { CreateBoardDialog } from './CreateBoardDialog.tsx';

type BoardApi = ReturnType<typeof createDemoApi>;
const defaultApi = createDemoApi();
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The request failed. Try again.';

export function App({ api = defaultApi }: { api?: BoardApi }) {
  const [session, setSession] = useState<DemoSession | null>(null);
  const [user, setUser] = useState<DemoUser>('alice');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const busy = useRef(false);
  const loginSelect = useRef<HTMLSelectElement>(null);
  const restoreLoginFocus = useRef(false);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    if (!session && !pending && restoreLoginFocus.current) {
      loginSelect.current?.focus();
      restoreLoginFocus.current = false;
    }
  }, [session, pending]);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (busy.current || session) return;
    const request = ++generation.current;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      const created = await api.login(user);
      if (request !== generation.current) {
        void api.logout(created).catch(() => {});
        return;
      }
      setSession(created);
    } catch (cause) {
      if (request === generation.current) setError(errorText(cause));
    } finally {
      if (request === generation.current) {
        busy.current = false;
        setPending(false);
      }
    }
  }

  async function logout() {
    if (!session || busy.current) return;
    const ended = session;
    const request = ++generation.current;
    busy.current = true;
    restoreLoginFocus.current = true;
    setCreateOpen(false);
    setSession(null);
    setPending(true);
    setError('');
    try {
      await api.logout(ended);
    } catch (cause) {
      if (request === generation.current) setError(`You are logged out in this browser, but the server could not revoke the session: ${errorText(cause)}`);
    } finally {
      if (request === generation.current) {
        busy.current = false;
        setPending(false);
      }
    }
  }

  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className={`topbar${session ? ' topbar--authenticated' : ''}`}>
      <a className="wordmark" href="https://mainbrella.com/bff/" aria-label="BFF home">bff<span aria-hidden="true">.</span></a>
      {session ? <div id="session-controls" className="session-controls">
        <button id="create-message" className="primary-button create-message-button" type="button" onClick={() => setCreateOpen(true)}>
          <span aria-hidden="true">+</span> Create
        </button>
        <span id="current-user" className="current-user">{session.session.user_id}</span>
        <button id="logout" className="secondary-button" type="button" onClick={() => void logout()}>Log out</button>
      </div> : <a className="back-link" href="https://mainbrella.com/bff/">Back to BFF <span aria-hidden="true">↗</span></a>}
    </header>
    <main id="main" className={`workspace${session ? ' workspace--authenticated' : ''}`}>
      {session ? <Board key={session.session.id} api={api} session={session} createOpen={createOpen} onCloseCreate={() => setCreateOpen(false)} /> : <>
        <div className="page-heading">
          <div><h1>Message board</h1><p>Messages from a live BFF project.</p></div>
        </div>
        <section id="login-panel" className="login-panel" aria-label="Demo login">
          <form id="login-form" className="login-form" onSubmit={event => void login(event)}>
            <label className="user-control" htmlFor="login-user">
              <span className="toolbar-label">Demo user</span>
              <select ref={loginSelect} id="login-user" name="user" autoComplete="off" value={user} disabled={pending}
                onChange={event => setUser(event.target.value as DemoUser)}>
                <option value="alice">Alice</option><option value="bob">Bob</option>
              </select>
            </label>
            <button id="login-button" className="primary-button" type="submit" disabled={pending}>Log in</button>
          </form>
          {error && <p id="login-feedback" className="login-feedback" role="alert">{error}</p>}
        </section></>}
    </main>
  </>;
}

function Board({ api, session, createOpen, onCloseCreate }: { api: BoardApi; session: DemoSession; createOpen: boolean; onCloseCreate: () => void }) {
  const [createBoardOpen, setCreateBoardOpen] = useState(false);
  const [data, setData] = useState<{ messages: Message[]; loaded: boolean; updated?: Date; error: string }>({ messages: [], loaded: false, error: '' });
  const [boards, setBoards] = useState<BoardRecord[]>([]);
  const [boardLookup, setBoardLookup] = useState<'loading' | 'available' | 'unavailable'>('loading');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'all' | 'mine'>('all');
  const [sort, setSort] = useState('newest');
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState('');
  const [editError, setEditError] = useState('');
  const [feedback, setFeedback] = useState('');
  const active = useRef(false);
  const serial = useRef(0);
  const boardSerial = useRef(0);
  const busy = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const restoreFocus = useRef('');

  function onCreated(message: Message, board?: BoardRecord) {
    boardSerial.current++;
    // Invalidate a feed refresh so it cannot overwrite this row. Keep an
    // in-flight edit's request serial and busy state intact so its completion
    // can still update the row and release the edit controls.
    if (loading && !saving) {
      serial.current++;
      busy.current = false;
      setLoading(false);
    }
    setData(previous => ({
      ...previous,
      messages: [message, ...previous.messages.filter(row => row.id !== message.id)],
      loaded: true,
      updated: new Date(),
      error: '',
    }));
    if (board) setBoards(previous => [...previous.filter(row => row.id !== board.id), board]);
    void loadBoards();
    setView('all');
    setSearch('');
    setSort('newest');
    setFeedback('Message posted.');
  }

  const loadBoards = useCallback(async () => {
    const request = ++boardSerial.current;
    setBoardLookup('loading');
    try {
      const result = await api.listBoards(session);
      if (active.current && request === boardSerial.current) {
        setBoards(result);
        setBoardLookup('available');
      }
    } catch {
      // Board metadata is supplementary: keep the message feed available.
      if (active.current && request === boardSerial.current) setBoardLookup('unavailable');
    }
  }, [api, session]);

  const load = useCallback(async () => {
    if (busy.current) return;
    void loadBoards();
    const request = ++serial.current;
    busy.current = true;
    setLoading(true);
    setFeedback('');
    setData(previous => ({ ...previous, error: '' }));
    try {
      const messages = await api.list(session);
      if (active.current && request === serial.current) setData({ messages, loaded: true, updated: new Date(), error: '' });
    } catch (cause) {
      if (active.current && request === serial.current) setData(previous => ({ ...previous,
        error: navigator.onLine === false ? 'You appear to be offline. Reconnect and try again.' : errorText(cause),
      }));
    } finally {
      if (active.current && request === serial.current) {
        busy.current = false;
        setLoading(false);
      }
    }
  }, [api, session, loadBoards]);

  useEffect(() => {
    active.current = true;
    void load();
    return () => { active.current = false; serial.current++; boardSerial.current++; busy.current = false; };
  }, [load]);

  useEffect(() => {
    if (editingId && !saving) textarea.current?.focus();
    else if (!editingId && restoreFocus.current) {
      editButtons.current.get(restoreFocus.current)?.focus();
      restoreFocus.current = '';
    }
  }, [editingId, saving, editError]);

  function finishEditing() {
    restoreFocus.current = editingId;
    setEditingId('');
    setDraft('');
    setEditError('');
  }

  async function save(event: FormEvent, message: Message) {
    event.preventDefault();
    if (busy.current || editingId !== message.id) return;
    const body = draft.trim();
    if (!body || body.length > 2000) {
      setEditError('Enter a message of 1–2000 characters.');
      textarea.current?.focus();
      return;
    }
    const request = ++serial.current;
    busy.current = true;
    setSaving(true);
    setEditError('');
    setFeedback('');
    try {
      const updated = await api.update(session, message, body);
      if (!active.current || request !== serial.current) return;
      if (!updated) { setEditError('No message was updated. Your edit was not saved.'); return; }
      setData(previous => ({ ...previous, messages: previous.messages.map(row => row.id === updated.id ? updated : row), updated: new Date() }));
      finishEditing();
      setFeedback('Message updated.');
    } catch (cause) {
      if (active.current && request === serial.current) setEditError(errorText(cause));
    } finally {
      if (active.current && request === serial.current) { busy.current = false; setSaving(false); }
    }
  }

  const term = search.trim().toLocaleLowerCase();
  const messagesInView = data.messages.filter(message => view === 'all' || message.user_id === session.session.user_id);
  const visible = messagesInView.filter(message => !term || message.user_id.toLocaleLowerCase().includes(term)
    || message.title.toLocaleLowerCase().includes(term) || message.body.toLocaleLowerCase().includes(term))
    .sort((a, b) => sort === 'oldest' ? Date.parse(a.created_at) - Date.parse(b.created_at) : Date.parse(b.created_at) - Date.parse(a.created_at));
  const recent = [...visible].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 5);
  const boardById = new Map(boards.map(board => [board.id, board]));
  const boardLabel = (message: Message) => {
    if (!message.board_id) return 'No board';
    const board = boardById.get(message.board_id);
    return board ? `board/${board.slug}` : boardLookup === 'loading' ? 'Loading board…' : 'Board unavailable';
  };
  const count = `${messagesInView.length} ${messagesInView.length === 1 ? 'message' : 'messages'}`;
  const status = loading ? (data.loaded ? 'Refreshing messages…' : 'Loading messages…') : !data.loaded ? 'Message board unavailable' :
    `${term ? `${visible.length} of ` : ''}${count}${data.error ? ' · Showing last loaded data' : data.updated ? ` · Updated at ${data.updated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}`;

  return <div className="board-layout">
    <CreateMessageDialog api={api} session={session} open={createOpen} onClose={onCloseCreate} onCreated={onCreated} />
    {createBoardOpen && <CreateBoardDialog api={api} session={session} onClose={() => setCreateBoardOpen(false)}
      onCreated={board => { boardSerial.current++; setBoards(previous => [...previous.filter(row => row.id !== board.id), board]); setCreateBoardOpen(false); setFeedback(`Board “${board.name}” created.`); void loadBoards(); }} />}
    <aside className="board-navigation">
      <nav className="board-nav" aria-label="Message views">
        <button className="board-nav-item" type="button" aria-pressed={view === 'all'} onClick={() => setView('all')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" /></svg>
          All messages
        </button>
        <button className="board-nav-item" type="button" aria-pressed={view === 'mine'} onClick={() => setView('mine')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></svg>
          My messages
        </button>
      </nav>
      <button id="create-board-button" className="board-nav-item create-board-button" type="button"
        onClick={() => setCreateBoardOpen(true)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        Create new Board
      </button>
      <a className="back-link board-back-link" href="https://mainbrella.com/bff/">Back to BFF <span aria-hidden="true">↗</span></a>
    </aside>
    <div className="board-feed">
      <div className="page-heading">
        <div><h1>{view === 'mine' ? 'My messages' : 'Message board'}</h1><p>Messages from a live BFF project.</p></div>
      </div>
      <section id="board-panel" className="board" aria-labelledby="board-title">
        <h2 id="board-title" className="visually-hidden">Messages</h2>
        <div className="toolbar">
          <label className="search-field" htmlFor="message-search">
            <span className="toolbar-label">Search messages</span><span className="search-icon" aria-hidden="true" />
            <input id="message-search" type="search" placeholder="Search messages" autoComplete="off" value={search} onChange={event => setSearch(event.target.value)} />
          </label>
          <label className="sort-control" htmlFor="message-sort"><span className="toolbar-label">Sort by</span>
            <select id="message-sort" value={sort} onChange={event => setSort(event.target.value)}>
              <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
            </select>
          </label>
          <button id="refresh" className="refresh-button" type="button" aria-label="Refresh messages" disabled={loading || saving} onClick={() => void load()}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16.2 8a6.5 6.5 0 0 0-11.8-2L2.8 8M2.8 4.8V8h3.3M3.8 12a6.5 6.5 0 0 0 11.8 2l1.6-2M17.2 15.2V12h-3.3" /></svg><span>Refresh</span>
          </button>
        </div>
        <p id="board-status" className="status-line" role="status" aria-live="polite">{status}</p>
        <p id="board-feedback" className="board-feedback" role="status" aria-live="polite">{feedback}</p>
        {data.loaded && data.error && <p id="refresh-error" className="inline-error" role="alert">{data.error}</p>}
        <div id="message-list" className="message-list" aria-busy={loading}>
          {loading && !data.loaded ? Array.from({ length: 3 }, (_, index) => <div key={index} className="skeleton-row" aria-hidden="true">
            <span className="skeleton-circle" /><span className="skeleton-copy"><span className="skeleton-line short" /><span className="skeleton-line long" /></span>
          </div>) : visible.map(message => <article key={message.id} id={`message-${encodeURIComponent(message.id)}`} className="message-row" tabIndex={-1}>
            <span className="avatar" aria-hidden="true">{message.user_id.trim().charAt(0).toLocaleUpperCase() || '?'}</span>
            <div className="message-content">
              <div className="message-header">
                <div className="message-meta">
                  <span className="message-board" title={boardById.get(message.board_id ?? '')?.slug}>
                    {boardLabel(message)}
                  </span>
                  <span className="message-author">{message.user_id}{session.session.user_id === message.user_id && <> <span className="message-you">(you)</span></>}</span>
                  <time className="message-time" dateTime={message.created_at} title={new Date(message.created_at).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' })}>{formatRelative(message.created_at)}</time>
                </div>
                {editingId !== message.id && <button ref={button => { if (button) editButtons.current.set(message.id, button); else editButtons.current.delete(message.id); }}
                  className="edit-button" type="button" data-edit-id={message.id} disabled={saving || Boolean(editingId)}
                  onClick={() => { setEditingId(message.id); setDraft(message.body); setEditError(''); setFeedback(''); }}>Edit</button>}
              </div>
              <h3 className="message-title">{message.title}</h3>
              {editingId === message.id ? <form className="message-edit-form" onSubmit={event => void save(event, message)}>
                <label className="editor-label" htmlFor="edit-message">Edit message</label>
                <textarea ref={textarea} id="edit-message" name="body" rows={3} maxLength={2000} value={draft} disabled={saving}
                  aria-describedby={editError ? 'edit-error' : undefined} onChange={event => setDraft(event.target.value)} />
                {editError && <p id="edit-error" className="edit-error" role="alert">{editError}</p>}
                <div className="edit-actions">
                  <button className="primary-button" type="submit" disabled={saving || loading}>{saving ? 'Saving…' : 'Save message'}</button>
                  <button className="secondary-button" type="button" disabled={saving} onClick={finishEditing}>Cancel</button>
                </div>
              </form> : <p className="message-body">{message.body}</p>}
            </div>
          </article>)}
        </div>
        {!loading && (!data.loaded || visible.length === 0) && <div id="board-state" className="board-state">
          <strong>{!data.loaded ? 'Could not load messages' : term ? 'No matching messages' : view === 'mine' ? "You don't have any messages yet." : 'No messages yet'}</strong>
          {(!data.loaded || term || view === 'all') && <span>{!data.loaded ? data.error : term ? 'Try another name or search term.' : 'New public messages will appear here.'}</span>}
          {!data.loaded && <button className="state-action" type="button" onClick={() => void load()}>Try again</button>}
        </div>}
      </section>
    </div>
    <aside className="recent-messages" aria-labelledby="recent-title">
      <h2 id="recent-title">Recent messages</h2>
      {loading && !data.loaded ? <div className="recent-loading" aria-hidden="true">
        {Array.from({ length: 3 }, (_, index) => <div key={index}><span className="skeleton-line short" /><span className="skeleton-line long" /></div>)}
      </div> : recent.length ? <ul className="recent-list">
        {recent.map(message => <li key={message.id}>
          <a className="recent-message" href={`#message-${encodeURIComponent(message.id)}`}>
            <span className="recent-board">{boardLabel(message)}</span>
            <p>{message.title}</p>
            <span className="recent-author">{message.user_id}</span>
            <time dateTime={message.created_at}>{formatRelative(message.created_at)}</time>
          </a>
        </li>)}
      </ul> : <p className="recent-empty">{!data.loaded ? 'Messages are unavailable.' : term ? 'No matching messages.' : 'No messages yet.'}</p>}
    </aside>
  </div>;
}

function formatRelative(value: string): string {
  const difference = (Date.parse(value) - Date.now()) / 1000;
  if (!Number.isFinite(difference)) return 'Date unavailable';
  const absolute = Math.abs(difference);
  const [amount, unit]: [number, Intl.RelativeTimeFormatUnit] = absolute < 60 ? [Math.round(difference), 'second']
    : absolute < 3600 ? [Math.round(difference / 60), 'minute']
      : absolute < 86400 ? [Math.round(difference / 3600), 'hour']
        : absolute < 604800 ? [Math.round(difference / 86400), 'day']
          : absolute < 2629800 ? [Math.round(difference / 604800), 'week']
            : absolute < 31557600 ? [Math.round(difference / 2629800), 'month'] : [Math.round(difference / 31557600), 'year'];
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(amount, unit);
}
