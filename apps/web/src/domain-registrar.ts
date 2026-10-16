import { API_ORIGIN } from './api-origin.ts';
export interface DomainOrder {
  id: string; domainName: string; projectId: string | null; kind: 'registration' | 'renewal'; years: number;
  amountCents: number; renewalCents: number; premium: boolean; autoRenew: boolean; status: string; error: string | null; expiresAt: number;
}
export interface RegisteredDomain { domainName: string; projectId: string | null; expireDate: string; autoRenew: boolean; renewalCents: number; error: string | null }
export const domainMessages: Record<string, string> = {
  registrar_unavailable: 'Could not reach the domain registrar. Try again.', billing_unavailable: 'Domain checkout is unavailable. Try again later.',
  registrar_not_found: 'The registrar could not verify this domain. Try again later.', invalid_registrar_price: 'The registrar returned an invalid price. Try again later.',
  domain_unavailable: 'This domain is no longer available. Search for another name.', domain_unsupported: 'This name or registration term is not supported.',
  domain_claims_unsupported: 'This domain requires a trademark review and cannot be purchased here yet.',
  domain_connection_unavailable: 'Automatic domain setup is unavailable for this project.',
  price_changed: 'The price changed. Review a fresh quote before paying.', quote_expired: 'This quote expired. Choose the domain again for a fresh price.',
  domain_order_pending: 'There is already an order for this domain. Continue it from your domains list.',
  contact_required: 'Complete the registration contact details.', invalid_request: 'Check the details and try again.',
  checkout_expired: 'This checkout expired. Choose the domain again.', domain_connection_pending: 'Registered. DNS and HTTPS are still being configured.',
  registration_failed: 'Registration failed. Your payment is being refunded.', verification_pending: 'The verification email may take up to 10 minutes to become available.',
  renewal_price_changed: 'The renewal price increased. Review and pay for a renewal to keep your domain.',
  renewal_payment_failed: 'Automatic renewal needs attention. Check the pending order or renew with another card.',
  managed_dns_record: 'MainBrella manages this record while your project is connected.', domain_locked: 'Turn off the transfer lock before requesting a transfer code.',
  order_review_required: 'This order needs support review. Do not place another order for this domain.', payment_mismatch: 'Payment could not be verified. Contact support with your order ID.',
  refund_failed: 'The refund needs support review. Contact support with your order ID.',
  not_found: 'This domain or order is not available in your account.',
};
const states = ['quoted','checkout','charging','paid','fulfilling','registered','connecting','complete','refunding','refunded','expired','review'];
export function parseDomainOrder(value: unknown): DomainOrder {
  const order = value as DomainOrder;
  if (!order || typeof order.id !== 'string' || !/^[0-9a-f-]{36}$/.test(order.id) || typeof order.domainName !== 'string'
    || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:com|net|org|app|dev|xyz)$/.test(order.domainName)
    || !states.includes(order.status) || !['registration', 'renewal'].includes(order.kind) || !Number.isInteger(order.years)
    || !Number.isSafeInteger(order.amountCents) || order.amountCents <= 0 || !Number.isSafeInteger(order.renewalCents) || order.renewalCents <= 0
    || typeof order.autoRenew !== 'boolean' || typeof order.premium !== 'boolean' || !Number.isFinite(order.expiresAt)
    || order.projectId !== null && typeof order.projectId !== 'string' || order.error !== null && typeof order.error !== 'string') throw new Error('invalid_response');
  return order;
}
export const domainMoney = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export function createDomainClient({ fetcher = fetch, signal, onUnauthenticated }: { fetcher?: typeof fetch; signal?: AbortSignal; onUnauthenticated?: () => void } = {}) {
  async function request(path: string, method = 'GET', body?: object, query?: Record<string, string>) {
    const url = new URL(`${API_ORIGIN}/domains${path}`);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    const response = await fetcher(url, { method, credentials: 'include', redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
      headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const value = await response.json().catch(() => null);
    if (response.status === 401) onUnauthenticated?.();
    if (!response.ok || !value) throw new Error(typeof value?.error === 'string' ? value.error : 'request_failed');
    return value;
  }
  return { request,
    async order(id: string) { return parseDomainOrder((await request('/order', 'GET', undefined, { id })).order); },
    async quote(body: { domainName: string; years: number; projectId?: string; kind: 'registration' | 'renewal' }) { return parseDomainOrder((await request('/quote', 'POST', body)).order); },
  };
}
