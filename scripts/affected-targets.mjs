import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checksForFiles } from '../apps/backend/scripts/service-changes.mjs';
import { affectedTargets as webTargets } from '../apps/web/scripts/affected-targets.mjs';

const keys = ['backend_full', 'sdk', 'site', 'builder', 'raindrop_ui', 'ops', 'docs'];

export function allTargets() {
  return { backend_full: true, services: ['admin', 'marketing'], sdk: true,
    site: true, builder: true, raindrop_ui: true, ops: true, docs: true };
}

export function affectedTargets(paths) {
  const selected = Object.fromEntries(keys.map(key => [key, false]));
  const services = new Set();
  for (const path of paths) {
    if (path.startsWith('apps/backend/')) {
      const local = path.slice('apps/backend/'.length);
      if (!local) return allTargets();
      if (local.startsWith('docs/') || local === 'API.md' || local === 'SKILL.md'
        || local.startsWith('sdk/')) {
        selected.docs = selected.site = true;
      }
      const service = checksForFiles([path]);
      if (service.full) {
        // A shared backend change can affect both public clients and Raindrop auth.
        selected.backend_full = selected.sdk = selected.site = selected.builder = selected.raindrop_ui = selected.docs = true;
      } else service.services.forEach(name => services.add(name));
    } else if (path.startsWith('apps/voice/')) {
      const local = path.slice('apps/voice/'.length);
      if (local === 'README.md') selected.docs = true;
      else if (local.startsWith('web/')) selected.site = true;
      else {
        // Voice still runs in the API Worker. Backend checks include its worker
        // tests, and the site checks include its browser tests.
        selected.backend_full = selected.sdk = selected.site = selected.builder = selected.raindrop_ui = selected.docs = true;
      }
    } else if (path.startsWith('apps/vibe/')) {
      const local = path.slice('apps/vibe/'.length);
      if (local === 'README.md' || local === 'AGENTS.md') selected.docs = true;
      else if (local.startsWith('web/')) {
        // Onboarding and the code browser also run in the public site.
        selected.site = selected.builder = true;
      } else {
        selected.backend_full = selected.sdk = selected.site = selected.builder = selected.raindrop_ui = selected.docs = true;
      }
    } else if (path.startsWith('apps/web/')) {
      const local = path.slice('apps/web/'.length);
      if (!local) return allTargets();
      for (const target of webTargets([local])) selected[target] = true;
      selected.docs = true;
      if (local.startsWith('public/references/') || local.startsWith('public/skills/')
        || ['API.md', 'SKILL.md'].includes(local) || local.startsWith('docs/')) {
        selected.site = true;
      }
    } else if (path.startsWith('apps/raindrop/')) {
      const local = path.slice('apps/raindrop/'.length);
      if (!local) return allTargets();
      if (local === 'scripts/check-routes.mjs') selected.raindrop_ui = true;
      else if (local.startsWith('scripts/campaigns/') || local.startsWith('scripts/tests/')
        || ['scripts/google.py', 'scripts/requirements.txt', 'scripts/README.md', 'scripts/t.txt'].includes(local)) {
        selected.ops = true;
      }
      else if (local === 'README.md' || local === 'LICENSE') selected.docs = true;
      else if (local.startsWith('src/') || local.startsWith('public/')
        || local.startsWith('download/') || local.startsWith('privacy/') || local.startsWith('terms/')
        || ['index.html', 'vite.config.ts', 'tsconfig.json', 'tsconfig.node.json',
          'package.json', 'package-lock.json', 'wrangler.jsonc'].includes(local)) {
        selected.raindrop_ui = true;
      } else {
        selected.raindrop_ui = selected.ops = true;
      }
    } else if (path === 'README.md' || path === 'LICENSE' || path.startsWith('docs/')) {
      selected.docs = true;
    } else {
      // Root lockfiles, workflow and tooling changes, and unknown owners affect all apps.
      return allTargets();
    }
  }
  return { ...selected, services: [...services].sort() };
}

export function targetsBetween(base, head, git = execFileSync) {
  if (!/^[a-f0-9]{40}$/.test(base ?? '') || /^0+$/.test(base)
    || !/^[a-f0-9]{40}$/.test(head ?? '')) return allTargets();
  try {
    const paths = git('git', ['diff', '--no-renames', '--name-only', '-z', base, head], { encoding: 'utf8' })
      .split('\0').filter(Boolean);
    return affectedTargets(paths);
  } catch {
    return allTargets();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [base, head] = process.argv.slice(2);
  const targets = targetsBetween(base, head);
  const lines = [...keys.map(key => `${key}=${targets[key]}`), `services=${JSON.stringify(targets.services)}`].join('\n') + '\n';
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines);
  else process.stdout.write(lines);
}
