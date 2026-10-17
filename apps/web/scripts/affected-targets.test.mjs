import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { affectedTargets, affectedTargetsForRepositoryPaths } from './affected-targets.mjs';

test('builder edits only build the builder', () => {
  for (const path of ['build/index.html', 'build/build.css', 'src/builder.ts', 'src/build-dashboard.ts',
    'src/build-files.test.ts', 'vite.builder.config.ts', 'wrangler.builder.jsonc', 'tsconfig.builder.json']) {
    assert.deepEqual(affectedTargets([path]), ['builder'], path);
  }
});

test('public content and legacy routing edits only build the site', () => {
  for (const path of ['index.html', 'docs/containers/index.html', 'blog/new-post/index.html',
    'public/images/blog/new.png', 'bff/index.html', 'src/build-route.ts', 'vite.config.ts', 'wrangler.jsonc']) {
    assert.deepEqual(affectedTargets([path]), ['site'], path);
  }
});

test('shared source, assets, dependencies and build tooling rebuild both apps', () => {
  for (const path of ['src/auth.ts', 'src/account-page.ts', 'src/new-shared-helper.ts', 'src/types.ts',
    'src/acquisition.ts', 'public/mainbrella.css', 'public/app.css', 'public/images/logo.png',
    'public/images/favicon.png', 'package-lock.json', 'package.json', 'tsconfig.json',
    'scripts/site-chrome-plugin.ts', '.github/workflows/ci.yml']) {
    assert.deepEqual(affectedTargets([path]), ['site', 'builder'], path);
  }
  assert.deepEqual(affectedTargets(['build/index.html', 'pricing/index.html']), ['site', 'builder']);
  assert.deepEqual(affectedTargets([]), []);
});

test('repository paths select only web-owned checks and known backend contracts', () => {
  assert.deepEqual(affectedTargetsForRepositoryPaths(['apps/web/build/index.html']), ['builder']);
  assert.deepEqual(affectedTargetsForRepositoryPaths(['apps/web/public/blog/post/index.html']), ['site']);
  assert.deepEqual(affectedTargetsForRepositoryPaths(['apps/web/unrecognized.config']), ['site', 'builder']);
  assert.deepEqual(affectedTargetsForRepositoryPaths(['apps/backend/worker/app/openapi-auth.ts']), ['site']);
  assert.deepEqual(affectedTargetsForRepositoryPaths(['apps/backend/worker/lib/stripe.ts']), []);
  assert.deepEqual(affectedTargetsForRepositoryPaths(['apps/raindrop/src/main.ts']), []);
  assert.deepEqual(affectedTargetsForRepositoryPaths(['apps/vibe/web/build-api.ts']), ['site', 'builder']);
  assert.deepEqual(affectedTargetsForRepositoryPaths(['apps/vibe/worker/app/build.ts']), ['site', 'builder']);
  assert.deepEqual(affectedTargetsForRepositoryPaths(['apps/vibe/README.md']), []);
  assert.deepEqual(affectedTargetsForRepositoryPaths(['apps/bff/web/homepage.html']), ['site']);
  assert.deepEqual(affectedTargetsForRepositoryPaths(['apps/bff/web/landing.css']), ['site']);
  assert.deepEqual(affectedTargetsForRepositoryPaths(['apps/bff/README.md']), []);
  assert.deepEqual(affectedTargetsForRepositoryPaths(['README.md']), []);
  assert.deepEqual(affectedTargetsForRepositoryPaths(['package.json']), ['site', 'builder']);
});

test('CLI compares added, deleted, and moved web paths from the Canopy root', () => {
  const repo = mkdtempSync(join(tmpdir(), 'affected-targets-'));
  const script = fileURLToPath(new URL('./affected-targets.mjs', import.meta.url));
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  const run = (...args) => spawnSync(process.execPath, [script, ...args], {
    cwd: repo, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '' },
  });
  try {
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    mkdirSync(join(repo, 'apps/web/build'), { recursive: true });
    mkdirSync(join(repo, 'apps/web/docs'), { recursive: true });
    writeFileSync(join(repo, 'apps/web/build/old.html'), 'old');
    writeFileSync(join(repo, 'apps/web/index.html'), 'site');
    git('add', '.');
    git('commit', '-qm', 'baseline');
    const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

    rmSync(join(repo, 'apps/web/build/old.html'));
    writeFileSync(join(repo, 'apps/web/build/new.html'), 'new');
    writeFileSync(join(repo, 'apps/web/docs/moved.html'), 'site');
    rmSync(join(repo, 'apps/web/index.html'));
    git('add', '-A');
    git('commit', '-qm', 'move and delete web files');

    const result = run(base, 'HEAD');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), ['site', 'builder']);

    const outputFile = join(repo, 'github-output.txt');
    const outputMode = spawnSync(process.execPath, [script, base, 'HEAD'], {
      cwd: repo, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: outputFile },
    });
    assert.equal(outputMode.status, 0, outputMode.stderr);
    assert.equal(outputMode.stdout, '');
    assert.equal(readFileSync(outputFile, 'utf8'), 'targets=["site","builder"]\n');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('CLI selects all checks when comparison history is missing or invalid', () => {
  const repo = mkdtempSync(join(tmpdir(), 'affected-targets-history-'));
  const script = fileURLToPath(new URL('./affected-targets.mjs', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [script, ...args], {
    cwd: repo, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '' },
  });
  try {
    for (const args of [[], ['0000000000000000000000000000000000000000'], ['missing-base', 'HEAD']]) {
      const result = run(...args);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), ['site', 'builder']);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
