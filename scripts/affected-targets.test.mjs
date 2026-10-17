import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { affectedTargets, allTargets, targetsBetween } from './affected-targets.mjs';

const sha = 'a'.repeat(40);
const other = 'b'.repeat(40);

test('service allowlists remain scoped with root prefixes', () => {
  const result = affectedTargets(['apps/backend/worker/admin.ts', 'apps/backend/worker/marketing.ts']);
  assert.deepEqual(result.services, ['admin', 'marketing']);
  assert.equal(result.backend_full, false);
  assert.equal(result.site, false);
});

test('shared backend changes select public consumers and SDK checks', () => {
  const result = affectedTargets(['apps/backend/worker/app/auth-core.ts']);
  for (const key of ['backend_full', 'sdk', 'site', 'builder', 'raindrop_ui']) assert.equal(result[key], true);
});

test('BFF homepage changes select the site without backend or builder work', () => {
  for (const path of ['apps/bff/web/homepage.html', 'apps/bff/web/landing.ts', 'apps/bff/web/landing.css']) {
    const result = affectedTargets([path]);
    assert.equal(result.site, true, path);
    assert.equal(result.builder, false, path);
    assert.equal(result.backend_full, false, path);
  }
  const docs = affectedTargets(['apps/bff/README.md']);
  assert.equal(docs.docs, true);
  assert.equal(docs.site, false);
});

test('BFF worker and configuration changes run the API host checks', () => {
  for (const path of ['apps/bff/worker/routes.ts', 'apps/bff/package.json', 'apps/bff/tsconfig.worker.json']) {
    const result = affectedTargets([path]);
    assert.equal(result.backend_full, true, path);
    assert.equal(result.docs, true, path);
  }
});

test('Voice browser changes select the site and worker changes select their API host', () => {
  const browser = affectedTargets(['apps/voice/web/voice-api.ts']);
  assert.equal(browser.site, true);
  assert.equal(browser.builder, false);
  assert.equal(browser.backend_full, false);
  for (const path of ['apps/voice/worker/app/voice.ts', 'apps/voice/package.json', 'apps/voice/tsconfig.web.json']) {
    const worker = affectedTargets([path]);
    for (const key of ['backend_full', 'sdk', 'site', 'builder', 'docs']) assert.equal(worker[key], true, path);
  }
});

test('web builder and Raindrop operations stay independently selected', () => {
  const result = affectedTargets(['apps/web/build/index.html', 'apps/raindrop/scripts/google.py']);
  assert.equal(result.builder, true);
  assert.equal(result.site, false);
  assert.equal(result.raindrop_ui, false);
  assert.equal(result.ops, true);
});

test('Vibe selects its existing API, site, and builder deployment hosts', () => {
  const browser = affectedTargets(['apps/vibe/web/build-api.ts']);
  assert.equal(browser.site, true);
  assert.equal(browser.builder, true);
  assert.equal(browser.backend_full, false);
  for (const path of ['apps/vibe/worker/app/build.ts', 'apps/vibe/package.json', 'apps/vibe/tsconfig.web.json']) {
    const worker = affectedTargets([path]);
    for (const key of ['backend_full', 'sdk', 'site', 'builder', 'docs']) assert.equal(worker[key], true, path);
  }
  const docs = affectedTargets(['apps/vibe/README.md']);
  assert.equal(docs.docs, true);
  assert.equal(docs.backend_full, false);
  assert.equal(docs.builder, false);
});

test('Raindrop route smoke tooling selects UI checks', () => {
  const result = affectedTargets(['apps/raindrop/scripts/check-routes.mjs']);
  assert.equal(result.raindrop_ui, true);
  assert.equal(result.ops, false);
});

test('public reference edits select same-commit documentation check and site build', () => {
  const result = affectedTargets(['apps/web/public/references/endpoints.md']);
  assert.equal(result.docs, true);
  assert.equal(result.site, true);
});

test('repository documentation needs documentation checks only', () => {
  const result = affectedTargets(['README.md', 'docs/architecture.md']);
  assert.equal(result.docs, true);
  assert.equal(result.backend_full, false);
  assert.equal(result.site, false);
});

test('deleted files and both sides of a rename are classified', () => {
  const git = (_command, args) => {
    assert.deepEqual(args, ['diff', '--no-renames', '--name-only', '-z', sha, other]);
    return 'apps/web/build/old.ts\0apps/web/src/build-route.ts\0apps/raindrop/scripts/old.py\0';
  };
  const result = targetsBetween(sha, other, git);
  assert.equal(result.builder, true);
  assert.equal(result.site, true);
  assert.equal(result.ops, true);
});

test('Git comparison includes an actual move and deletion from both revisions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'canopy-affected-'));
  const git = (command, args, options = {}) => execFileSync(command, args, { ...options, cwd: directory });
  const file = (path, value) => {
    const target = join(directory, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, value);
  };
  try {
    git('git', ['init', '-q']);
    file('apps/web/build/legacy.ts', 'export {}\n');
    file('apps/raindrop/scripts/old.py', 'pass\n');
    git('git', ['add', '-A']);
    git('git', ['-c', 'user.name=CI', '-c', 'user.email=ci@example.test', 'commit', '-qm', 'base']);
    const base = git('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    mkdirSync(join(directory, 'apps/web/src'), { recursive: true });
    renameSync(join(directory, 'apps/web/build/legacy.ts'), join(directory, 'apps/web/src/build-route.ts'));
    rmSync(join(directory, 'apps/raindrop/scripts/old.py'));
    git('git', ['add', '-A']);
    git('git', ['-c', 'user.name=CI', '-c', 'user.email=ci@example.test', 'commit', '-qm', 'change']);
    const head = git('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const result = targetsBetween(base, head, git);
    assert.equal(result.builder, true);
    assert.equal(result.site, true);
    assert.equal(result.ops, true);
    assert.deepEqual(targetsBetween('0'.repeat(40), head, git), allTargets());
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('missing history, diff failure and unknown root paths select everything', () => {
  assert.deepEqual(targetsBetween('0'.repeat(40), other), allTargets());
  assert.deepEqual(targetsBetween(sha, other, () => { throw new Error('missing commit'); }), allTargets());
  assert.deepEqual(affectedTargets(['new-root-tool.mjs']), allTargets());
  const unknownRaindrop = affectedTargets(['apps/raindrop/new-tool.conf']);
  assert.equal(unknownRaindrop.raindrop_ui, true);
  assert.equal(unknownRaindrop.ops, true);
});
