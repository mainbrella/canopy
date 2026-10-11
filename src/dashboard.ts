import { dashboardView } from './dashboard-view.ts';
import type { ContainerData } from './types.ts';
import { readPrepaidBalance } from './prepaid-billing.ts';
import { createOverviewFeed } from './overview-feed.ts';
import { createImagesDashboard } from './images-dashboard.ts';
import { createContainersDashboard } from './containers-dashboard.ts';
import { initializeAccountPage } from './account-page.ts';
import { legacyBuildURL } from './build-route.ts';

const buildURL = legacyBuildURL(location.search, location.hash);
if (buildURL) window.location.replace(buildURL);
else initializeDashboard();

function initializeDashboard() {
  const main = document.querySelector<HTMLElement>('#main')!;
  let lastContainerBilling: ContainerData['billing'] = null;
  const view = dashboardView(location.search);
  main.setAttribute('data-view', view);
  document.querySelector<HTMLElement>('#dashboard-title')!.textContent = view === 'overview' ? 'Overview' : view === 'production' ? 'Production' : 'Ad Hoc';
  document.querySelector<HTMLElement>('#dashboard-overview')!.hidden = view !== 'overview';
  for (const link of document.querySelectorAll<HTMLAnchorElement>('.app-navigation a')) {
    if (new URL(link.href).pathname !== '/dashboard/') continue;
    if (dashboardView(new URL(link.href).search) === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.querySelector<HTMLElement>('#dashboard-resources')!.hidden = view === 'overview';
  const overview = view === 'overview' ? createOverviewFeed({ onUnauthenticated: goToLogin,
    onBalance(balance) { account.updateBalance(balance); },
  }) : null;
  const containers = view !== 'overview' ? createContainersDashboard({ onUnauthenticated: goToLogin,
    lifecycle: view === 'production' ? 'production' : 'ad_hoc',
    onData(data) {
      if (account.user && data.billing !== lastContainerBilling && typeof data.billing?.balanceCents === 'number') {
        try {
          const balance = readPrepaidBalance(data.billing);
          lastContainerBilling = data.billing;
          account.updateBalance(balance);
        } catch { /* Keep the last verified funding status if the container response is incomplete. */ }
      }
    },
  }) : null;
  const images = containers ? createImagesDashboard({ onUnauthenticated: goToLogin,
    onImagesChanged: containers.setImages, onSelectImage: containers.selectImage }) : null;

  function goToLogin() {
    window.location.replace(`/login/?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
  }

  const account = initializeAccountPage({
    load() { overview?.load(); containers?.load(); images?.load(); },
    dispose() { overview?.dispose(); containers?.dispose(); images?.dispose(); },
  });
}
