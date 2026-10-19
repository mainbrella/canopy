import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const parent = join(root, '..');
const manifest = JSON.parse(readFileSync(join(root, 'migration/split-map.json'), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
execFileSync('git', ['cat-file', '-e', `${manifest.sourceCommit}^{commit}`], { cwd: root });
assert.ok(!existsSync(join(root, 'apps')), 'The active apps directory must be removed.');
assert.ok(!existsSync(join(root, 'packages')), 'Shared workspace code must be folded into its host.');
for (const repo of ['backend', 'web', 'raindrop']) {
  assert.ok(existsSync(join(parent, repo, '.git')), `${repo} must remain a Git repository.`);
  const pkg = JSON.parse(readFileSync(join(parent, repo, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(parent, repo, 'package-lock.json'), 'utf8'));
  assert.ok(!pkg.workspaces && !lock.packages[''].workspaces, `${repo} must install independently.`);
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    assert.ok(!name.startsWith('@canopy/'), `${repo}: leftover workspace dependency ${name}`);
  }
}
let migrations = 0;
for (const [source, target] of Object.entries(manifest.files)) {
  assert.ok(existsSync(join(parent, target)), `Missing moved file: ${source} -> ${target}`);
  if (source.startsWith('apps/backend/migrations/') && source.endsWith('.sql')) {
    assert.equal(sha256(readFileSync(join(parent, target))), manifest.sourceSha256[source], `Migration changed: ${target}`);
    migrations++;
  }
}
assert.equal(migrations, 59, 'All existing account migrations must be retained.');
for (const [path, expected] of Object.entries(manifest.destinationSha256)) {
  assert.equal(sha256(readFileSync(join(parent, path))), expected, `Split snapshot changed: ${path}`);
}
console.log(`Verified ${Object.keys(manifest.files).length} moved files, ${Object.keys(manifest.destinationSha256).length} destination snapshots, ${migrations} unchanged migrations, and three independent repos.`);
