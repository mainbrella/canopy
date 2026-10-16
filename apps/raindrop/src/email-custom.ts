import { marketingEmailErrorMessage, sendMarketingEmail } from './marketing-email.ts';

interface CustomRecipient {
  row: string;
  email: string;
  name: string;
  first: string;
  line: number;
}

interface ParsedRecipients {
  recipients: CustomRecipient[];
  error: string | null;
}

interface EmailCustomElements {
  page: HTMLElement;
  form: HTMLFormElement;
  fields: HTMLFieldSetElement;
  from: HTMLInputElement;
  recipients: HTMLTextAreaElement;
  subj: HTMLInputElement;
  message: HTMLTextAreaElement;
  submit: HTMLButtonElement;
  status: HTMLElement;
  error: HTMLElement;
  recipientError: HTMLElement;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRecipients(value: string): ParsedRecipients {
  const recipients: CustomRecipient[] = [];
  const lines = value.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const row = line.trim();
    if (!row) continue;

    let value: unknown;
    try {
      value = JSON.parse(row);
    } catch {
      return { recipients, error: `Line ${index + 1}: enter a JSON object with a string "email", optional string "name" and "first".` };
    }
    if (!isRecord(value)) {
      return { recipients, error: `Line ${index + 1}: enter a JSON object with a string "email", optional string "name" and "first".` };
    }
    if (typeof value.email !== 'string' || !value.email.trim()) {
      return { recipients, error: `Line ${index + 1}: include a nonempty string "email" value.` };
    }
    if ((Object.hasOwn(value, 'name') && typeof value.name !== 'string')
      || (Object.hasOwn(value, 'first') && typeof value.first !== 'string')) {
      return { recipients, error: `Line ${index + 1}: "name" and "first" must be strings when provided.` };
    }
    recipients.push({
      row,
      email: value.email.trim(),
      name: typeof value.name === 'string' ? value.name : '',
      first: typeof value.first === 'string' ? value.first : '',
      line: index + 1,
    });
  }
  return { recipients, error: null };
}

function personalize(value: string, recipient: CustomRecipient): string {
  return value.replace(/\{\{(name|first)\}\}/g, (_match, field: string) => field === 'name' ? recipient.name : recipient.first);
}

function isValidEmail(value: string): boolean {
  const input = document.createElement('input');
  input.type = 'email';
  input.value = value;
  return value.length <= 254 && !input.validity.typeMismatch && input.validity.valid;
}

export function createEmailCustomView(
  elements: EmailCustomElements,
  canAccess: () => boolean,
  onAuthFailure: (status: 401 | 403) => void,
) {
  let active = false;
  let sending = false;
  let requestID = 0;

  function updateControls() {
    elements.fields.disabled = sending;
    elements.submit.disabled = sending;
    elements.submit.textContent = sending ? 'Sending…' : 'Send to all';
    elements.form.setAttribute('aria-busy', String(sending));
    elements.page.setAttribute('aria-busy', String(sending));
  }

  function clearFeedback() {
    elements.status.textContent = '';
    elements.error.textContent = '';
    elements.error.hidden = true;
    elements.recipientError.textContent = '';
    elements.recipientError.hidden = true;
  }

  function clearSendFeedback() {
    elements.status.textContent = '';
    elements.error.textContent = '';
    elements.error.hidden = true;
  }

  elements.form.addEventListener('input', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) target.setCustomValidity('');
    clearSendFeedback();
    if (target === elements.recipients) {
      elements.recipientError.textContent = '';
      elements.recipientError.hidden = true;
    }
  });

  elements.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!active || !canAccess() || sending) return;

    for (const field of [elements.from, elements.subj, elements.message]) {
      field.setCustomValidity(field.value.trim() ? '' : 'Enter a value for this field.');
    }
    if (!elements.form.reportValidity()) return;

    const parsed = parseRecipients(elements.recipients.value);
    if (parsed.error) {
      elements.recipients.setCustomValidity(parsed.error);
      elements.recipientError.textContent = parsed.error;
      elements.recipientError.hidden = false;
      elements.recipients.reportValidity();
      return;
    }
    const recipients = parsed.recipients;
    if (!recipients.length) {
      const message = 'Enter at least one JSON object with an email address.';
      elements.recipients.setCustomValidity(message);
      elements.recipientError.textContent = message;
      elements.recipientError.hidden = false;
      elements.recipients.reportValidity();
      return;
    }
    const invalidRecipient = recipients.find((recipient) => !isValidEmail(recipient.email));
    if (invalidRecipient) {
      const message = `Line ${invalidRecipient.line}: enter a valid email address before any emails are sent.`;
      elements.recipients.setCustomValidity(message);
      elements.recipientError.textContent = message;
      elements.recipientError.hidden = false;
      elements.recipients.reportValidity();
      return;
    }

    const input = {
      from: elements.from.value.trim(),
      subj: elements.subj.value.trim(),
      message: elements.message.value,
    };
    const id = ++requestID;
    const accepted = new Set<number>();
    const skipped = new Set<number>();
    const failures: string[] = [];
    clearFeedback();
    sending = true;
    updateControls();
    try {
      for (const [index, recipient] of recipients.entries()) {
        if (id !== requestID) return;
        if (!canAccess()) break;
        elements.status.textContent = `Sending ${index + 1} of ${recipients.length}…`;
        try {
          const result = await sendMarketingEmail({
            ...input,
            fancy: false,
            to: recipient.email,
            subj: personalize(input.subj, recipient),
            message: personalize(input.message, recipient),
          });
          if (id !== requestID) return;
          if (result === 401 || result === 403) {
            elements.status.textContent = '';
            onAuthFailure(result);
            return;
          }
          if (result === 'unsubscribed') {
            skipped.add(index);
            continue;
          }
          accepted.add(index);
        } catch (cause) {
          if (id !== requestID) return;
          const label = recipient.name ? `${recipient.email} (${recipient.name})` : recipient.email;
          failures.push(`Line ${recipient.line} · ${label}: ${marketingEmailErrorMessage(cause)}`);
        }
      }

      const remaining = recipients.filter((_, index) => !accepted.has(index) && !skipped.has(index));
      elements.recipients.value = remaining.map((recipient) => recipient.row).join('\n');
      const eligibleCount = recipients.length - skipped.size;
      if (failures.length) {
        elements.status.textContent = `${accepted.size} of ${eligibleCount} emails accepted for sending; ${failures.length} could not be confirmed.`;
        elements.error.textContent = failures.join('\n');
        elements.error.hidden = false;
      } else if (accepted.size + skipped.size === recipients.length) {
        elements.subj.value = '';
        elements.message.value = '';
        elements.status.textContent = accepted.size
          ? `${accepted.size} email${accepted.size === 1 ? '' : 's'} accepted for sending.`
          : 'No email was sent.';
      } else {
        const unattempted = eligibleCount - accepted.size;
        elements.status.textContent = `${accepted.size} of ${eligibleCount} emails accepted for sending. ${unattempted} recipient${unattempted === 1 ? '' : 's'} remain in the list.`;
      }
    } finally {
      if (id === requestID) {
        sending = false;
        updateControls();
      }
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
      for (const field of [elements.from, elements.recipients, elements.subj, elements.message]) field.setCustomValidity('');
      clearFeedback();
      sending = false;
      updateControls();
    },
  };
}
