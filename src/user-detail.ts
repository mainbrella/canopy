import { API_ORIGIN } from './auth.ts';
import { isAdminUser, type AdminUser } from './types.ts';

interface Funding {
  id: string;
  createdAt: number;
  amountCents: number;
  revokedCents: number;
  reason: 'refund' | 'dispute' | null;
}
interface UserDetail {
  user: AdminUser;
  asOf: number;
  balance: { balanceCents: number; availableBalanceCents: number; reservedBalanceCents: number; currency: 'usd' };
  fundings: Funding[];
  nextFundingCursor: string | null;
}
interface UserDetailElements {
  page: HTMLElement;
  status: HTMLElement;
  error: HTMLElement;
  content: HTMLElement;
  name: HTMLElement;
  email: HTMLElement;
  plan: HTMLElement;
  created: HTMLElement;
  id: HTMLElement;
  balance: HTMLElement;
  available: HTMLElement;
  reserved: HTMLElement;
  fundingStatus: HTMLElement;
  table: HTMLElement;
  rows: HTMLTableSectionElement;
  refresh: HTMLButtonElement;
  previous: HTMLButtonElement;
  next: HTMLButtonElement;
  pagination: HTMLElement;
}

const PAGE_SIZE = 50;
const MAX_DATE_MS = 8_640_000_000_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isDate(value: unknown): value is number {
  return isInteger(value) && value >= 0 && value <= MAX_DATE_MS;
}

function isFunding(value: unknown): value is Funding {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0
    && isDate(value.createdAt) && isInteger(value.amountCents) && value.amountCents >= 0
    && isInteger(value.revokedCents) && value.revokedCents >= 0 && value.revokedCents <= value.amountCents
    && (value.reason === null || value.reason === 'refund' || value.reason === 'dispute');
}

function isUserDetail(value: unknown, userID: string, cursor: string | null): value is UserDetail {
  if (!isRecord(value) || !isAdminUser(value.user) || value.user.id !== userID || !isDate(value.asOf)
    || !isRecord(value.balance) || value.balance.currency !== 'usd'
    || !isInteger(value.balance.balanceCents) || !isInteger(value.balance.availableBalanceCents)
    || !isInteger(value.balance.reservedBalanceCents)
    || !Array.isArray(value.fundings) || value.fundings.length > PAGE_SIZE || !value.fundings.every(isFunding)
    || !(value.nextFundingCursor === null || (typeof value.nextFundingCursor === 'string'
      && value.nextFundingCursor.length > 0 && value.nextFundingCursor.length <= 200))) return false;
  const ids = new Set(value.fundings.map(funding => funding.id));
  return ids.size === value.fundings.length && !ids.has(cursor ?? '')
    && (value.nextFundingCursor === null || value.nextFundingCursor === value.fundings.at(-1)?.id);
}

function formatMoney(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

function formatDate(date: Date) {
  return date.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'UTC', timeZoneName: 'short',
  });
}

function makeTime(date: Date): HTMLTimeElement {
  const time = document.createElement('time');
  time.dateTime = date.toISOString();
  time.textContent = formatDate(date);
  time.title = date.toISOString();
  return time;
}

function renderFunding(funding: Funding) {
  const row = document.createElement('tr');
  const date = document.createElement('td');
  date.append(makeTime(new Date(funding.createdAt)));
  row.append(date);
  const state = funding.reason === 'dispute' ? 'Disputed'
    : funding.reason === 'refund' ? (funding.revokedCents === funding.amountCents ? 'Refunded' : 'Partially refunded')
      : 'Funded';
  for (const [index, value] of [formatMoney(funding.amountCents), formatMoney(funding.revokedCents), state, funding.id].entries()) {
    const cell = document.createElement('td');
    cell.textContent = value;
    if (index < 2) cell.className = 'funding-amount';
    if (index === 3) cell.className = 'funding-reference';
    row.append(cell);
  }
  return row;
}

