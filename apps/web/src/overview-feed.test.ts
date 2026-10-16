import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { overviewActivities, formatActivityCost } from './overview-feed-data.ts';
import type { BalanceHistory, BalanceResource } from './balance-history-data.ts';

registerHooks({ resolve(specifier, context, next) {
  if (specifier === './auth.ts') return { url: 'data:text/javascript,export const API_ORIGIN="https://api.test";', shortCircuit: true };
  return next(specifier, context);
} });

const now = Date.UTC(2026, 9, 11, 12);
const resource = (extra: Partial<BalanceResource> = {}): BalanceResource => ({
  id: 'allocation', containerId: 'worker', name: 'API worker', lifecycle: 'production', size: 'small',
  startAt: now - 3600000, endAt: null, runtimeMs: 3600000, computeUnitHours: 6,
  usedCents: 12, reservedCents: 1, hourlyCents: 12, active: true, ...extra,
});
const history = (extra: Partial<BalanceHistory> = {}): BalanceHistory => ({
  asOf: now, balance: { balanceCents: 980, availableBalanceCents: 979, reservedBalanceCents: 1, currency: 'usd',
    spendLimitCents: 500, monthlyUsageCents: 20, productionHourlyCents: 12, fundedRuntimeMs: 86400000,
    minimumProductionRuntimeMs: 86400000, autoRecharge: { enabled: false, amountCents: 500, monthlyLimitCents: 500, spentCents: 0, status: 'disabled' } },
  totals: { fundedCents: 1000, revokedCents: 0, usedCents: 20, unattributedUsedCents: 0 },
  currentHourlyCents: 12, activeResources: [resource()], resources: [], fundings: [],
  nextResourceCursor: null, nextFundingCursor: null, historyTruncated: false, retainedResourceLimit: 256,
  ...extra,
});

test('cost formatting keeps small charges visible and normal amounts readable', () => {
  assert.equal(formatActivityCost(0), '$0.00');
  assert.equal(formatActivityCost(12), '$0.12');
  assert.equal(formatActivityCost(123456), '$1,234.56');
  assert.equal(formatActivityCost(0.5), '$0.005');
  assert.equal(formatActivityCost(0.0001), '<$0.0001');
  assert.equal(formatActivityCost(-0.0001), '−<$0.0001');
});

test('allocated workloads distinguish current rates from past consumption and expired leases', () => {
  const pending = resource({ id: 'pending', active: false, name: null });
  const completed = resource({ id: 'completed', active: false, endAt: now - 1000, lifecycle: 'ad_hoc', usedCents: 0.5 });
  const groups = overviewActivities(history({ activeResources: [pending, resource()], resources: [resource(), completed] }));
  assert.equal(groups.running[0].amount, '$0.12');
  assert.equal(groups.running[0].amountLabel, 'per hour');
  assert.equal(groups.running[0].secondaryAmount, '$0.12 used so far');
  assert.equal(groups.running[0].href, '/dashboard/?view=production');
  assert.equal(groups.running[1].title, 'worker');
  assert.equal(groups.running[1].amountLabel, 'used');
  assert.equal(groups.running[1].state, 'Awaiting confirmed stop');
  assert.equal(groups.running[1].href, undefined);
  assert.equal(groups.recent.length, 1);
  assert.equal(groups.recent[0].amount, '$0.005');
  assert.equal(groups.recent[0].kind, 'ad_hoc');
});

test('completed work and funding sort by real event dates, with reversals kept on their original purchase', () => {
  const groups = overviewActivities(history({ resources: [resource({ id: 'done', active: false, endAt: now - 1000 })],
    fundings: [{ id: 'topup', createdAt: now - 500, amountCents: 1000, revokedCents: 500, reason: 'refund' }] }));
  assert.deepEqual(groups.recent.map(row => row.id), ['funding:topup', 'done']);
  assert.equal(groups.recent[0].amount, '+$10.00');
  assert.match(groups.recent[0].detail, /\$5.00 refunded/);
  assert.equal(groups.recent[0].timestamp, now - 500);
});

test('AI, storage and earlier usage have explicit reporting periods without invented timestamps', () => {
  const data = history({ totals: { fundedCents: 1000, revokedCents: 0, usedCents: 20, unattributedUsedCents: 1, inferenceUsedCents: 3, storageUsedCents: 4 },
    storage: { month: '2026-10', maxBytes: 1000000000,
      pricing: { mode: 'meter', markupBps: 2000, chargeFrom: null, retentionDays: 7, storageUsdPerGbMonth: 0.015, classAUsdPerMillion: 4.5, classBUsdPerMillion: 0.36 },
      projects: [{ appId: 'app/a?b', name: 'Example app', storedBytes: 1000000, sourceAssetsBytes: 800000, historyBytes: 200000,
        chargedCents: -1, estimatedMonthlyCents: 3, cloudflareCents: 0, markupCents: 0, adjustmentCents: -1,
        reads: 0, writes: 1, fundedThrough: null, writesBlocked: false }] } });
  const rows = overviewActivities(data).summaries;
  assert.deepEqual(rows.map(row => row.kind), ['storage', 'ai', 'history']);
  assert.equal(rows[0].state, 'Metering only');
  assert.equal(rows[0].amountLabel, 'credited this month');
  assert.match(rows[0].detail, /1 MB · October 2026/);
  assert.equal(rows[0].href, '/build/?app=app%2Fa%3Fb');
  assert.match(rows[1].detail, /All time/);
  assert.equal(rows.some(row => row.timestamp !== undefined), false);
});

