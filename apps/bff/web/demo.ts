import './demo.css';
import { createDemoApi, type DemoSession, type Message } from './demo-data.ts';

type DemoUser = 'alice' | 'bob';
type SortOrder = 'newest' | 'oldest';

export function initializeDemo(): void {
  const loginForm = document.querySelector<HTMLFormElement>('#login-form');
  const loginUser = document.querySelector<HTMLSelectElement>('#login-user');
  const loginButton = document.querySelector<HTMLButtonElement>('#login-button');
  const loginFeedback = document.querySelector<HTMLElement>('#login-feedback');
  const loginPanel = document.querySelector<HTMLElement>('#login-panel');
  const boardPanel = document.querySelector<HTMLElement>('#board-panel');
  const sessionControls = document.querySelector<HTMLElement>('#session-controls');
  const currentUser = document.querySelector<HTMLElement>('#current-user');
  const logoutButton = document.querySelector<HTMLButtonElement>('#logout');
  const search = document.querySelector<HTMLInputElement>('#message-search');
  const sort = document.querySelector<HTMLSelectElement>('#message-sort');
  const refresh = document.querySelector<HTMLButtonElement>('#refresh');
  const status = document.querySelector<HTMLElement>('#board-status');
  const feedback = document.querySelector<HTMLElement>('#board-feedback');
  const refreshError = document.querySelector<HTMLElement>('#refresh-error');
  const list = document.querySelector<HTMLElement>('#message-list');
  const state = document.querySelector<HTMLElement>('#board-state');
  if (!loginForm || !loginUser || !loginButton || !loginFeedback || !loginPanel || !boardPanel
    || !sessionControls || !currentUser || !logoutButton || !search || !sort || !refresh
    || !status || !feedback || !refreshError || !list || !state) return;

  const api = createDemoApi();
  let session: DemoSession | undefined;
  let generation = 0;
  let loadSerial = 0;
  let saveSerial = 0;
  let messages: Message[] = [];
  let hasLoaded = false;
  let loading = false;
  let saving = false;
  let lastUpdated: Date | undefined;
  let editingId = '';
  let editDraft = '';
  let editError = '';

  function errorText(error: unknown): string {
    return error instanceof Error ? error.message : 'The request failed. Try again.';
  }

  function filteredMessages(): Message[] {
    const term = search!.value.trim().toLocaleLowerCase();
    const order: SortOrder = sort!.value === 'oldest' ? 'oldest' : 'newest';
    return messages
      .filter(message => !term || message.user_id.toLocaleLowerCase().includes(term) || message.body.toLocaleLowerCase().includes(term))
      .sort((a, b) => order === 'newest'
        ? Date.parse(b.created_at) - Date.parse(a.created_at)
        : Date.parse(a.created_at) - Date.parse(b.created_at));
  }

  function updateStatus(visibleCount = filteredMessages().length): void {
    if (loading) {
      status!.textContent = hasLoaded ? 'Refreshing messages…' : 'Loading messages…';
      return;
    }
    if (!hasLoaded) return;
    const noun = messages.length === 1 ? 'message' : 'messages';
    const freshness = !refreshError!.hidden ? ' · Showing last loaded data'
      : lastUpdated ? ` · Updated at ${lastUpdated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
    status!.textContent = search!.value.trim()
      ? `${visibleCount} of ${messages.length} ${noun}${freshness}`
      : `${messages.length} ${noun}${freshness}`;
  }

  function clearState(): void {
    state!.hidden = true;
    state!.replaceChildren();
  }

  function showState(title: string, message: string, withRetry = false): void {
    const heading = document.createElement('strong');
    heading.textContent = title;
    const detail = document.createElement('span');
    detail.textContent = message;
    state!.replaceChildren(heading, detail);
    if (withRetry) {
      const button = document.createElement('button');
      button.className = 'state-action';
      button.type = 'button';
      button.textContent = 'Try again';
      button.addEventListener('click', () => void loadMessages());
      state!.append(button);
    }
    state!.hidden = false;
  }

  function drawSkeleton(): void {
    list!.replaceChildren();
    for (let i = 0; i < 3; i++) {
      const row = document.createElement('div');
      row.className = 'skeleton-row';
      row.setAttribute('aria-hidden', 'true');
      const avatar = document.createElement('span');
      avatar.className = 'skeleton-circle';
      const copy = document.createElement('span');
      copy.className = 'skeleton-copy';
      const author = document.createElement('span');
      author.className = 'skeleton-line short';
      const body = document.createElement('span');
      body.className = 'skeleton-line long';
      copy.append(author, body);
      row.append(avatar, copy);
      list!.append(row);
    }
  }

  function drawMessages(): void {
    const visible = filteredMessages();
    list!.replaceChildren();
    clearState();
    if (!visible.length) {
      if (search!.value.trim()) showState('No matching messages', 'Try another name or search term.');
      else showState('No messages yet', 'New public messages will appear here.');
      updateStatus(0);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const message of visible) {
      const row = document.createElement('article');
      row.className = 'message-row';
      const avatar = document.createElement('span');
      avatar.className = 'avatar';
      avatar.setAttribute('aria-hidden', 'true');
      avatar.textContent = message.user_id.trim().charAt(0).toLocaleUpperCase() || '?';

      const content = document.createElement('div');
      content.className = 'message-content';
      const meta = document.createElement('div');
      meta.className = 'message-meta';
      const author = document.createElement('span');
      author.className = 'message-author';
      author.textContent = message.user_id;
      if (session!.session.user_id === message.user_id) {
        const you = document.createElement('span');
        you.className = 'message-you';
        you.textContent = '(you)';
        author.append(' ', you);
      }
      const time = document.createElement('time');
      time.className = 'message-time';
      const date = new Date(message.created_at);
      time.dateTime = message.created_at;
      time.title = date.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' });
      time.textContent = formatRelative(message.created_at);
      if (editingId === message.id) {
        meta.append(author, time);
        const editForm = document.createElement('form');
        editForm.className = 'message-edit-form';
        const label = document.createElement('label');
        const inputId = `edit-message-${safeId(message.id)}`;
        label.className = 'editor-label';
        label.htmlFor = inputId;
        label.textContent = 'Edit message';
        const textarea = document.createElement('textarea');
        textarea.id = inputId;
        textarea.name = 'body';
        textarea.rows = 3;
        textarea.maxLength = 2000;
        textarea.value = editDraft;
        textarea.disabled = saving;
        textarea.addEventListener('input', () => { editDraft = textarea.value; });
        editForm.append(label, textarea);
        if (editError) {
          const error = document.createElement('p');
          error.className = 'edit-error';
          error.setAttribute('role', 'alert');
          error.textContent = editError;
          editForm.append(error);
        }
        const actions = document.createElement('div');
        actions.className = 'edit-actions';
        const save = document.createElement('button');
        save.className = 'primary-button';
        save.type = 'submit';
        save.disabled = saving;
        save.textContent = saving ? 'Saving…' : 'Save message';
        const cancel = document.createElement('button');
        cancel.className = 'secondary-button';
        cancel.type = 'button';
        cancel.disabled = saving;
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', () => {
          if (saving) return;
          editingId = '';
          editDraft = '';
          editError = '';
          drawMessages();
          Array.from(list!.querySelectorAll<HTMLButtonElement>('[data-edit-id]'))
            .find(button => button.dataset.editId === message.id)?.focus();
        });
        actions.append(save, cancel);
        editForm.append(actions);
        editForm.addEventListener('submit', event => {
          event.preventDefault();
          void saveMessage(message);
        });
        content.append(editForm);
      } else {
        const body = document.createElement('p');
        body.className = 'message-body';
        body.textContent = message.body;
        const edit = document.createElement('button');
        edit.className = 'edit-button';
        edit.type = 'button';
        edit.disabled = saving || Boolean(editingId);
        edit.textContent = 'Edit';
        edit.addEventListener('click', () => {
          if (saving || editingId) return;
          editingId = message.id;
          editDraft = message.body;
          editError = '';
          feedback!.textContent = '';
          drawMessages();
          document.getElementById(`edit-message-${safeId(message.id)}`)?.focus();
        });
        edit.dataset.editId = message.id;
        meta.append(author, time, edit);
        content.append(body);
      }
      content.prepend(meta);
      row.append(avatar, content);
      fragment.append(row);
    }
    list!.append(fragment);
    updateStatus(visible.length);
  }

  async function loadMessages(): Promise<void> {
    if (!session || loading || saving) return;
    const activeSession = session;
    const activeGeneration = generation;
    const activeLoad = ++loadSerial;
    loading = true;
    refresh!.disabled = true;
    list!.setAttribute('aria-busy', 'true');
    refreshError!.hidden = true;
    refreshError!.textContent = '';
    feedback!.textContent = '';
    clearState();
    if (!hasLoaded) drawSkeleton();
    updateStatus();
    try {
      const next = await api.list(activeSession);
      if (activeGeneration !== generation || session !== activeSession) return;
      messages = next;
      hasLoaded = true;
      lastUpdated = new Date();
      drawMessages();
    } catch (error) {
      if (activeGeneration !== generation || session !== activeSession) return;
      const message = navigator.onLine === false
        ? 'You appear to be offline. Reconnect and try again.' : errorText(error);
      if (!hasLoaded) {
        list!.replaceChildren();
        showState('Could not load messages', message, true);
      } else {
        refreshError!.textContent = message;
        refreshError!.hidden = false;
        drawMessages();
      }
      status!.textContent = hasLoaded ? `${messages.length} ${messages.length === 1 ? 'message' : 'messages'} · Showing last loaded data` : 'Message board unavailable';
    } finally {
      if (activeLoad === loadSerial) {
        loading = false;
        refresh!.disabled = false;
        list!.setAttribute('aria-busy', 'false');
        if (activeGeneration === generation && session === activeSession) {
          if (hasLoaded && !refreshError!.hidden) status!.textContent = `${messages.length} ${messages.length === 1 ? 'message' : 'messages'} · Showing last loaded data`;
          else updateStatus();
        }
      }
    }
  }

  async function saveMessage(message: Message): Promise<void> {
    if (!session || saving || loading || editingId !== message.id) return;
    const body = editDraft.trim();
    if (!body || body.length > 2000) {
      editError = 'Enter a message of 1–2000 characters.';
      drawMessages();
      document.getElementById(`edit-message-${safeId(message.id)}`)?.focus();
      return;
    }
    const activeSession = session;
    const activeGeneration = generation;
    const activeSave = ++saveSerial;
    saving = true;
    editError = '';
    refresh!.disabled = true;
    feedback!.textContent = '';
    drawMessages();
    try {
      const updated = await api.update(activeSession, message, body);
      if (activeGeneration !== generation || session !== activeSession) return;
      if (!updated) {
        editError = 'No message was updated. Your edit was not saved.';
        return;
      }
      messages = messages.map(row => row.id === updated.id ? updated : row);
      editingId = '';
      editDraft = '';
      editError = '';
      feedback!.textContent = 'Message updated.';
      lastUpdated = new Date();
    } catch (error) {
      if (activeGeneration !== generation || session !== activeSession) return;
      editError = errorText(error);
    } finally {
      if (activeSave === saveSerial) {
        saving = false;
        refresh!.disabled = false;
        if (activeGeneration === generation && session === activeSession) {
          drawMessages();
          if (editError) document.getElementById(`edit-message-${safeId(message.id)}`)?.focus();
        }
      }
    }
  }

  async function login(): Promise<void> {
    if (session || loginButton!.disabled) return;
    const userId = loginUser!.value as DemoUser;
    const activeGeneration = ++generation;
    loginButton!.disabled = true;
    loginFeedback!.hidden = true;
    loginFeedback!.textContent = '';
    try {
      const created = await api.login(userId);
      if (activeGeneration !== generation) {
        void api.logout(created).catch(() => {});
        return;
      }
      session = created;
      messages = [];
      hasLoaded = false;
      lastUpdated = undefined;
      editingId = '';
      editDraft = '';
      editError = '';
      search!.value = '';
      sort!.value = 'newest';
      refreshError!.hidden = true;
      feedback!.textContent = '';
      currentUser!.textContent = capitalize(created.session.user_id);
      loginPanel!.hidden = true;
      boardPanel!.hidden = false;
      sessionControls!.hidden = false;
      await loadMessages();
    } catch (error) {
      if (activeGeneration !== generation) return;
      loginFeedback!.textContent = errorText(error);
      loginFeedback!.hidden = false;
    } finally {
      if (activeGeneration === generation && !session) loginButton!.disabled = false;
    }
  }

  async function logout(): Promise<void> {
    if (!session) return;
    const endedSession = session;
    generation++;
    loadSerial++;
    saveSerial++;
    session = undefined;
    loading = false;
    saving = false;
    hasLoaded = false;
    messages = [];
    lastUpdated = undefined;
    editingId = '';
    editDraft = '';
    editError = '';
    search!.value = '';
    sort!.value = 'newest';
    status!.textContent = '';
    feedback!.textContent = '';
    refreshError!.textContent = '';
    refreshError!.hidden = true;
    list!.replaceChildren();
    list!.setAttribute('aria-busy', 'false');
    refresh!.disabled = false;
    clearState();
    currentUser!.textContent = '';
    sessionControls!.hidden = true;
    boardPanel!.hidden = true;
    loginPanel!.hidden = false;
    loginButton!.disabled = true;
    loginFeedback!.hidden = true;
    loginFeedback!.textContent = '';
    loginUser!.focus();
    try {
      await api.logout(endedSession);
    } catch (error) {
      loginFeedback!.textContent = `You are logged out in this browser, but the server could not revoke the session: ${errorText(error)}`;
      loginFeedback!.hidden = false;
    } finally {
      loginButton!.disabled = false;
    }
  }

  search.addEventListener('input', () => { if (hasLoaded) drawMessages(); });
  sort.addEventListener('change', () => { if (hasLoaded) drawMessages(); });
  refresh.addEventListener('click', () => void loadMessages());
  logoutButton.addEventListener('click', () => void logout());
  loginForm.addEventListener('submit', event => { event.preventDefault(); void login(); });
  loginPanel.hidden = false;
  boardPanel.hidden = true;
  sessionControls.hidden = true;
}

function capitalize(userId: string): string {
  return userId.length ? userId[0].toLocaleUpperCase() + userId.slice(1) : userId;
}

function safeId(value: string): string {
  return Array.from(value, character => /[a-zA-Z0-9_-]/.test(character) ? character : '-').join('');
}

function formatRelative(value: string): string {
  const date = new Date(value);
  const differenceSeconds = (date.getTime() - Date.now()) / 1000;
  if (!Number.isFinite(differenceSeconds)) return 'Date unavailable';
  const absolute = Math.abs(differenceSeconds);
  const [amount, unit]: [number, Intl.RelativeTimeFormatUnit] = absolute < 60 ? [Math.round(differenceSeconds), 'second']
    : absolute < 3600 ? [Math.round(differenceSeconds / 60), 'minute']
      : absolute < 86400 ? [Math.round(differenceSeconds / 3600), 'hour']
        : absolute < 604800 ? [Math.round(differenceSeconds / 86400), 'day']
          : absolute < 2629800 ? [Math.round(differenceSeconds / 604800), 'week']
            : absolute < 31557600 ? [Math.round(differenceSeconds / 2629800), 'month']
              : [Math.round(differenceSeconds / 31557600), 'year'];
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(amount, unit);
}
