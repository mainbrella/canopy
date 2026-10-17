import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ALL_TARGETS = ['site', 'builder'];
const ROOT_DOCUMENTATION = new Set(['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'LICENSE']);

function appLocalTargets(path) {
  if (path === 'src/build-route.ts' || path === 'src/build-route.test.ts') return ['site'];
  if (path.startsWith('build/') || /^src\/(?:builder|build-[^/]+)\.(?:test\.)?ts$/.test(path)
    || ['vite.builder.config.ts', 'wrangler.builder.jsonc', 'tsconfig.builder.json'].includes(path)) {
    return ['builder'];
  }
  if (path.startsWith('src/') || path.startsWith('scripts/') || path.startsWith('.github/')
    || ['package.json', 'package-lock.json', 'tsconfig.json', 'public/mainbrella.css', 'public/app.css',
      'public/images/logo.png', 'public/images/favicon.png'].includes(path)) {
    // Source, scripts, and shared build inputs can affect either output.
    return ALL_TARGETS;
  }
  if (path === 'index.html' || /^(?:bff|docs|blog|pricing|public|sdk|unsubscribe|repo-rodeo-bug)\//.test(path)
    || ['vite.config.ts', 'wrangler.jsonc', 'wrangler.redirect.jsonc', 'robots.txt', 'sitemap.xml'].includes(path)) {
    return ['site'];
  }
  // Unknown files owned by the web app need broad checks.
  return ALL_TARGETS;
}

export function affectedTargets(paths) {
  const targets = new Set();
  for (const path of paths) for (const target of appLocalTargets(path)) targets.add(target);
  return ALL_TARGETS.filter(target => targets.has(target));
}

function backendPathAffectsWeb(path) {
  return /^(?:API\.md|openapi[^/]*\.json|sdk\/|docs\/)/.test(path)
    || /^worker\/(?:app\/openapi[^/]*\.ts|shared\/[^/]*(?:contract|schema)[^/]*\.ts)$/.test(path)
    || /^worker\/app\/(?:auth|marketing-email)\.ts$/.test(path);
}

export function affectedTargetsForRepositoryPaths(paths) {
  const selected = new Set();
  for (const path of paths) {
    if (path.startsWith('apps/web/')) {
      for (const target of appLocalTargets(path.slice('apps/web/'.length))) selected.add(target);
    } else if (path === 'apps/web') {
      for (const target of ALL_TARGETS) selected.add(target);
    } else if (path.startsWith('apps/backend/')) {
      if (backendPathAffectsWeb(path.slice('apps/backend/'.length))) selected.add('site');
    } else if (path.startsWith('apps/bff/')) {
      if (path !== 'apps/bff/README.md') selected.add('site');
    } else if (path.startsWith('apps/vibe/')) {
      if (!['apps/vibe/README.md', 'apps/vibe/AGENTS.md'].includes(path)) {
        for (const target of ALL_TARGETS) selected.add(target);
      }
    } else if (path.startsWith('apps/linux/')) {
      if (!['apps/linux/README.md', 'apps/linux/AGENTS.md'].includes(path)) selected.add('site');
    } else if (path.startsWith('apps/raindrop/')) {
      continue;
    } else if (ROOT_DOCUMENTATION.has(path)) {
      continue;
    } else {
      // Root tooling, unknown app directories, and unknown root paths are broad.
      for (const target of ALL_TARGETS) selected.add(target);
    }
  }
  return ALL_TARGETS.filter(target => selected.has(target));
}

export function targetsForComparison(base, head = 'HEAD') {
  if (!base || /^0+$/.test(base)) return ALL_TARGETS;
  try {
    const output = execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', base, head], { encoding: 'utf8' });
    return affectedTargetsForRepositoryPaths(output.split('\0').filter(Boolean));
  } catch {
    // Missing commits, an invalid repository, and git errors must not skip checks.
    return ALL_TARGETS;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [base, head = 'HEAD'] = process.argv.slice(2);
  const targets = JSON.stringify(targetsForComparison(base, head));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `targets=${targets}\n`);
  else console.log(targets);
}
