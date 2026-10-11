import { marketingEmailErrorMessage, sendMarketingEmail } from './marketing-email.ts';

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
      const authStatus = await sendMarketingEmail(input);
      if (id !== requestID) return;
      if (authStatus !== null) {
        elements.status.textContent = '';
        onAuthFailure(authStatus);
        return;
      }
      elements.to.value = '';
      elements.subj.value = '';
      elements.message.value = '';
      elements.status.textContent = 'Email accepted for sending.';
    } catch (cause) {
      if (id !== requestID) return;
      elements.status.textContent = '';
      elements.error.textContent = marketingEmailErrorMessage(cause);
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
