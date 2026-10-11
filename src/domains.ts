import { createDomainClient, domainMessages, domainMoney, parseDomainOrder, type DomainOrder, type RegisteredDomain } from './domain-registrar.ts';
import { mountStripeEmbeddedCheckout } from './payments/stripeEmbeddedCheckout.ts';

const dialog = document.querySelector<HTMLDialogElement>('#domain-dialog')!;
const node = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(`domain-${id}`) as T;
let abort = new AbortController(), version = 0, busy = false, processing = false;
let client = createDomainClient(), projectId: string | undefined, order: DomainOrder | null = null;
let payment: ReturnType<typeof mountStripeEmbeddedCheckout> | null = null, timer: ReturnType<typeof setTimeout> | undefined;
let selectedName = '', selectedKind: 'registration' | 'renewal' = 'registration', detailName = '';
let progressVersion = 0;
const feedback = (message = '', error = false) => { node('status').textContent = message; node('status').className = error ? 'dashboard-error' : 'dashboard-status'; };
function button(label: string, action: () => void | Promise<void>) {
  const element = document.createElement('button'); element.type = 'button'; element.className = 'dashboard-retry';
  element.textContent = label; element.addEventListener('click', () => { if (!busy) void action(); }); return element;
}
function lock() {
  node<HTMLButtonElement>('close').disabled = processing;
  node<HTMLButtonElement>('checkout-back').disabled = processing;
  node<HTMLButtonElement>('search-submit').disabled = busy;
  node<HTMLButtonElement>('continue').disabled = busy || !order;
  node<HTMLSelectElement>('years').disabled = busy;
  dialog.setAttribute('aria-busy', String(busy));
}
async function run(action: () => Promise<void>) {
  const at = version; if (busy) return;
  busy = true; lock(); feedback();
  try { await action(); }
  catch (error) { if (at === version) feedback(domainMessages[(error as Error).message] ?? 'Could not complete this request. Try again.', true); }
  finally { if (at === version) { busy = false; lock(); } }
}
function view(name: string) { for (const id of ['browse', 'review', 'checkout', 'progress', 'detail']) node(id).hidden = id !== name; }
function cleanupPayment() { payment?.(); payment = null; node('payment').replaceChildren(); node('billing-address').replaceChildren(); }
async function list() {
  const at = version, value = await client.request(''); if (at !== version) return;
  node('owned').replaceChildren();
  if (!Array.isArray(value.domains) || !Array.isArray(value.orders)) throw new Error('invalid_response');
  for (const domain of value.domains as RegisteredDomain[]) {
    const row = document.createElement('div'); row.className = 'domain-row';
    const text = document.createElement('div'), name = document.createElement('strong'), meta = document.createElement('p');
    name.textContent = domain.domainName; meta.className = 'dashboard-status';
    meta.textContent = `Expires ${new Date(domain.expireDate).toLocaleDateString()} · Auto-renew ${domain.autoRenew ? 'on' : 'off'} · ${domainMoney(domain.renewalCents)}/year`;
    text.append(name, meta);
    if (domain.error) { const warning = document.createElement('p'); warning.className = 'dashboard-error'; warning.textContent = domainMessages[domain.error] ?? 'This domain needs attention. Open its settings.'; text.append(warning); }
    row.append(text, button('Manage', () => run(() => detail(domain.domainName)))); node('owned').append(row);
  }
  for (const pending of value.orders) {
    const parsed = parseDomainOrder(pending), row = document.createElement('div'); row.className = 'domain-row';
    const name = document.createElement('span'); name.textContent = `${parsed.domainName} · ${parsed.status === 'checkout' ? 'Checkout pending' : 'Order pending'}`;
    row.append(name, button('Continue', () => run(async () => { order = parsed; if (parsed.status === 'checkout') await pay(); else await progress(); })));
    node('owned').append(row);
  }
  node('empty').hidden = value.domains.length + value.orders.length > 0;
}
async function choose(name: string, kind: 'registration' | 'renewal' = 'registration') {
  selectedName = name; selectedKind = kind;
  node<HTMLSelectElement>('years').value = '1';
  await refreshQuote();
  node('contact-fields').hidden = kind === 'renewal';
  node<HTMLFieldSetElement>('contact-fields').disabled = kind === 'renewal';
  node<HTMLInputElement>('auto-renew').checked = true;
  node<HTMLInputElement>('terms').checked = false;
  view('review'); node('review-name').focus();
}
async function refreshQuote() {
  order = null;
  const at = version;
  const quoted = await client.quote({ domainName: selectedName, kind: selectedKind, years: Number(node<HTMLSelectElement>('years').value),
    ...(selectedKind === 'registration' && projectId ? { projectId } : {}) });
  if (at !== version) return;
  order = quoted; node('review-name').textContent = quoted.domainName;
  node('price').textContent = `${domainMoney(quoted.amountCents)} for ${quoted.years} ${quoted.years === 1 ? 'year' : 'years'}${quoted.premium ? ' · Premium domain' : ''}`;
  node('renewal').textContent = `Renews at ${domainMoney(quoted.renewalCents)}/year. Auto-renew charges your saved card 30 days before expiry. A higher price requires your approval.`;
}
async function pay() {
  if (!order) return;
  const at = version;
  const contact: Record<string, string> = {};
  node('contact-fields').querySelectorAll<HTMLInputElement>('input[data-contact]').forEach(input => { contact[input.dataset.contact!] = input.value.trim(); });
  const value = await client.request('/checkout', 'POST', { orderId: order.id, autoRenew: node<HTMLInputElement>('auto-renew').checked, termsAccepted: true,
    ...(order.kind === 'registration' && order.status === 'quoted' ? { contact } : {}) });
  if (at !== version) return;
  order = parseDomainOrder(value.order);
  if (order.status !== 'checkout') { await progress(); return; }
  if (typeof value.clientSecret !== 'string' || !/^pk_(test|live)_/.test(value.publishableKey)) throw new Error('invalid_response');
  cleanupPayment(); view('checkout');
  node('checkout-name').textContent = order.domainName;
  node<HTMLInputElement>('receipt-email').value = contact.email ?? '';
  node('total').textContent = `Due today: ${domainMoney(order.amountCents)}`;
  payment = mountStripeEmbeddedCheckout({ container: node('payment'), billingAddressContainer: node('billing-address'),
    form: node<HTMLFormElement>('payment-form'), submitButton: node<HTMLButtonElement>('pay'), statusElement: node('payment-status'),
    clientSecret: value.clientSecret, publishableKey: value.publishableKey, submitLabel: 'Pay and register', emailInput: node<HTMLInputElement>('receipt-email'), totalElement: node('total'),
    onProcessing(value) { if (at === version) { processing = value; lock(); } },
    async onComplete() { if (at === version) await progress(); },
    onError(message) { if (at === version) feedback(message, true); },
  });
}
const progressLabels: Record<string, string> = { checkout: 'Waiting for payment confirmation…', charging: 'Confirming renewal payment…', paid: 'Payment confirmed. Registering domain…',
  fulfilling: 'Registering domain…', registered: 'Domain registered.', connecting: 'Domain registered. Configuring DNS and HTTPS…',
  complete: 'Your domain is ready.', refunding: 'Registration could not complete. Refunding your payment…', refunded: 'Registration could not complete. Your payment has been refunded.',
  review: 'Your order needs support review. Contact support with the order ID below.', expired: 'Checkout expired. Search again to purchase this domain.' };
