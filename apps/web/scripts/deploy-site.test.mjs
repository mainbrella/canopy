import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { deploySite } from './deploy-site.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'canopy-site-publish-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const write = (file, value) => { mkdirSync(dirname(join(directory, file)), { recursive: true }); writeFileSync(join(directory, file), value); };
  write('package.json', '{"type":"module"}');
  write('node_modules/wrangler/package.json', '{"name":"wrangler"}');
  write('node_modules/wrangler/bin/wrangler.js', '');
  const manifest = { 'dashboard/index.html': { file: 'assets/dashboard.js', isEntry: true } };
  function build() {
    write('dist/.vite/manifest.json', JSON.stringify(manifest));
    write('dist/assets/dashboard.js', 'console.log("built")');
    for (const page of ['index.html', 'login/index.html', 'dashboard/index.html']) write(`dist/${page}`, '<html><script src="/assets/dashboard.js"></script></html>');
  }
  return { directory, write, build };
}

test('the site publisher uploads a verified copy that survives another build clearing dist', async t => {
  const f = fixture(t);
  let snapshot, published = false;
  await deploySite({ directory: f.directory, env: {}, args: ['--outdir=.wrangler/release-site'], run(command, args) {
    if (command === 'npm') {
      assert.deepEqual(args, ['run', 'build:site']);
      f.build(); return;
    }
    assert.equal(command, process.execPath);
    assert.ok(args.includes('--outdir=.wrangler/release-site'));
    snapshot = args[args.indexOf('--assets') + 1];
    assert.notEqual(snapshot, join(f.directory, 'dist'));
    rmSync(join(f.directory, 'dist'), { recursive: true });
    assert.match(readFileSync(join(snapshot, 'index.html'), 'utf8'), /<html>/);
    assert.equal(readFileSync(join(snapshot, 'assets/dashboard.js'), 'utf8'), 'console.log("built")');
    published = true;
  } });
  assert.equal(published, true);
  assert.equal(existsSync(snapshot), false, 'Direct deployments clean up the snapshot');
});

test('an incomplete public-only build cannot reach Wrangler deployment', async t => {
  const f = fixture(t);
  let published = false;
  await assert.rejects(deploySite({ directory: f.directory, env: {}, run(command) {
    if (command === 'npm') {
      f.write('dist/404.html', '<html>Not found</html>');
      f.write('dist/app.css', 'body {}');
    } else published = true;
  } }), /manifest.json/);
  assert.equal(published, false);
});

test('site snapshots remain available for the release runner to hash after upload', async t => {
  const f = fixture(t);
  const snapshot = join(f.directory, '.wrangler/release-snapshot');
  await deploySite({ directory: f.directory, env: { CANOPY_SITE_ASSET_SNAPSHOT: snapshot }, run(command) {
    if (command === 'npm') f.build();
  } });
  assert.ok(existsSync(join(snapshot, 'index.html')));
});
