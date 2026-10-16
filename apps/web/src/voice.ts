import { initializeVoice } from '@canopy/voice/web';
import { API_ORIGIN, createAuthClient } from './auth.ts';

initializeVoice({ apiOrigin: API_ORIGIN, readSession: () => createAuthClient().readSession() });
