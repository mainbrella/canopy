import { initializeBff } from '@canopy/bff/web';
import { createAuthClient } from './auth.ts';

initializeBff({ readSession: () => createAuthClient().readSession() });
