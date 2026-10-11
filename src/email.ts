import { API_ORIGIN } from './auth.ts';

interface EmailElements {
  form: HTMLFormElement;
  fields: HTMLFieldSetElement;
  from: HTMLInputElement;
  to: HTMLInputElement;
  subj: HTMLInputElement;
  message: HTMLTextAreaElement;
  submit: HTMLButtonElement;
  status: HTMLElement;
  error: HTMLElement;
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid_request: 'Check the sender and recipient addresses, subject, and message. The sender can be an email address or Name <address>.',
  request_too_large: 'The email is too large. Shorten the message and try again.',
  email_rate_limited: 'The email sending limit has been reached. Try again later.',
  email_send_failed: 'Could not send the email. Check the sender address and try again.',
  email_sending_unavailable: 'Email sending is temporarily unavailable. Try again later.',
  admin_unavailable: 'Could not verify your admin session. Try again later.',
};
const UNCONFIRMED_MESSAGE = 'Could not confirm whether the email was sent. Check before trying again to avoid sending it twice.';

export function createEmailView(elements: EmailElements, canAccess: () => boolean, onAuthFailure: (status: 401 | 403) => void) {
  let active = false;
  let sending = false;
  let requestID = 0;

  function setSending(value: boolean) {
    sending = value;
    elements.fields.disabled = value;
    elements.form.setAttribute('aria-busy', String(value));
    elements.submit.textContent = value ? 'Sending…' : 'Send email';
  }

  function clearFeedback() {
    elements.status.textContent = '';
    elements.error.textContent = '';
    elements.error.hidden = true;
  }

  elements.form.addEventListener('input', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) target.setCustomValidity('');
    clearFeedback();
  });

  elements.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!active || !canAccess() || sending) return;
    for (const field of [elements.from, elements.subj, elements.message]) {
      field.setCustomValidity(field.value.trim() ? '' : 'Enter a value for this field.');
    }
    if (!elements.form.reportValidity()) return;

    const input = {
      from: elements.from.value.trim(),
      to: elements.to.value.trim(),
      subj: elements.subj.value.trim(),
      message: elements.message.value,
    };
    const id = ++requestID;
    clearFeedback();
    setSending(true);
    elements.status.textContent = 'Sending…';
    try {
      const response = await fetch(`${API_ORIGIN}/api/send-marketing-email`, {
        method: 'POST',
        credentials: 'include',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (id !== requestID) return;
      if (response.status === 401 || response.status === 403) {
        elements.status.textContent = '';
        onAuthFailure(response.status);
        return;
      }
      const result: unknown = await response.json().catch(() => null);
      if (id !== requestID) return;
      if (response.status !== 202 || typeof result !== 'object' || result === null
        || !('ok' in result) || result.ok !== true
        || !('messageId' in result) || typeof result.messageId !== 'string' || !result.messageId.trim()) {
        const code = typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string'
          ? result.error : '';
        throw new Error(ERROR_MESSAGES[code] || UNCONFIRMED_MESSAGE);
      }
      elements.to.value = '';
      elements.subj.value = '';
      elements.message.value = '';
      elements.status.textContent = 'Email accepted for sending.';
    } catch (cause) {
      if (id !== requestID) return;
      elements.status.textContent = '';
      elements.error.textContent = cause instanceof Error && Object.values(ERROR_MESSAGES).includes(cause.message)
        ? cause.message : UNCONFIRMED_MESSAGE;
      elements.error.hidden = false;
    } finally {
      if (id === requestID) setSending(false);
    }
  });

  return {
    setActive(value: boolean) {
      // Navigation preserves the draft and any send already in progress.
      active = value;
    },
    clear() {
      // Ignore late responses after sign-out without retrying or cancelling a send.
      requestID++;
      elements.form.reset();
      for (const field of [elements.from, elements.to, elements.subj, elements.message]) field.setCustomValidity('');
      clearFeedback();
      setSending(false);
    },
  };
}
