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

test('web builder and Raindrop operations stay independently selected', () => {
  const result = affectedTargets(['apps/web/build/index.html', 'apps/raindrop/scripts/google.py']);
  assert.equal(result.builder, true);
  assert.equal(result.site, false);
  assert.equal(result.raindrop_ui, false);
  assert.equal(result.ops, true);
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