export function createUserDetailView(elements: UserDetailElements, canAccess: () => boolean, onAuthFailure: (status: 401 | 403) => void) {
  let userID: string | null = null;
  let requestID = 0;
  let controller: AbortController | null = null;
  let cursors: (string | null)[] = [null];
  let pageIndex = 0;
  let nextCursor: string | null = null;

  function cancel() {
    requestID++;
    controller?.abort();
    controller = null;
    elements.page.setAttribute('aria-busy', 'false');
    elements.refresh.disabled = false;
  }

  function clear() {
    cancel();
    cursors = [null];
    pageIndex = 0;
    nextCursor = null;
    elements.content.hidden = true;
    elements.rows.replaceChildren();
    elements.table.hidden = true;
    elements.pagination.hidden = true;
    elements.error.hidden = true;
    elements.error.textContent = '';
    elements.status.textContent = '';
    elements.fundingStatus.textContent = '';
    for (const field of [elements.name, elements.email, elements.plan, elements.created, elements.id,
      elements.balance, elements.available, elements.reserved]) field.replaceChildren();
    updatePagination();
  }

  function updatePagination() {
    elements.previous.disabled = pageIndex === 0;
    elements.next.disabled = nextCursor === null;
  }

  async function load(cursor: string | null, targetIndex: number) {
    if (userID === null || !canAccess()) return;
    const requestedUserID = userID;
    controller?.abort();
    const currentController = new AbortController();
    controller = currentController;
    const id = ++requestID;
    elements.refresh.disabled = true;
    elements.previous.disabled = true;
    elements.next.disabled = true;
    elements.page.setAttribute('aria-busy', 'true');
    elements.error.hidden = true;
    elements.error.textContent = '';
    elements.status.textContent = elements.content.hidden ? 'Loading user…' : 'Loading user details…';
    const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursor !== null) query.set('fundingCursor', cursor);
    try {
      const response = await fetch(`${API_ORIGIN}/admin/users/${encodeURIComponent(requestedUserID)}?${query}`, {
        credentials: 'include', headers: { accept: 'application/json' }, signal: currentController.signal,
      });
      if (id !== requestID || !canAccess()) return;
      if (response.status === 401 || response.status === 403) {
        clear();
        onAuthFailure(response.status);
        return;
      }
      if (response.status === 404) {
        clear();
        elements.status.textContent = 'User not found.';
        return;
      }
      if (!response.ok) throw new Error('user_unavailable');
      const result: unknown = await response.json().catch(() => null);
      if (id !== requestID || !canAccess()) return;
      if (!isUserDetail(result, requestedUserID, cursor)) throw new Error('invalid_user_response');

      elements.name.textContent = result.user.name || '—';
      elements.email.textContent = result.user.email || '—';
      elements.plan.textContent = result.user.plan[0].toUpperCase() + result.user.plan.slice(1);
      elements.id.textContent = result.user.id;
      const created = new Date(result.user.created_at);
      elements.created.replaceChildren(Number.isFinite(created.getTime()) ? makeTime(created) : result.user.created_at || '—');
      elements.balance.textContent = formatMoney(result.balance.balanceCents);
      elements.available.textContent = formatMoney(result.balance.availableBalanceCents);
      elements.reserved.textContent = formatMoney(result.balance.reservedBalanceCents);
      elements.status.textContent = `Updated ${formatDate(new Date(result.asOf))}`;
      const rows = document.createDocumentFragment();
      for (const funding of result.fundings) rows.append(renderFunding(funding));
      elements.rows.replaceChildren(rows);
      elements.content.hidden = false;
      elements.table.hidden = result.fundings.length === 0;
      pageIndex = targetIndex;
      cursors = cursors.slice(0, targetIndex + 1);
      cursors[targetIndex] = cursor;
      nextCursor = result.nextFundingCursor;
      elements.pagination.hidden = pageIndex === 0 && nextCursor === null;
      elements.fundingStatus.textContent = result.fundings.length
        ? `Page ${(pageIndex + 1).toLocaleString()} · ${result.fundings.length.toLocaleString()} ${result.fundings.length === 1 ? 'funding' : 'fundings'} · Newest first`
        : pageIndex === 0 ? 'No funding history.' : 'No funding on this page.';
    } catch {
      if (id !== requestID || currentController.signal.aborted) return;
      elements.status.textContent = elements.content.hidden ? 'Could not load user details.' : 'Could not update user details.';
      elements.error.textContent = 'Check your connection and use Refresh to try again.';
      elements.error.hidden = false;
    } finally {
      if (id === requestID) {
        controller = null;
        elements.refresh.disabled = false;
        elements.page.setAttribute('aria-busy', 'false');
        updatePagination();
      }
    }
  }

  elements.refresh.addEventListener('click', () => { void load(null, 0); });
  elements.previous.addEventListener('click', () => {
    if (pageIndex > 0) void load(cursors[pageIndex - 1], pageIndex - 1);
  });
  elements.next.addEventListener('click', () => {
    if (nextCursor !== null) void load(nextCursor, pageIndex + 1);
  });

  return {
    setUser(value: string | null) {
      if (userID === value) return;
      userID = value;
      clear();
      if (value !== null) {
        if (!value || value.length > 200) elements.status.textContent = 'User not found.';
        else void load(null, 0);
      }
    },
  };
}
