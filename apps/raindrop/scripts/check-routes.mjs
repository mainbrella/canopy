import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(app, 'dist');
const routes = ['users', 'users/detail', 'ledger', 'acquisition', 'email', 'email-all', 'email-custom'];
const read = path => readFile(path, 'utf8');
const mainHtml = await read(join(dist, 'index.html'));

for (const route of routes) {
  const routeHtml = await read(join(dist, route, 'index.html'));
  assert.equal(routeHtml, mainHtml, `Built route /${route} does not serve the app entry page`);
}

const assets = [...mainHtml.matchAll(/(?:src|href)="([^"?#]+)"/g)]
  .map(([, path]) => path)
  .filter(path => path.startsWith('/assets/'));
assert.ok(assets.some(path => path.endsWith('.js')), 'App entry JavaScript asset is missing');
for (const asset of assets) await access(join(dist, asset.slice(1)));

const notFoundPage = await read(join(dist, '404.html'));
assert.ok(notFoundPage.trim(), 'Built 404 page is empty');
const config = JSON.parse(await read(join(app, 'wrangler.jsonc')));
assert.equal(config.assets?.not_found_handling, '404-page', 'Static asset 404 handling must use the built 404 page');

console.log(`Checked ${routes.length} deep links, ${assets.length} built asset references, and the 404 page.`);
