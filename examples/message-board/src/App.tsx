import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { createDemoApi, type DemoSession, type Message } from './api.ts';
import type { DemoUser } from './config.ts';

type BoardApi = ReturnType<typeof createDemoApi>;
const defaultApi = createDemoApi();
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The request failed. Try again.';
const capitalize = (value: string) => value.charAt(0).toLocaleUpperCase() + value.slice(1);

export function App({ api = defaultApi }: { api?: BoardApi }) {
  const [session, setSession] = useState<DemoSession | null>(null);
  const [user, setUser] = useState<DemoUser>('alice');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const busy = useRef(false);
  const loginSelect = useRef<HTMLSelectElement>(null);

  useEffect(() => () => { generation.current++; }, []);

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
        loginSelect.current?.focus();
      }
    }
  }

  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="topbar">
      <a className="wordmark" href="https://mainbrella.com/bff/" aria-label="BFF home">bff<span aria-hidden="true">.</span></a>
      <a className="back-link" href="https://mainbrella.com/bff/">Back to BFF <span aria-hidden="true">↗</span></a>
    </header>
    <main id="main" className="workspace">
      <div className="page-heading">
        <div><h1>Message board</h1><p>Messages from a live BFF project.</p></div>
        {session && <div id="session-controls" className="session-controls">
          <span id="current-user" className="current-user">{capitalize(session.session.user_id)}</span>
          <button id="logout" className="secondary-button" type="button" onClick={() => void logout()}>Log out</button>
        </div>}
      </div>
      {session ? <Board key={session.session.id} api={api} session={session} /> :
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
        </section>}
    </main>
  </>;
}

function Board({ api, session }: { api: BoardApi; session: DemoSession }) {
  const [data, setData] = useState<{ messages: Message[]; loaded: boolean; updated?: Date; error: string }>({ messages: [], loaded: false, error: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState('');
  const [editError, setEditError] = useState('');
  const [feedback, setFeedback] = useState('');
  const active = useRef(false);
  const serial = useRef(0);
  const busy = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const restoreFocus = useRef('');

  const load = useCallback(async () => {
    if (busy.current) return;
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
  }, [api, session]);

  useEffect(() => {
    active.current = true;
    void load();
    return () => { active.current = false; serial.current++; busy.current = false; };
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
  const visible = data.messages.filter(message => !term || message.user_id.toLocaleLowerCase().includes(term) || message.body.toLocaleLowerCase().includes(term))
    .sort((a, b) => sort === 'oldest' ? Date.parse(a.created_at) - Date.parse(b.created_at) : Date.parse(b.created_at) - Date.parse(a.created_at));
  const count = `${data.messages.length} ${data.messages.length === 1 ? 'message' : 'messages'}`;
  const status = loading ? (data.loaded ? 'Refreshing messages…' : 'Loading messages…') : !data.loaded ? 'Message board unavailable' :
    `${term ? `${visible.length} of ` : ''}${count}${data.error ? ' · Showing last loaded data' : data.updated ? ` · Updated at ${data.updated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}`;

  return <section id="board-panel" className="board" aria-labelledby="board-title">
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
      </div>) : visible.map(message => <article key={message.id} className="message-row">
        <span className="avatar" aria-hidden="true">{message.user_id.trim().charAt(0).toLocaleUpperCase() || '?'}</span>
        <div className="message-content">
          <div className="message-meta">
            <span className="message-author">{message.user_id}{session.session.user_id === message.user_id && <> <span className="message-you">(you)</span></>}</span>
            <time className="message-time" dateTime={message.created_at} title={new Date(message.created_at).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' })}>{formatRelative(message.created_at)}</time>
            {editingId !== message.id && <button ref={button => { if (button) editButtons.current.set(message.id, button); else editButtons.current.delete(message.id); }}
              className="edit-button" type="button" data-edit-id={message.id} disabled={saving || Boolean(editingId)}
              onClick={() => { setEditingId(message.id); setDraft(message.body); setEditError(''); setFeedback(''); }}>Edit</button>}
          </div>
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
      <strong>{!data.loaded ? 'Could not load messages' : term ? 'No matching messages' : 'No messages yet'}</strong>
      <span>{!data.loaded ? data.error : term ? 'Try another name or search term.' : 'New public messages will appear here.'}</span>
      {!data.loaded && <button className="state-action" type="button" onClick={() => void load()}>Try again</button>}
    </div>}
  </section>;
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
