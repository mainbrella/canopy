import { API_ORIGIN } from './auth.ts';

interface MarketingEmailInput {
  from: string;
  to: string;
  subj: string;
  message: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid_request: 'Check the sender and recipient addresses, subject, and message. The sender can be an email address or Name <address>.',
  request_too_large: 'The email is too large. Shorten the message and try again.',
  email_rate_limited: 'The email sending limit has been reached. Try again later.',
  email_send_failed: 'Could not send the email. Check the sender address and try again.',
  email_sending_unavailable: 'Email sending is temporarily unavailable. Try again later.',
  email_preferences_unavailable: 'Could not check this recipient’s email preferences. No email was sent; try again later.',
  admin_unavailable: 'Could not verify your admin session. Try again later.',
};
const UNCONFIRMED_MESSAGE = 'Could not confirm whether the email was sent. Check before trying again to avoid sending it twice.';

export function marketingEmailErrorMessage(cause: unknown) {
  return cause instanceof Error && Object.values(ERROR_MESSAGES).includes(cause.message)
    ? cause.message : UNCONFIRMED_MESSAGE;
}

export async function sendMarketingEmail(input: MarketingEmailInput): Promise<401 | 403 | 'unsubscribed' | null> {
  const response = await fetch(`${API_ORIGIN}/api/send-marketing-email`, {
    method: 'POST',
    credentials: 'include',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (response.status === 401 || response.status === 403) return response.status;
  const result: unknown = await response.json().catch(() => null);
  if (response.status === 409 && typeof result === 'object' && result !== null
    && 'error' in result && result.error === 'recipient_unsubscribed') return 'unsubscribed';
  if (response.status !== 202 || typeof result !== 'object' || result === null
    || !('ok' in result) || result.ok !== true
    || !('messageId' in result) || typeof result.messageId !== 'string' || !result.messageId.trim()) {
    const code = typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string'
      ? result.error : '';
    throw new Error(Object.hasOwn(ERROR_MESSAGES, code) ? ERROR_MESSAGES[code] : UNCONFIRMED_MESSAGE);
  }
  return null;
}
