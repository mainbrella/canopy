import { API_ORIGIN } from './auth.ts';

interface MarketingUser {
  id: string;
  email: string | null;
  name: string | null;
  created_at: string;
}

interface EmailAllElements {
  page: HTMLElement;
  status: HTMLElement;
  error: HTMLElement;
  list: HTMLUListElement;
  refresh: HTMLButtonElement;
}

function isMarketingUser(value: unknown): value is MarketingUser {
  return typeof value === 'object' && value !== null
    && 'id' in value && typeof value.id === 'string'
    && 'email' in value && (value.email === null || typeof value.email === 'string')
    && 'name' in value && (value.name === null || typeof value.name === 'string')
    && 'created_at' in value && typeof value.created_at === 'string';
}

function isMarketingUsersResponse(value: unknown): value is { users: MarketingUser[]; total: number; offset: number; limit: number } {
  return typeof value === 'object' && value !== null
    && 'users' in value && Array.isArray(value.users) && value.users.every(isMarketingUser)
    && 'total' in value && typeof value.total === 'number'
    && 'offset' in value && typeof value.offset === 'number'
    && 'limit' in value && typeof value.limit === 'number';
}

export function createEmailAllView(
  elements: EmailAllElements,
  canAccess: () => boolean,
  onAuthFailure: (status: 401 | 403) => void,
) {
  let active = false;
  let requestID = 0;

  function clear() {
    requestID++;
    elements.refresh.disabled = false;
    elements.page.setAttribute('aria-busy', 'false');
    elements.list.replaceChildren();
    elements.list.hidden = true;
    elements.status.textContent = '';
    elements.error.textContent = '';
    elements.error.hidden = true;
  }

  async function load() {
    if (!active || !canAccess()) return;
    const id = ++requestID;
    elements.refresh.disabled = true;
    elements.page.setAttribute('aria-busy', 'true');
    elements.status.textContent = 'Loading marketing users…';
    elements.error.textContent = '';
    elements.error.hidden = true;
    elements.list.replaceChildren();
    elements.list.hidden = true;
    try {
      const response = await fetch(`${API_ORIGIN}/api/get-marketing-users?offset=0&limit=25`, {
        credentials: 'include', headers: { accept: 'application/json' },
      });
      if (id !== requestID) return;
      if (response.status === 401 || response.status === 403) {
        onAuthFailure(response.status);
        return;
      }
      const result: unknown = await response.json().catch(() => null);
      if (id !== requestID) return;
      if (!response.ok || !isMarketingUsersResponse(result) || result.offset !== 0 || result.limit !== 25) {
        throw new Error('marketing_users_unavailable');
      }
      const rows = document.createDocumentFragment();
      for (const user of result.users) {
        const item = document.createElement('li');
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.value = user.id;
        const address = document.createElement('span');
        address.className = 'email-all-address';
        address.textContent = user.email || `${user.name || 'Unnamed user'} · no email address`;
        label.append(checkbox, address);
        item.append(label);
        rows.append(item);
      }
      elements.list.replaceChildren(rows);
      elements.list.hidden = result.users.length === 0;
      elements.status.textContent = result.total
        ? `Showing ${result.users.length.toLocaleString()} of ${result.total.toLocaleString()} marketing users · Newest first`
        : 'No marketing users found.';
    } catch {
      if (id !== requestID) return;
      elements.status.textContent = 'Could not load marketing users.';
      elements.error.textContent = 'Check your connection and use Refresh to try again.';
      elements.error.hidden = false;
    } finally {
      if (id === requestID) {
        elements.refresh.disabled = false;
        elements.page.setAttribute('aria-busy', 'false');
      }
    }
  }

  elements.refresh.addEventListener('click', () => void load());

  return {
    setActive(value: boolean) {
      if (active === value) return;
      active = value;
      if (active) void load();
      else requestID++;
    },
    clear,
  };
}
