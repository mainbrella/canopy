import { API_ORIGIN } from './auth.ts';
import { readBalanceHistory, type BalanceHistory } from './balance-history-data.ts';
import { formatActivityCost, overviewActivities, type ActivityKind, type OverviewActivity } from './overview-feed-data.ts';
import type { PrepaidBalance } from './types.ts';

const iconPaths: Record<ActivityKind, string> = {
  production: '<rect x="4" y="3" width="16" height="7" rx="2"/><rect x="4" y="14" width="16" height="7" rx="2"/><path d="M8 6.5h.01M8 17.5h.01M12 6.5h4M12 17.5h4"/>',
  ad_hoc: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3m6 0h4"/>',
  storage: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3"/>',
  ai: '<path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z"/>',
  funding: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 9h18m-9 3v4m-2-2h4"/>',
  history: '<path d="M3 11a9 9 0 1 1 2.5 7M3 4v7h7m2-4v5l3 2"/>',
};

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function activityRow(activity: OverviewActivity) {
  const row = element('li', 'overview-activity');
  row.dataset.activityId = activity.id;
  const icon = element('span', 'overview-activity-icon');
  icon.setAttribute('aria-hidden', 'true');
  // These are fixed local paths; all account content is inserted as text.
  icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${iconPaths[activity.kind]}</svg>`;
  const content = element('div', 'overview-activity-content');
  const heading = element('div', 'overview-activity-heading');
  const title = activity.href ? element('a', 'overview-activity-title', activity.title) : element('strong', 'overview-activity-title', activity.title);
  if (activity.href) (title as HTMLAnchorElement).href = activity.href;
  heading.append(title);
  if (activity.state) {
    const state = element('span', 'overview-activity-state', activity.state);
    state.dataset.active = String(activity.state === 'Consuming balance');
    heading.append(state);
  }
  content.append(heading, element('p', 'overview-activity-detail', activity.detail));
  if (activity.timestamp !== undefined) {
    const time = element('time', 'overview-activity-time');
    time.dateTime = new Date(activity.timestamp).toISOString();
    time.textContent = new Date(activity.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    time.title = new Date(activity.timestamp).toLocaleString();
    content.append(time);
  }
  const cost = element('div', 'overview-activity-cost');
  if (activity.credit) cost.classList.add('overview-credit');
  cost.append(element('strong', undefined, activity.amount), element('span', undefined, activity.amountLabel));
  if (activity.secondaryAmount) cost.append(element('small', undefined, activity.secondaryAmount));
  row.append(icon, content, cost);
  return row;
}

export function createOverviewFeed({ onUnauthenticated, onBalance }: {
  onUnauthenticated: () => void; onBalance: (balance: PrepaidBalance) => void;
}) {
  const root = document.querySelector<HTMLElement>('#dashboard-overview')!;
  const content = document.querySelector<HTMLElement>('#overview-feed')!;
  const status = document.querySelector<HTMLElement>('#overview-status')!;
  const error = document.querySelector<HTMLElement>('#overview-error')!;
  const refresh = document.querySelector<HTMLButtonElement>('#overview-refresh')!;
  const retry = document.querySelector<HTMLButtonElement>('#overview-retry')!;
  let snapshot: BalanceHistory | null = null;
  let controller: AbortController | null = null;
  let version = 0;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function render(data: BalanceHistory) {
    const groups = overviewActivities(data);
    const focused = document.activeElement;
    const focusedId = focused && root.contains(focused)
      ? focused.closest<HTMLElement>('.overview-activity')?.dataset.activityId : undefined;
    for (const group of ['running', 'recent', 'summaries'] as const) {
      const rows = group === 'recent' ? groups[group].slice(0, 10) : groups[group];
      const rendered = rows.map(activityRow);
      document.querySelector<HTMLElement>(`#overview-${group}`)!.replaceChildren(...rendered);
      // Background cost updates should keep the user's place in keyboard navigation.
      if (focusedId) rendered.find(row => row.dataset.activityId === focusedId)?.querySelector<HTMLAnchorElement>('a')?.focus({ preventScroll: true });
    }
    document.querySelector<HTMLElement>('#overview-running-empty')!.hidden = groups.running.length > 0;
    document.querySelector<HTMLElement>('#overview-recent-empty')!.hidden = groups.recent.length > 0;
    document.querySelector<HTMLElement>('#overview-summaries-section')!.hidden = groups.summaries.length === 0;
    document.querySelector<HTMLElement>('#overview-hourly')!.textContent = formatActivityCost(data.currentHourlyCents);
    document.querySelector<HTMLElement>('#overview-monthly')!.textContent = formatActivityCost(data.balance.monthlyUsageCents);
    document.querySelector<HTMLElement>('#overview-cap')!.textContent = `${formatActivityCost(data.balance.spendLimitCents)} monthly spending cap`;
    const date = new Date(data.asOf).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    document.querySelector<HTMLElement>('#overview-updated')!.textContent = `Updated ${date}`;
    document.querySelector<HTMLElement>('#overview-history-note')!.hidden = groups.recent.length <= 10 && !data.historyTruncated && !data.nextResourceCursor && !data.nextFundingCursor;
    const warning = document.querySelector<HTMLElement>('#overview-storage-warning')!;
    warning.textContent = data.storage?.retention?.notice ?? '';
    warning.hidden = !warning.textContent;
    content.hidden = false;
    status.hidden = true;
  }

  function schedule() {
    clearTimeout(timer);
    if (!disposed) timer = setTimeout(() => {
      if (document.visibilityState === 'visible') void load(true);
      else schedule();
    }, 30_000);
  }

  async function load(background = false) {
    if (disposed || controller) return;
    clearTimeout(timer);
    const currentVersion = ++version;
    const requestController = new AbortController();
    controller = requestController;
    root.setAttribute('aria-busy', 'true');
    refresh.disabled = retry.disabled = true;
    if (!background) {
      error.hidden = retry.hidden = true;
      refresh.textContent = 'Refreshing…';
      status.hidden = false;
      status.textContent = snapshot ? 'Refreshing activity…' : 'Loading your activity…';
    }
    try {
      const response = await fetch(`${API_ORIGIN}/billing/history?limit=10`, {
        credentials: 'include', headers: { accept: 'application/json' }, cache: 'no-store',
        signal: AbortSignal.any([requestController.signal, AbortSignal.timeout(15_000)]),
      });
      if (disposed || currentVersion !== version) return;
      if (response.status === 401) { dispose(); onUnauthenticated(); return; }
      if (!response.ok) throw new Error('activity_unavailable');
      const data = readBalanceHistory(await response.json());
      if (disposed || currentVersion !== version) return;
      snapshot = data;
      render(data);
      error.hidden = retry.hidden = true;
      onBalance(data.balance);
    } catch {
      if (disposed || currentVersion !== version) return;
      status.hidden = true;
      error.textContent = snapshot
        ? 'Could not refresh activity. Showing the last loaded costs. Try again.'
        : 'Could not load your activity and costs. Try again.';
      error.hidden = retry.hidden = false;
    } finally {
      if (currentVersion === version && !disposed) {
        controller = null;
        root.setAttribute('aria-busy', 'false');
        refresh.disabled = retry.disabled = false;
        refresh.textContent = 'Refresh';
        schedule();
      }
    }
  }

  function dispose() {
    disposed = true;
    version++;
    controller?.abort();
    controller = null;
    clearTimeout(timer);
    snapshot = null;
    content.hidden = true;
    for (const group of ['running', 'recent', 'summaries']) document.querySelector<HTMLElement>(`#overview-${group}`)!.replaceChildren();
  }

  refresh.addEventListener('click', () => { void load(); });
  retry.addEventListener('click', () => { void load(); });
  return { load, dispose };
}
