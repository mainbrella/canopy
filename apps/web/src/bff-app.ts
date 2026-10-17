import { initializeBff } from '@canopy/bff/web';
import { createAuthClient } from './auth.ts';
import { API_ORIGIN } from './api-origin.ts';

initializeBff({ readSession: () => createAuthClient().readSession(), apiOrigin: API_ORIGIN });
