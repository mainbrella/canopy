import { dashboardView, containerLifecycle, productionCost } from './dashboard-view.ts';
import type { ContainerData } from './types.ts';
import { formatBalance, readPrepaidBalance } from './prepaid-billing.ts';
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
  const containers = createContainersDashboard({ onUnauthenticated: goToLogin,
    lifecycle: view === 'production' ? 'production' : 'ad_hoc', overview: view === 'overview',
    onLoadError() {
      document.querySelector<HTMLElement>('#overview-error')!.textContent = 'Could not load usage and workloads. Try again.';
      document.querySelector<HTMLElement>('#overview-error')!.hidden = false;
      document.querySelector<HTMLButtonElement>('#overview-retry')!.hidden = false;
    },
    onData(data) {
      document.querySelector<HTMLElement>('#overview-error')!.hidden = true;
      document.querySelector<HTMLButtonElement>('#overview-retry')!.hidden = true;
      const production = data.containers.filter(container => containerLifecycle(container) === 'production').length;
      const adHoc = data.containers.length - production;
      document.querySelector<HTMLElement>('#overview-ad-hoc')!.textContent = `${adHoc} ${adHoc === 1 ? 'container' : 'containers'}`;
      document.querySelector<HTMLElement>('#overview-production')!.textContent = `${production} ${production === 1 ? 'container' : 'containers'} · $${productionCost(data).toFixed(2)}/hour`;
      const cap = document.querySelector<HTMLElement>('#overview-production-cap')!;
      cap.hidden = !production || !data.billing;
      cap.textContent = `Production stops when its funded runtime or your ${formatBalance(data.billing?.spendLimitCents ?? 500)} monthly spending cap runs out.`;
      if (account.user && data.billing !== lastContainerBilling && typeof data.billing?.balanceCents === 'number') {
        try {
          const balance = readPrepaidBalance(data.billing);
          lastContainerBilling = data.billing;
          account.updateBalance(balance);
        } catch { /* Keep the last verified funding status if the container response is incomplete. */ }
      }
    },
  });
  document.querySelector<HTMLButtonElement>('#overview-retry')!.addEventListener('click', () => containers.load());
  const images = createImagesDashboard({ onUnauthenticated: goToLogin,
    onImagesChanged: containers.setImages, onSelectImage: containers.selectImage });

  function goToLogin() {
    window.location.replace(`/login/?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
  }

  const account = initializeAccountPage({
    load() { containers.load(); images.load(); },
    dispose() { containers.dispose(); images.dispose(); },
  });
}
