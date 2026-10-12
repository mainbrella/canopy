import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { siteChromePlugin } from '../scripts/site-chrome-plugin.ts';

const hook = siteChromePlugin().transformIndexHtml;
assert.ok(hook && typeof hook === 'object' && 'handler' in hook);
const handler = hook.handler;
const pluginContext = {} as ThisParameterType<typeof handler>;

async function transform(filename: string, path: string) {
  const source = await readFile(new URL(`../${filename}`, import.meta.url), 'utf8');
  const result: unknown = await handler.call(pluginContext, source, { path, filename });
  assert.equal(typeof result, 'string');
  if (typeof result !== 'string') throw new Error('Expected transformed HTML');
  return result;
}

test('article CSS is inlined in source order after critical shared styles', async () => {
  const html = await transform('blog/one-bug-three-clouds/index.html', '/blog/one-bug-three-clouds/index.html');
  const critical = html.indexOf('<style data-critical-css>');
  const shared = html.indexOf('<link rel="stylesheet" href="/mainbrella.css"');
  const sharedArticle = html.indexOf('<style data-article-css="/blog/inside-our-brella/article.css">');
  const pageArticle = html.indexOf('<style data-article-css="/blog/one-bug-three-clouds/article.css">');

  assert.ok(critical >= 0 && critical < shared, 'critical CSS must precede the full shared stylesheet');
  assert.ok(shared < sharedArticle && sharedArticle < pageArticle, 'article CSS must retain linked stylesheet order');
  assert.doesNotMatch(html, /<link rel="stylesheet" href="\/blog\/(?:inside-our-brella|one-bug-three-clouds)\/article\.css"/);
  assert.match(html.slice(critical, shared), /\.wrap\s*\{/);
  assert.match(html.slice(critical, shared), /\.platform-header\s*\{/);
  assert.match(html.slice(critical, shared), /\.footer-socials svg\s*\{/);
  assert.match(html.slice(critical, shared), /\.account-panel\s*\{/);
  assert.match(html.slice(critical, shared), /\[hidden\]\s*\{/);
  assert.match(html.slice(sharedArticle, pageArticle), /\.inside-brella article\s*\{/);
  assert.match(html.slice(pageArticle), /\.rodeo-article \.rodeo-screenshots\s*\{/);
});

test('critical shared CSS supports the builder stylesheet URL', async () => {
  const html = await transform('build/index.html', '/build/index.html');
  const critical = html.indexOf('<style data-critical-css>');
  const shared = html.indexOf('<link rel="stylesheet" href="/public/mainbrella.css"');
  assert.ok(critical >= 0 && critical < shared);
});

test('isolated exception pages bypass CSS inlining unchanged', async () => {
  for (const path of ['/unsubscribe/index.html', '/repo-rodeo-bug/index.html']) {
    const filename = `${path.slice(1, path.indexOf('/index.html'))}/index.html`;
    const source = await readFile(new URL(`../${filename}`, import.meta.url), 'utf8');
    const result: unknown = await handler.call(pluginContext, source, { path, filename });
    assert.equal(result, source, path);
  }
});
