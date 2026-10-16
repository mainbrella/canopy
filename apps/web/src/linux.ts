import { configureLinuxWeb } from '@canopy/linux/web';
import { API_ORIGIN } from './auth.ts';
import { trackMachineStart } from './acquisition-analytics.ts';
import { formatBalance } from './prepaid-billing.ts';

configureLinuxWeb({ apiOrigin: API_ORIGIN, trackMachineStart, formatBalance });