class Element {
  hidden = false; disabled = false; textContent = ''; className = ''; href = ''; innerHTML = ''; dateTime = ''; title = '';
  dataset: Record<string, string> = {};
  children: Element[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, () => void>();
  classList = { add: (value: string) => { this.className += ` ${value}`; } };
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren(...children: Element[]) { this.children = children; }
  addEventListener(type: string, handler: () => void) { this.listeners.set(type, handler); }
  click() { if (!this.disabled) this.listeners.get('click')?.(); }
}
const contents = (node: Element): string => [node.textContent, ...node.children.map(contents)].join(' ');
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };

async function fixture(t: TestContext) {
  let feed: ReturnType<typeof import('./overview-feed.ts').createOverviewFeed> | undefined;
  t.after(() => feed?.dispose());
  const nodes = new Map<string, Element>();
  const node = (id: string) => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id)!; };
  let respond: () => Response | Promise<Response> = () => Response.json(history());
  const calls: RequestInit[] = [];
  const balances: number[] = [];
  let redirects = 0;
  for (const [key, value] of Object.entries({
    document: { querySelector: node, createElement: () => new Element(), visibilityState: 'visible' },
    fetch: async (_url: string, options: RequestInit) => { calls.push(options); return respond(); },
  })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => { if (original) Object.defineProperty(globalThis, key, original); else Reflect.deleteProperty(globalThis, key); });
  }
  const { createOverviewFeed } = await import('./overview-feed.ts');
  feed = createOverviewFeed({ onUnauthenticated: () => { redirects++; }, onBalance: balance => balances.push(balance.balanceCents) });
  return { feed, node, calls, balances, redirects: () => redirects, respond(handler: typeof respond) { respond = handler; } };
}

test('feed loads exact costs, hides empty sections and preserves its snapshot on refresh failure', async t => {
  const f = await fixture(t);
  await f.feed.load();
  assert.equal(f.calls[0].credentials, 'include');
  assert.equal(f.calls[0].cache, 'no-store');
  assert.equal(f.node('#overview-hourly').textContent, '$0.12');
  assert.equal(f.node('#overview-monthly').textContent, '$0.20');
  assert.match(contents(f.node('#overview-running')), /API worker.*\$0.12.*per hour/);
  assert.equal(f.node('#overview-recent-empty').hidden, false);
  assert.equal(f.node('#overview-summaries-section').hidden, true);
  assert.deepEqual(f.balances, [980]);
  f.respond(() => Response.json({}, { status: 503 }));
  await f.feed.load();
  assert.equal(f.node('#overview-feed').hidden, false);
  assert.match(f.node('#overview-error').textContent, /last loaded costs/);
  assert.equal(f.node('#overview-retry').hidden, false);
  f.respond(() => Response.json(history({ activeResources: [], currentHourlyCents: 0 })));
  f.node('#overview-retry').click(); await flush();
  assert.equal(f.node('#overview-running').children.length, 0);
  assert.equal(f.node('#overview-running-empty').hidden, false);
  assert.equal(f.node('#overview-hourly').textContent, '$0.00');
  assert.equal(f.node('#overview-error').hidden, true);
});

test('invalid history is unavailable rather than a fabricated zero', async t => {
  const f = await fixture(t);
  f.node('#overview-feed').hidden = true;
  f.respond(() => Response.json({ ...history(), currentHourlyCents: -1 }));
  await f.feed.load();
  assert.equal(f.node('#overview-feed').hidden, true);
  assert.equal(f.node('#overview-error').hidden, false);
  assert.equal(f.balances.length, 0);
});

test('recent activity stays bounded while all current allocations remain visible', async t => {
  const f = await fixture(t);
  const resources = Array.from({ length: 20 }, (_, index) => resource({
    id: `completed-${index}`, active: false, endAt: now - index * 1000,
  }));
  f.respond(() => Response.json(history({ resources })));
  await f.feed.load();
  assert.equal(f.node('#overview-recent').children.length, 10);
  assert.equal(f.node('#overview-running').children.length, 1);
  assert.equal(f.node('#overview-history-note').hidden, false);
});

test('sign-out aborts a pending request and suppresses late account data', async t => {
  const f = await fixture(t);
  let release!: (value: Response) => void;
  f.respond(() => new Promise(resolve => { release = resolve; }));
  const pending = f.feed.load();
  f.feed.dispose();
  assert.equal(f.calls[0].signal?.aborted, true);
  release(Response.json(history())); await pending;
  assert.equal(f.node('#overview-running').children.length, 0);
  assert.equal(f.node('#overview-feed').hidden, true);
  assert.equal(f.balances.length, 0);
});

test('an expired session clears the feed and redirects to sign-in', async t => {
  const f = await fixture(t);
  await f.feed.load();
  f.respond(() => Response.json({}, { status: 401 }));
  await f.feed.load();
  assert.equal(f.redirects(), 1);
  assert.equal(f.node('#overview-running').children.length, 0);
  assert.equal(f.node('#overview-feed').hidden, true);
});
