import { initializeAccountPage } from './account-page.ts';
import { createBuildDashboard } from './build-dashboard.ts';

const build = createBuildDashboard({ onUnauthenticated() {
  window.location.replace(`/login/?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
} });

initializeAccountPage({
  load: user => { void build.load(user.id); },
  dispose: () => build.dispose(),
});
