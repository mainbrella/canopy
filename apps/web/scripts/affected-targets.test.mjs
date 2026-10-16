import test from 'node:test';
import assert from 'node:assert/strict';
import { affectedTargets } from './affected-targets.mjs';

test('builder edits only build the builder', () => {
  for (const path of ['build/index.html', 'build/build.css', 'src/builder.ts', 'src/build-dashboard.ts',
    'src/build-files.test.ts', 'vite.builder.config.ts', 'wrangler.builder.jsonc', 'tsconfig.builder.json']) {
    assert.deepEqual(affectedTargets([path]), ['builder'], path);
  }
});

test('public content and legacy routing edits only build the site', () => {
  for (const path of ['index.html', 'docs/containers/index.html', 'blog/new-post/index.html',
    'public/images/blog/new.png', 'src/build-route.ts', 'vite.config.ts', 'wrangler.jsonc']) {
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
