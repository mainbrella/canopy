import { formatRuntime, type BalanceHistory, type BalanceResource } from './balance-history-data.ts';
import { formatStorageBytes } from './storage-billing-data.ts';

export type ActivityKind = 'production' | 'ad_hoc' | 'storage' | 'ai' | 'funding' | 'history';
export interface OverviewActivity {
  id: string;
  kind: ActivityKind;
  title: string;
  detail: string;
  amount: string;
  amountLabel: string;
  secondaryAmount?: string;
  timestamp?: number;
  state?: string;
  href?: string;
  credit?: boolean;
}

// Keep meaningful fractional charges visible without making normal dollar amounts noisy.
export function formatActivityCost(cents: number): string {
  if (cents !== 0 && Math.abs(cents) < 0.01) return `${cents < 0 ? '−' : ''}<$0.0001`;
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2,
    maximumFractionDigits: Math.abs(cents) > 0 && Math.abs(cents) < 1 ? 4 : 2,
  });
}

function computeActivity(resource: BalanceResource): OverviewActivity {
  const pending = !resource.active && resource.endAt === null;
  const size = resource.size.charAt(0).toUpperCase() + resource.size.slice(1);
  const type = resource.lifecycle === 'production' ? 'Production container' : 'Ad hoc container';
  return {
    id: resource.id, kind: resource.lifecycle, title: resource.name || resource.containerId,
    detail: `${type} · ${size} · ${formatRuntime(resource.runtimeMs)} runtime`,
    amount: formatActivityCost(resource.active ? resource.hourlyCents : resource.usedCents),
    amountLabel: resource.active ? 'per hour' : 'used',
    secondaryAmount: resource.active ? `${formatActivityCost(resource.usedCents)} used so far` : undefined,
    timestamp: resource.endAt ?? resource.startAt,
    state: resource.active ? 'Consuming balance' : pending ? 'Awaiting confirmed stop' : 'Completed',
    href: resource.active ? `/dashboard/?view=${resource.lifecycle === 'production' ? 'production' : 'ad-hoc'}` : undefined,
  };
}

export function overviewActivities(data: BalanceHistory) {
  const running = [...data.activeResources].sort((a, b) => Number(b.active) - Number(a.active) || b.startAt - a.startAt).map(computeActivity);
  const currentIds = new Set(data.activeResources.map(resource => resource.id));
  const recent: OverviewActivity[] = data.resources.filter(resource => !currentIds.has(resource.id)).map(computeActivity);
  for (const funding of data.fundings) {
    const reversal = funding.revokedCents > 0
      ? ` · ${formatActivityCost(funding.revokedCents)} ${funding.reason === 'dispute' ? 'removed after a dispute' : 'refunded'}` : '';
    recent.push({
      id: `funding:${funding.id}`, kind: 'funding', title: 'Balance added',
      detail: `Prepaid credit${reversal}`, amount: `+${formatActivityCost(funding.amountCents)}`,
      amountLabel: 'added', timestamp: funding.createdAt, credit: true,
    });
  }
  recent.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0) || a.id.localeCompare(b.id));

  const summaries: OverviewActivity[] = [];
  const storage = data.storage;
  if (storage && storage.pricing.mode !== 'off') {
    const charging = storage.pricing.mode === 'charge' && (storage.pricing.chargeFrom === null || storage.pricing.chargeFrom <= data.asOf);
    const month = new Date(`${storage.month}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    for (const project of storage.projects) {
      if (!project.storedBytes && !project.chargedCents && !project.estimatedMonthlyCents) continue;
      summaries.push({
        id: `storage:${project.appId}`, kind: 'storage', title: project.name || 'Untitled app',
        detail: `Storage & Git · ${formatStorageBytes(project.storedBytes)} · ${month}`,
        amount: formatActivityCost(project.chargedCents), amountLabel: project.chargedCents < 0 ? 'credited this month' : 'charged this month',
        secondaryAmount: `${formatActivityCost(project.estimatedMonthlyCents)}/month estimated storage`,
        state: project.writesBlocked ? 'Read-only' : charging ? undefined : 'Metering only',
        href: `/build/?app=${encodeURIComponent(project.appId)}`,
      });
    }
  }
  if (data.totals.inferenceUsedCents) summaries.push({
    id: 'ai', kind: 'ai', title: 'Build AI', detail: 'AI usage across your apps · All time',
    amount: formatActivityCost(data.totals.inferenceUsedCents), amountLabel: 'used', href: '/build/',
  });
  if (data.totals.storageUsedCents && !summaries.some(row => row.kind === 'storage')) summaries.push({
    id: 'storage-total', kind: 'storage', title: 'Storage & Git', detail: 'Saved app files and history · All time',
    amount: formatActivityCost(data.totals.storageUsedCents), amountLabel: 'used', href: '/balance/',
  });
  if (data.totals.unattributedUsedCents) summaries.push({
    id: 'earlier', kind: 'history', title: 'Earlier compute usage', detail: 'All time · Individual workload details are no longer available',
    amount: formatActivityCost(data.totals.unattributedUsedCents), amountLabel: 'used', href: '/balance/',
  });
  return { running, recent, summaries };
}