async function progress() {
  if (!order) return;
  const at = version, progressAt = progressVersion;
  const updated = await client.order(order.id); if (at !== version || progressAt !== progressVersion) return;
  order = updated; view('progress'); node('progress-name').textContent = updated.domainName;
  node('progress-state').textContent = progressLabels[updated.status] ?? 'Checking your order…';
  node('order-id').textContent = `Order ${updated.id}`;
  node('verification-note').hidden = !['registered','connecting','complete'].includes(updated.status) || updated.kind === 'renewal';
  node<HTMLAnchorElement>('visit').hidden = updated.status !== 'complete' || !updated.projectId;
  node<HTMLAnchorElement>('visit').href = `https://${updated.domainName}/`;
  if (updated.error && !['domain_connection_pending'].includes(updated.error)) feedback(domainMessages[updated.error] ?? 'Setup is delayed. Your order is saved; check again shortly.', true);
  if (!['complete','refunded','review','expired'].includes(updated.status)) timer = setTimeout(() => { void progress().catch(() => feedback('Could not refresh your order. Use Check status to retry.', true)); }, 5000);
}
async function detail(name: string) {
  const at = version, data = await client.request('/detail', 'GET', undefined, { domainName: name }); if (at !== version) return;
  detailName = name; view('detail'); node('detail-name').textContent = name;
  const domain = data.domain;
  node('detail-expiry').textContent = `Expires ${new Date(domain.expireDate).toLocaleDateString()} · Renewal ${domainMoney(domain.renewalCents)}/year`;
  const select = node<HTMLSelectElement>('project'); select.replaceChildren();
  for (const project of [{ id: '', name: 'No project' }, ...(data.projects ?? [])]) {
    const option = document.createElement('option'); option.value = project.id; option.textContent = project.name; select.append(option);
  }
  select.value = data.projectId ?? '';
  node<HTMLInputElement>('detail-renew').checked = domain.autoRenew;
  node<HTMLInputElement>('privacy').checked = domain.privacyEnabled;
  node<HTMLInputElement>('locked').checked = domain.locked;
  node('verify-status').textContent = domain.contacts?.registrant?.isVerified ? 'Registrant email verified.' : 'Check your email to verify the registrant address. Verification may take up to 10 minutes to appear; unverified domains can be suspended after 15 days.';
  node<HTMLButtonElement>('resend').hidden = domain.contacts?.registrant?.isVerified === true;
  node('nameservers').textContent = (domain.nameservers ?? []).join(', ');
  node('transfer-code').textContent = '';
  node('dns-list').replaceChildren();
  for (const record of data.records ?? []) {
    const row = document.createElement('tr');
    for (const text of [record.type, record.host || '@', record.answer]) { const cell = document.createElement('td'); cell.textContent = text; row.append(cell); }
    const cell = document.createElement('td');
    cell.append(button('Remove', () => run(async () => { if (!confirm(`Remove this ${record.type} record for ${record.host || '@'}?`)) return;
      await client.request('/records', 'DELETE', undefined, { domainName: name, recordId: String(record.id) }); await detail(name); })));
    row.append(cell); node('dns-list').append(row);
  }
  const fields = node('edit-contact').querySelectorAll<HTMLInputElement>('input[data-contact]');
  fields.forEach(input => { input.value = domain.contacts?.registrant?.[input.dataset.contact!] ?? ''; });
}
async function open(id?: string, resume?: string) {
  version++; abort.abort(); abort = new AbortController(); clearTimeout(timer); cleanupPayment();
  projectId = id; order = null; processing = false; busy = false;
  client = createDomainClient({ signal: abort.signal, onUnauthenticated: () => location.assign(`/login/?returnTo=${encodeURIComponent(location.pathname + location.search)}`) });
  feedback(); lock(); view('browse'); dialog.showModal();
  await run(async () => {
    const at = version, config = await client.request('/config'); if (at !== version) return;
    node('search-form').hidden = !config.configured;
    node('unavailable').hidden = config.configured;
    node('sandbox').hidden = !config.sandbox;
    node('connection').textContent = id ? 'The domain will connect to this project automatically.' : 'Buy for your account. You can connect the domain to a project later.';
    if (!config.configured) return;
    if (id && !config.canConnect) { node('search-form').hidden = true; feedback('Automatic domain setup is unavailable for this project. You can still manage domains below.', true); }
    await list();
    if (resume) { order = await client.order(resume); if (at === version) await progress(); }
  });
}
node<HTMLFormElement>('search-form').addEventListener('submit', event => { event.preventDefault(); void run(async () => {
  const at = version, results = await client.request('/search', 'POST', { keyword: node<HTMLInputElement>('keyword').value.trim() }); if (at !== version) return;
  node('results').replaceChildren();
  for (const result of results.results ?? []) {
    const row = document.createElement('div'); row.className = 'domain-row'; const info = document.createElement('div'), name = document.createElement('strong'), price = document.createElement('p');
    name.textContent = result.domainName; price.className = 'dashboard-status'; price.textContent = `${domainMoney(result.amountCents)}/year · Renews ${domainMoney(result.renewalCents)}/year${result.premium ? ' · Premium' : ''}`;
    info.append(name, price); row.append(info, button('Select', () => run(() => choose(result.domainName)))); node('results').append(row);
  }
  if (!results.results?.length) feedback('No available domains found. Try another name.');
}); });
node<HTMLSelectElement>('years').addEventListener('change', () => { void run(refreshQuote); });
node<HTMLFormElement>('review-form').addEventListener('submit', event => { event.preventDefault(); void run(pay); });
node('close').addEventListener('click', () => { if (!processing) dialog.close(); });
dialog.addEventListener('cancel', event => { if (processing) event.preventDefault(); });
dialog.addEventListener('close', () => { version++; abort.abort(); clearTimeout(timer); cleanupPayment(); });
for (const id of ['review-back', 'detail-back', 'progress-back']) node(id).addEventListener('click', () => { if (busy) return; progressVersion++; clearTimeout(timer); cleanupPayment(); view('browse'); void run(list); });
node('checkout-back').addEventListener('click', () => { if (!processing) { cleanupPayment(); view('browse'); void run(list); } });
node('check').addEventListener('click', () => { clearTimeout(timer); void run(progress); });
node('renew-now').addEventListener('click', () => { void run(() => choose(detailName, 'renewal')); });
node<HTMLFormElement>('connect-form').addEventListener('submit', event => { event.preventDefault(); void run(async () => {
  const projectId = node<HTMLSelectElement>('project').value || null;
  if (!projectId && !confirm(`Disconnect ${detailName} from its project? The domain registration remains active.`)) return;
  const result = await client.request('/connect', 'POST', { projectId }, { domainName: detailName });
  if (result.order) { order = parseDomainOrder(result.order); await progress(); } else { await detail(detailName); feedback('Domain disconnected.'); }
}); });
node<HTMLFormElement>('settings').addEventListener('submit', event => { event.preventDefault(); void run(async () => {
  await client.request('/settings', 'PATCH', { domainName: detailName, autoRenew: node<HTMLInputElement>('detail-renew').checked,
    privacyEnabled: node<HTMLInputElement>('privacy').checked, locked: node<HTMLInputElement>('locked').checked }); feedback('Settings saved.');
}); });
node('resend').addEventListener('click', () => { void run(async () => { await client.request('/verification', 'POST', undefined, { domainName: detailName }); feedback('Verification email sent.'); }); });
node('auth-code').addEventListener('click', () => { void run(async () => { const data = await client.request('/auth-code', 'POST', undefined, { domainName: detailName }); node('transfer-code').textContent = data.authCode; }); });
node<HTMLFormElement>('dns-form').addEventListener('submit', event => { event.preventDefault(); void run(async () => {
  const type = node<HTMLSelectElement>('dns-type').value;
  await client.request('/records', 'POST', { type, host: node<HTMLInputElement>('dns-host').value.trim(), answer: node<HTMLInputElement>('dns-answer').value.trim(),
    ttl: 300, ...(['MX', 'SRV'].includes(type) ? { priority: Number(node<HTMLInputElement>('dns-priority').value) } : {}) }, { domainName: detailName });
  node<HTMLFormElement>('dns-form').reset(); await detail(detailName); feedback('DNS record added.');
}); });
node<HTMLFormElement>('edit-contact').addEventListener('submit', event => { event.preventDefault(); void run(async () => {
  const contact: Record<string, string> = {}; node('edit-contact').querySelectorAll<HTMLInputElement>('input[data-contact]').forEach(input => { contact[input.dataset.contact!] = input.value.trim(); });
  await client.request('/settings', 'PATCH', { domainName: detailName, contact }); await detail(detailName); feedback('Contact details saved. Check your email for verification.');
}); });
document.addEventListener('click', event => {
  const target = (event.target as HTMLElement).closest('[data-domain-buy]'); if (!target) return;
  const project = target.closest<HTMLDialogElement>('#endpoint-dialog')?.dataset.projectId;
  void open(project);
});
const returnedOrder = new URL(location.href).searchParams.get('domainOrder');
if (returnedOrder && /^[0-9a-f-]{36}$/.test(returnedOrder)) {
  const clean = new URL(location.href); clean.searchParams.delete('domainOrder'); history.replaceState(null, '', clean);
  void open(undefined, returnedOrder);
}
