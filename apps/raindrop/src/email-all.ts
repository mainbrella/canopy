import { API_ORIGIN } from './auth.ts';
import { marketingEmailErrorMessage, sendMarketingEmail } from './marketing-email.ts';

interface MarketingUser {
  id: string;
  email: string | null;
  name: string | null;
  created_at: string;
}

interface EmailAllElements {
  page: HTMLElement;
  form: HTMLFormElement;
  fields: HTMLFieldSetElement;
  from: HTMLInputElement;
  subj: HTMLInputElement;
  message: HTMLTextAreaElement;
  submit: HTMLButtonElement;
  sendStatus: HTMLElement;
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
  let sendRequestID = 0;
  let loading = false;
  let sending = false;

  function updateControls() {
    elements.refresh.disabled = loading || sending;
    elements.fields.disabled = sending;
    for (const checkbox of elements.list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      checkbox.disabled = sending || !checkbox.value;
    }
    elements.submit.disabled = loading || sending || !elements.list.querySelector('input:checked:not(:disabled)');
    elements.submit.textContent = sending ? 'Sending…' : 'Send emails';
    elements.form.setAttribute('aria-busy', String(sending));
    elements.page.setAttribute('aria-busy', String(loading || sending));
  }

  function clearSendFeedback() {
    elements.sendStatus.textContent = '';
    elements.error.textContent = '';
    elements.error.hidden = true;
  }

  function clear() {
    requestID++;
    sendRequestID++;
    loading = false;
    sending = false;
    elements.form.reset();
    for (const field of [elements.from, elements.subj, elements.message]) field.setCustomValidity('');
    elements.list.replaceChildren();
    elements.list.hidden = true;
    elements.status.textContent = '';
    clearSendFeedback();
    updateControls();
  }

  async function load() {
    if (!active || !canAccess() || sending) return;
    const id = ++requestID;
    loading = true;
    elements.status.textContent = 'Loading marketing users…';
    clearSendFeedback();
    elements.list.replaceChildren();
    elements.list.hidden = true;
    updateControls();
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
        checkbox.value = user.email?.trim() || '';
        checkbox.disabled = !checkbox.value;
        checkbox.checked = !checkbox.disabled;
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
        loading = false;
        updateControls();
      }
    }
  }

  elements.form.addEventListener('input', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) target.setCustomValidity('');
    clearSendFeedback();
  });
  elements.list.addEventListener('change', () => {
    clearSendFeedback();
    updateControls();
  });
  elements.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!active || !canAccess() || loading || sending) return;
    for (const field of [elements.from, elements.subj, elements.message]) {
      field.setCustomValidity(field.value.trim() ? '' : 'Enter a value for this field.');
    }
    if (!elements.form.reportValidity()) return;
    const recipients = Array.from(elements.list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked:not(:disabled)'));
    if (!recipients.length) return;
    const input = {
      from: elements.from.value.trim(),
      subj: elements.subj.value.trim(),
      message: elements.message.value,
    };
    const id = ++sendRequestID;
    let accepted = 0;
    let skipped = 0;
    let failed = 0;
    let firstError = '';
    clearSendFeedback();
    sending = true;
    updateControls();
    try {
      for (const [index, recipient] of recipients.entries()) {
        if (id !== sendRequestID) return;
        if (!canAccess()) break;
        elements.sendStatus.textContent = `Sending ${index + 1} of ${recipients.length} emails…`;
        try {
          const result = await sendMarketingEmail({ ...input, to: recipient.value });
          if (id !== sendRequestID) return;
          if (result === 401 || result === 403) {
            elements.sendStatus.textContent = '';
            onAuthFailure(result);
            return;
          }
          if (result === 'unsubscribed') {
            skipped++;
            recipient.checked = false;
            continue;
          }
          accepted++;
          recipient.checked = false;
        } catch (cause) {
          if (id !== sendRequestID) return;
          failed++;
          if (!firstError) firstError = `${recipient.value}: ${marketingEmailErrorMessage(cause)}`;
        }
      }
      const eligibleCount = recipients.length - skipped;
      elements.sendStatus.textContent = skipped === 0
        ? `${accepted} of ${recipients.length} emails accepted for sending.`
        : eligibleCount === 0
          ? 'No email was sent.'
          : `${accepted} of ${eligibleCount} emails accepted for sending.`;
      if (failed) {
        elements.error.textContent = `${failed} email${failed === 1 ? '' : 's'} could not be confirmed. ${firstError}`;
        elements.error.hidden = false;
      }
      if (accepted + skipped === recipients.length) {
        elements.subj.value = '';
        elements.message.value = '';
      }
    } finally {
      if (id === sendRequestID) {
        sending = false;
        updateControls();
      }
    }
  });
  elements.refresh.addEventListener('click', () => void load());

  return {
    setActive(value: boolean) {
      if (active === value) return;
      active = value;
      if (active) {
        if (!elements.list.childElementCount && !sending) void load();
      } else {
        requestID++;
        loading = false;
        updateControls();
      }
    },
    clear,
  };
}
