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
  'apps/backend/worker/shared/bounded-body.js',
]);
const products = {
  bff: {
    name: 'BFF',
    platformModules: new Set(),
    hostExports: { web: new Set(['landing', 'page']) },
  },
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
      ...platformModules,
      'apps/backend/worker/shared/github-git',
      'apps/backend/worker/shared/storage-retention',
      'apps/backend/worker/lib/r2-access',
      'apps/backend/worker/lib/r2-storage',
      'apps/backend/worker/lib/r2-retention',
      'apps/backend/worker/lib/entitlements',
    ]),
    productExports: new Set(['@canopy/linux/compute', '@canopy/linux/contracts/command', '@canopy/linux/contracts/execution', '@canopy/linux/contracts/account', '@canopy/linux/contracts/file']),
    hostExports: {
      backend: new Set(['routes', 'maintenance', 'workflow', 'openapi', 'projects']),
      web: new Set(['web', 'landing', 'onboarding', 'code']),
    },
  },
  linux: {
    name: 'Linux',
    platformModules: new Set([
      ...platformModules,
      'apps/backend/worker/app/api-keys',
      'apps/backend/worker/app/openapi-prepaid-billing',
      'apps/backend/worker/lib/entitlements',
      'apps/backend/worker/lib/stripe',
      'apps/backend/worker/lib/accounting-ledger',
      'apps/backend/worker/lib/acquisition-sources',
    ]),
    hostExports: {
      backend: new Set(["routes", "openapi", "compute", "hosting", "account", "billing", "schemas", "gateway", "contracts/command", "contracts/execution", "contracts/file", "contracts/file-transfer", "contracts/code", "contracts/filesystem", "contracts/preview", "contracts/private-services", "contracts/project", "contracts/security", "contracts/webhook", "contracts/workspace", "contracts/pool", "contracts/account", "contracts/plans", "contracts/usage", "contracts/launch", "contracts/catalog"]),
      web: new Set(["web", "web/types", "web/terminal", "web/previews", "web/hosting", "web/networks", "web/view"]),
    },
  },
};

export function importViolation(file, specifier) {
  const target = specifier.startsWith('.')
    ? relative(root, resolve(root, dirname(file), specifier)).replaceAll('\\', '/')
    : specifier;
  if (file.startsWith('packages/platform/') && (target.startsWith('apps/')
    || specifier.startsWith('@canopy/') && !specifier.startsWith('@canopy/platform/'))) return 'Platform must not depend on product or host implementations';
  if (!file.startsWith('packages/platform/') && target.startsWith('packages/platform/')) return 'Use platform package exports';
  if (specifier.startsWith('@canopy/platform/')) {
    const [, owner, area] = file.split('/');
    const entry = specifier.slice('@canopy/platform/'.length);
    const allowed = area === 'worker' || owner === 'linux' && area === 'containers';
    return allowed && (entry === 'billing' || owner === 'linux' && ['wallet', 'usage', 'wallet-policy'].includes(entry))
      ? null : 'Use the supported server-side platform interface';
  }
  const product = file.split('/')[1];
  const rules = products[product];
  if (rules) {
    const area = file.split('/')[2];
    if (target.startsWith(`apps/${product}/`)) {
      if (!target.startsWith(`apps/${product}/${area}/`)
        && !(product === 'linux' && ((area === 'worker' && target.startsWith('apps/linux/containers/'))
          || (file.endsWith('.d.ts') && area === 'containers' && target.startsWith('apps/linux/worker/'))))) return `${rules.name} browser and worker modules must stay separate`;
    } else if (target.startsWith('apps/')) {
      if (area === 'web' || !rules.platformModules.has(target.replace(/\.ts$/, ''))) return `${rules.name} may only import its listed platform and compute modules`;
    } else if (specifier.startsWith('@canopy/')) {
      if (area === 'web' || !rules.productExports?.has(specifier)) return `${rules.name} must use its supported product interfaces`;
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
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|js|mjs)$/.test(path) ? [path] : [];
  });
}

export function checkAppBoundaries() {
  const failures = [];
  for (const directory of ['packages/platform', 'apps/bff/web', 'apps/voice/worker', 'apps/voice/web', 'apps/vibe/worker', 'apps/vibe/web', 'apps/linux/worker', 'apps/linux/web', 'apps/linux/containers', 'apps/linux/sdk', 'apps/backend/worker', 'apps/web/src']) {
    for (const path of sourceFiles(join(root, directory))) {
      const file = relative(root, path).replaceAll('\\', '/');
      // Integration fixtures deliberately exercise the real shared host.
      if (/\.test\.(?:ts|mjs)$/.test(file) || /-test-helpers\.(?:ts|mjs)$/.test(file) || file.includes('/fixtures/')) continue;
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
  } else console.log('BFF, Voice, Vibe, Linux, and host import boundaries verified.');
}
