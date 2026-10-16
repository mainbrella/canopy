import { API_ORIGIN } from './auth.ts';
import { initializeAccountPage } from './account-page.ts';
import { createBuildDashboard } from '@canopy/vibe/web';

const build = createBuildDashboard({ apiOrigin: API_ORIGIN, onUnauthenticated() {
  window.location.replace(`/login/?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
} });

initializeAccountPage({
  load: user => { void build.load(user.id); },
  dispose: () => build.dispose(),
});
