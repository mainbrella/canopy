import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(join(root, path));
const json = path => JSON.parse(read(path));
const hash = value => createHash('sha256').update(value).digest('hex');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const manifest = json('migration/imports.json');
const lock = json('package-lock.json');
const workspace = json('package.json');
const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 1 && args[0] === '--baseline', 'Use verify-migration.mjs [--baseline].');
const baseline = args[0] === '--baseline';

assert.equal(workspace.private, true);
// The import manifest is historical evidence, not a limit on future workspaces.
assert.equal(new Set(workspace.workspaces).size, workspace.workspaces.length);
for (const app of manifest.imports) assert.ok(workspace.workspaces.includes(app.path), `${app.path}: imported workspace missing`);
for (const path of workspace.workspaces) {
  const name = json(`${path}/package.json`).name;
  assert.equal(lock.packages[path]?.name, name, `${path}: workspace missing from root lockfile`);
  assert.equal(lock.packages[`node_modules/${name}`]?.resolved, path, `${path}: workspace link missing`);
}
git(['merge-base', '--is-ancestor', manifest.canopy.commit, 'HEAD']);
for (const app of manifest.imports) {
  git(['merge-base', '--is-ancestor', app.commit, 'HEAD']);
  assert.equal(json(`${app.path}/package.json`).name, `@canopy/${app.app}`);
  assert.equal(existsSync(join(root, app.path, 'package-lock.json')), false, 'Install from the root lockfile.');
  for (const [path, expected] of Object.entries(app.licenses)) {
    assert.equal(hash(read(app.app === 'backend' && path.startsWith('sdk/') ? `apps/linux/${path}` : `${app.path}/${path}`)), expected, `${app.app}/${path}: imported license changed`);
  }
  for (const [path, expected] of Object.entries(baseline ? app.configs : {})) {
    const config = json(`${app.path}/${path}`);
    delete config.$schema;
    assert.equal(hash(JSON.stringify(config)), expected.sha256, `${app.app}/${path}: infrastructure changed during import`);
  }
  for (const [path, version] of Object.entries(baseline ? app.resolvedVersions : {})) {
    const current = lock.packages[`${app.path}/${path}`] ?? lock.packages[path];
    assert.equal(current?.version, version, `${app.app}/${path}: dependency differs from import baseline`);
  }
}

const forbidden = git(['ls-files', '-z']).split('\0').filter(path =>
  /(^|\/)(?:node_modules|\.wrangler|dist|dist-builder)(\/|$)/.test(path)
  || /(^|\/)(?:\.env(?:\..*)?|\.dev.vars(?:\..*)?)$/.test(path) && !path.endsWith('.example'));
assert.deepEqual(forbidden, [], 'Ignored state or credentials must not be tracked.');
console.log(`Verified source ancestry, licenses, workspace names, and tracked-file hygiene${baseline ? ', plus original worker configurations and dependency versions' : ''}.`);
