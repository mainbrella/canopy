import './demo.css';
import { fetchPublicMessages, liveBoardConfig, type Message } from './demo-data.ts';

type SortOrder = 'newest' | 'oldest';

export function initializeDemo(): void {
  const search = document.querySelector<HTMLInputElement>('#message-search');
  const demoUser = document.querySelector<HTMLSelectElement>('#demo-user');
  const sort = document.querySelector<HTMLSelectElement>('#message-sort');
  const refresh = document.querySelector<HTMLButtonElement>('#refresh');
  const status = document.querySelector<HTMLElement>('#board-status');
  const refreshError = document.querySelector<HTMLElement>('#refresh-error');
  const list = document.querySelector<HTMLElement>('#message-list');
  const state = document.querySelector<HTMLElement>('#board-state');
  if (!search || !demoUser || !sort || !refresh || !status || !refreshError || !list || !state) return;

  let messages: Message[] = [];
  let hasLoaded = false;
  let loading = false;
  let lastUpdated: Date | undefined;

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
      if (demoUser!.value === message.user_id) {
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
      meta.append(author, time);
      const body = document.createElement('p');
      body.className = 'message-body';
      body.textContent = message.body;
      content.append(meta, body);
      row.append(avatar, content);
      fragment.append(row);
    }
    list!.append(fragment);
    updateStatus(visible.length);
  }

  async function loadMessages(): Promise<void> {
    if (loading) return;
    loading = true;
    refresh!.disabled = true;
    list!.setAttribute('aria-busy', 'true');
    refreshError!.hidden = true;
    refreshError!.textContent = '';
    clearState();
    if (!hasLoaded) drawSkeleton();
    updateStatus();
    try {
      const next = await fetchPublicMessages(liveBoardConfig);
      messages = next;
      hasLoaded = true;
      lastUpdated = new Date();
      drawMessages();
    } catch (error) {
      const message = navigator.onLine === false
        ? 'You appear to be offline. Reconnect and try again.'
        : error instanceof Error ? error.message : 'Could not load messages. Try again.';
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
      loading = false;
      refresh!.disabled = false;
      list!.setAttribute('aria-busy', 'false');
      if (hasLoaded && !refreshError!.hidden) status!.textContent = `${messages.length} ${messages.length === 1 ? 'message' : 'messages'} · Showing last loaded data`;
      else updateStatus();
    }
  }

  search.addEventListener('input', () => { if (hasLoaded) drawMessages(); });
  demoUser.addEventListener('change', () => { if (hasLoaded) drawMessages(); });
  sort.addEventListener('change', () => { if (hasLoaded) drawMessages(); });
  refresh.addEventListener('click', () => void loadMessages());
  void loadMessages();
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
