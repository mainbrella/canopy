import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAppBoundaries, importViolation } from './check-app-boundaries.mjs';

test('Voice uses shared platform facilities without importing Builder or the web shell', () => {
  const worker = 'apps/voice/worker/lib/voice-billing.ts';
  assert.equal(importViolation(worker, '../../../backend/worker/lib/inference-pricing'), null);
  assert.equal(importViolation(worker, '../../../backend/worker/lib/prepaid-billing'), null);
  assert.ok(importViolation(worker, '../../../backend/worker/lib/build-pricing'));
  assert.ok(importViolation(worker, '@canopy/vibe/billing'));
  assert.ok(importViolation('apps/voice/web/voice.ts', '../../web/src/auth.ts'));
  assert.ok(importViolation('apps/voice/web/voice.ts', '../worker/lib/voice'));
});

test('hosts use the correct product entry points without importing internals', () => {
  assert.equal(importViolation('apps/backend/worker/app/router.ts', '@canopy/voice/routes'), null);
  assert.equal(importViolation('apps/web/src/voice.ts', '@canopy/voice/web'), null);
  assert.ok(importViolation('apps/web/src/voice.ts', '@canopy/voice/call'));
  assert.ok(importViolation('apps/backend/worker/app/router.ts', '../../../voice/worker/app/voice'));
});

test('current production sources respect the product boundary', () => {
  assert.deepEqual(checkAppBoundaries(), []);
});

test('Vibe uses explicit platform and compute seams without reaching into sibling products', () => {
  const worker = 'apps/vibe/worker/lib/build-agent.ts';
  for (const module of ['container-service', 'prepaid-billing', 'r2-storage', 'inference-pricing']) {
    assert.equal(importViolation(worker, `../../../backend/worker/lib/${module}`), null);
  }
  assert.equal(importViolation(worker, '../../../backend/worker/shared/github-git'), null);
  assert.ok(importViolation(worker, '../../../backend/worker/lib/github-import'));
  assert.ok(importViolation(worker, '../../../voice/worker/lib/voice'));
  assert.ok(importViolation(worker, '@canopy/voice/routes'));
  assert.ok(importViolation('apps/vibe/web/build-api.ts', '../../web/src/api-origin.ts'));
  assert.ok(importViolation('apps/vibe/web/build-api.ts', '../worker/lib/build-contract'));
  assert.ok(importViolation(worker, '../../web/build-api'));
});

test('hosts compose Vibe public exports and keep the Workflow runtime separate', () => {
  assert.equal(importViolation('apps/backend/worker/app/router.ts', '@canopy/vibe/routes'), null);
  assert.equal(importViolation('apps/backend/worker/index.ts', '@canopy/vibe/workflow'), null);
  assert.equal(importViolation('apps/web/src/builder.ts', '@canopy/vibe/web'), null);
  assert.equal(importViolation('apps/web/src/project-code.ts', '@canopy/vibe/code'), null);
  assert.ok(importViolation('apps/web/src/builder.ts', '@canopy/vibe/workflow'));
  assert.ok(importViolation('apps/backend/worker/index.ts', '@canopy/vibe/web'));
  assert.ok(importViolation('apps/backend/worker/app/router.ts', '../../../vibe/worker/app/build'));
  assert.ok(importViolation('apps/web/src/builder.ts', '../../vibe/web/build-dashboard.ts'));
});
