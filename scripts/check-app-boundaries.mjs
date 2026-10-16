import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// Transitional platform seams while backend remains the API composition host.
// Product code may use these shared facilities, never another product's logic.
const platformModules = new Set([
  'apps/backend/worker/app/auth-core',
  'apps/backend/worker/app/openapi-shared',
  'apps/backend/worker/lib/prepaid-billing',
  'apps/backend/worker/lib/inference-pricing',
  'apps/backend/worker/lib/deployment-environment',
  'apps/backend/containers/private-services-contract.js',
]);
const hostExports = {
  backend: new Set(['routes', 'billing', 'call', 'openapi']),
  web: new Set(['web', 'landing']),
};

export function importViolation(file, specifier) {
  const target = specifier.startsWith('.')
    ? relative(root, resolve(root, dirname(file), specifier)).replaceAll('\\', '/')
    : specifier;
  if (file.startsWith('apps/voice/')) {
    const area = file.startsWith('apps/voice/web/') ? 'web' : 'worker';
    if (target.startsWith('apps/voice/')) {
      if (!target.startsWith(`apps/voice/${area}/`)) return 'Voice browser and worker modules must stay separate';
    } else if (target.startsWith('apps/')) {
      if (area === 'web' || !platformModules.has(target.replace(/\.ts$/, ''))) return 'Voice may only import the listed shared platform modules';
    } else if (specifier.startsWith('@canopy/')) {
      return 'Voice must not depend on another product or its host';
    }
  } else {
    if (target.startsWith('apps/voice/')) return 'Hosts must use Voice package exports';
    if (specifier === '@canopy/voice' || specifier.startsWith('@canopy/voice/')) {
      const host = file.split('/')[1];
      if (!hostExports[host]?.has(specifier.slice('@canopy/voice/'.length))) return 'Use the Voice export for this host';
    }
  }
  return null;
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

export function checkAppBoundaries() {
  const failures = [];
  for (const directory of ['apps/voice/worker', 'apps/voice/web', 'apps/backend/worker', 'apps/web/src']) {
    for (const path of sourceFiles(join(root, directory))) {
      const file = relative(root, path).replaceAll('\\', '/');
      // Integration fixtures deliberately exercise the real shared host.
      if (file.endsWith('.test.ts') || file.endsWith('-test-helpers.ts') || file.includes('/fixtures/')) continue;
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])([^'"]+)\1/g)) {
        const violation = importViolation(file, match[2]);
        if (violation) failures.push(`${file}: ${match[2]}: ${violation}`);
      }
    }
  }
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const failures = checkAppBoundaries();
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else console.log('Voice product and host import boundaries verified.');
}
