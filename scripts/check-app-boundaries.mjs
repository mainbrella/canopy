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
const products = {
  voice: {
    name: 'Voice',
    platformModules,
    hostExports: {
      backend: new Set(['routes', 'billing', 'call', 'openapi']),
      web: new Set(['web', 'landing']),
    },
  },
  vibe: {
    name: 'Vibe',
    platformModules: new Set([
      ...[...platformModules].filter(module => module !== 'apps/backend/containers/private-services-contract.js'),
      'apps/backend/worker/shared/github-git',
      'apps/backend/worker/shared/storage-retention',
      'apps/backend/worker/lib/r2-access',
      'apps/backend/worker/lib/r2-storage',
      'apps/backend/worker/lib/r2-retention',
      // Compute seams until Linux has its own supported public interface.
      'apps/backend/worker/lib/container-service',
      'apps/backend/worker/lib/entitlements',
      'apps/backend/worker/lib/preview-routing',
      'apps/backend/worker/app/previews',
      'apps/backend/containers/command-contract.js',
      'apps/backend/containers/execution-contract.js',
      'apps/backend/containers/container-account-core.js',
      'apps/backend/containers/file-contract.js',
    ]),
    hostExports: {
      backend: new Set(['routes', 'maintenance', 'workflow', 'openapi']),
      web: new Set(['web', 'landing', 'onboarding', 'code']),
    },
  },
};

export function importViolation(file, specifier) {
  const target = specifier.startsWith('.')
    ? relative(root, resolve(root, dirname(file), specifier)).replaceAll('\\', '/')
    : specifier;
  const product = file.split('/')[1];
  const rules = products[product];
  if (rules) {
    const area = file.startsWith(`apps/${product}/web/`) ? 'web' : 'worker';
    if (target.startsWith(`apps/${product}/`)) {
      if (!target.startsWith(`apps/${product}/${area}/`)) return `${rules.name} browser and worker modules must stay separate`;
    } else if (target.startsWith('apps/')) {
      if (area === 'web' || !rules.platformModules.has(target.replace(/\.ts$/, ''))) return `${rules.name} may only import its listed platform and compute modules`;
    } else if (specifier.startsWith('@canopy/')) {
      return `${rules.name} must not depend on another product or its host`;
    }
  } else {
    for (const [name, rules] of Object.entries(products)) {
      if (target.startsWith(`apps/${name}/`)) return `Hosts must use ${rules.name} package exports`;
      if (specifier === `@canopy/${name}` || specifier.startsWith(`@canopy/${name}/`)) {
        const host = file.split('/')[1];
        if (!rules.hostExports[host]?.has(specifier.slice(`@canopy/${name}/`.length))) return `Use the ${rules.name} export for this host`;
      }
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
  for (const directory of ['apps/voice/worker', 'apps/voice/web', 'apps/vibe/worker', 'apps/vibe/web', 'apps/backend/worker', 'apps/web/src']) {
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
  } else console.log('Voice, Vibe, and host import boundaries verified.');
}
