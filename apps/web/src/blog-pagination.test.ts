import assert from 'node:assert/strict';
import test from 'node:test';
import { BLOG_PAGE_SIZE, renderBlogPage } from '../scripts/blog-pagination-plugin.ts';

function source(count: number) {
  const articles = Array.from({ length: count }, (_, index) => `<li><article><h2><a href="/blog/${index + 1}/">Article ${index + 1}</a></h2></article></li>`).join('\n');
  return `<head><link rel="canonical" href="https://mainbrella.com/blog/" /><meta property="og:title" content="Engineering blog · Mainbrella" /><meta property="og:url" content="https://mainbrella.com/blog/" /><title>Engineering blog · Mainbrella</title></head><main><ul class="article-list">${articles}</ul></main>`;
}

function listedArticles(html: string) {
  return [...html.matchAll(/<h2><a href="\/blog\/(\d+)\/">Article \d+<\/a><\/h2>/g)].map(match => Number(match[1]));
}

test('splits the ordered article list into six-item pages with compact navigation', () => {
  const fullList = source(17);
  const first = renderBlogPage(fullList, 1);
  const second = renderBlogPage(fullList, 2);
  const last = renderBlogPage(fullList, 3);

  assert.equal(BLOG_PAGE_SIZE, 6);
  assert.deepEqual(listedArticles(first), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(listedArticles(second), [7, 8, 9, 10, 11, 12]);
  assert.deepEqual(listedArticles(last), [13, 14, 15, 16, 17]);
  assert.deepEqual([...listedArticles(first), ...listedArticles(second), ...listedArticles(last)], Array.from({ length: 17 }, (_, index) => index + 1));
  assert.match(first, /<nav class="blog-pagination" aria-label="Blog pages"><span>Page 1 of 3<\/span><span class="blog-pagination-separator" aria-hidden="true">·<\/span><a href="\/blog\/page\/2\/">Next<\/a><\/nav>/);
  assert.match(second, /<a href="\/blog\/">Previous<\/a><span class="blog-pagination-separator" aria-hidden="true">·<\/span><span>Page 2 of 3<\/span><span class="blog-pagination-separator" aria-hidden="true">·<\/span><a href="\/blog\/page\/3\/">Next<\/a>/);
  assert.match(last, /<a href="\/blog\/page\/2\/">Previous<\/a><span class="blog-pagination-separator" aria-hidden="true">·<\/span><span>Page 3 of 3<\/span><\/nav>/);
  assert.doesNotMatch(last, />Next<\/a>/);
  assert.match(second, /rel="canonical" href="https:\/\/mainbrella\.com\/blog\/page\/2\/"/);
  assert.match(second, /property="og:url" content="https:\/\/mainbrella\.com\/blog\/page\/2\/"/);
  assert.match(second, /property="og:title" content="Engineering blog, page 2 · Mainbrella"/);
  assert.match(second, /<title>Engineering blog, page 2 · Mainbrella<\/title>/);
});

test('leaves a one-page or empty blog without pagination', () => {
  assert.doesNotMatch(renderBlogPage(source(1), 1), /blog-pagination/);
  assert.doesNotMatch(renderBlogPage(source(0), 1), /blog-pagination/);
});

test('rejects invalid and out-of-range pages and malformed source', () => {
  assert.throws(() => renderBlogPage(source(7), 0), RangeError);
  assert.throws(() => renderBlogPage(source(7), 2.5), RangeError);
  assert.throws(() => renderBlogPage(source(7), 3), RangeError);
  assert.throws(() => renderBlogPage('<main></main>', 1), /exactly one blog article list/);
  assert.throws(() => renderBlogPage('<ul class="article-list"><div>unexpected</div></ul>', 1), /Malformed article markup/);
});
