import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function affectedTargets(paths) {
  const targets = new Set();
  for (const path of paths) {
    if (path === 'src/build-route.ts' || path === 'src/build-route.test.ts') {
      targets.add('site');
    } else if (path.startsWith('build/') || /^src\/(?:builder|build-[^/]+)\.(?:test\.)?ts$/.test(path)
      || ['vite.builder.config.ts', 'wrangler.builder.jsonc', 'tsconfig.builder.json'].includes(path)) {
      targets.add('builder');
    } else if (path.startsWith('src/') || path.startsWith('scripts/') || path.startsWith('.github/')
      || ['package.json', 'package-lock.json', 'tsconfig.json', 'public/mainbrella.css', 'public/app.css',
        'public/images/logo.png', 'public/images/favicon.png'].includes(path)) {
      // Unrecognized source changes are conservative, including new shared helpers.
      targets.add('site'); targets.add('builder');
    } else {
      targets.add('site');
    }
  }
  return ['site', 'builder'].filter(target => targets.has(target));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [base, head = 'HEAD'] = process.argv.slice(2);
  const paths = !base || /^0+$/.test(base) ? ['package.json']
    : execFileSync('git', ['diff', '--name-only', '-z', base, head], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const targets = JSON.stringify(affectedTargets(paths));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `targets=${targets}\n`);
  else console.log(targets);
}
