import type { Plugin } from 'vite';
import type { ServerResponse } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const BLOG_PAGE_SIZE = 6;

function articlesFrom(html: string) {
  const matches = [...html.matchAll(/<ul\s+class="article-list">([\s\S]*?)<\/ul>/g)];
  if (matches.length !== 1) throw new Error('Expected exactly one blog article list.');
  const list = matches[0];
  const inner = list[1];
  if (inner === undefined || list.index === undefined) throw new Error('Malformed blog article list.');
  const items = [...inner.matchAll(/<li>\s*<article>[\s\S]*?<\/article>\s*<\/li>/g)];
  const remainder = inner.replace(/<li>\s*<article>[\s\S]*?<\/article>\s*<\/li>/g, '').trim();
  if (remainder) {
    throw new Error('Malformed article markup in blog article list.');
  }
  return {
    before: html.slice(0, list.index),
    after: html.slice(list.index + list[0].length),
    items: items.map(item => item[0]),
  };
}

export function renderBlogPage(html: string, page: number): string {
  if (!Number.isInteger(page) || page < 1) throw new RangeError('Blog page must be a positive integer.');
  const { before, after, items } = articlesFrom(html);
  const pageCount = Math.ceil(items.length / BLOG_PAGE_SIZE);
  if (page > Math.max(pageCount, 1)) throw new RangeError(`Blog page ${page} does not exist.`);

  const pageItems = items.slice((page - 1) * BLOG_PAGE_SIZE, page * BLOG_PAGE_SIZE);
  const list = `<ul class="article-list">\n${pageItems.join('\n')}\n</ul>`;
  const navItems = [
    ...(page > 1 ? [`<a href="${page === 2 ? '/blog/' : `/blog/page/${page - 1}/`}">Previous</a>`] : []),
    `<span>Page ${page} of ${pageCount}</span>`,
    ...(page < pageCount ? [`<a href="/blog/page/${page + 1}/">Next</a>`] : []),
  ];
  const nav = pageCount > 1
    ? `<nav class="blog-pagination" aria-label="Blog pages">${navItems.join('<span class="blog-pagination-separator" aria-hidden="true">·</span>')}</nav>`
    : '';

  let result = `${before}${list}${nav}${after}`;
  if (page > 1) {
    const canonical = `https://mainbrella.com/blog/page/${page}/`;
    result = result
      .replace('<link rel="canonical" href="https://mainbrella.com/blog/" />', `<link rel="canonical" href="${canonical}" />`)
      .replace('<meta property="og:url" content="https://mainbrella.com/blog/" />', `<meta property="og:url" content="${canonical}" />`)
      .replace('<meta property="og:title" content="Engineering blog · Mainbrella" />', `<meta property="og:title" content="Engineering blog, page ${page} · Mainbrella" />`)
      .replace('<title>Engineering blog · Mainbrella</title>', `<title>Engineering blog, page ${page} · Mainbrella</title>`);
  }
  return result;
}

function notFound(response: ServerResponse) {
  response.statusCode = 404;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.end('Blog page not found');
}

export function blogPaginationPlugin(): Plugin {
  return {
    name: 'blog-pagination',
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        if (!context.server || context.path !== '/blog/' && context.path !== '/blog/index.html') return html;
        return renderBlogPage(html, 1);
      },
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const method = request.method ?? 'GET';
        if (!['GET', 'HEAD'].includes(method)) return next();
        const path = request.url?.split('?')[0] ?? '';
        if (!path.startsWith('/blog/page/')) return next();

        const route = path.match(/^\/blog\/page\/([^/]+)(?:\/(?:index\.html)?)?$/);
        if (!route) return notFound(response);
        const requestedPage = route[1];
        if (!/^\d+$/.test(requestedPage)) return notFound(response);
        const page = Number(requestedPage);
        if (!Number.isSafeInteger(page) || page < 1) return notFound(response);
        if (page === 1) {
          response.writeHead(308, { Location: '/blog/' });
          response.end();
          return;
        }
        if (!path.endsWith('/') && !path.endsWith('/index.html')) {
          response.writeHead(308, { Location: `${path}/${request.url?.includes('?') ? request.url.slice(request.url.indexOf('?')) : ''}` });
          response.end();
          return;
        }

        try {
          const source = await readFile(new URL('../blog/index.html', import.meta.url), 'utf8');
          const transformed = await server.transformIndexHtml(`/blog/page/${page}/`, source);
          const html = renderBlogPage(transformed, page);
          response.statusCode = 200;
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.end(method === 'HEAD' ? undefined : html);
        } catch (error) {
          if (error instanceof RangeError) return notFound(response);
          next(error);
        }
      });
    },
    async writeBundle() {
      const output = fileURLToPath(new URL('../dist/blog/', import.meta.url));
      const source = await readFile(`${output}index.html`, 'utf8');
      const pageCount = Math.ceil(articlesFrom(source).items.length / BLOG_PAGE_SIZE);
      await writeFile(`${output}index.html`, renderBlogPage(source, 1));
      for (let page = 2; page <= pageCount; page++) {
        const directory = `${output}page/${page}`;
        await mkdir(directory, { recursive: true });
        await writeFile(`${directory}/index.html`, renderBlogPage(source, page));
      }
      if (pageCount > 1) {
        const sitemapPath = fileURLToPath(new URL('../dist/sitemap.xml', import.meta.url));
        const sitemap = await readFile(sitemapPath, 'utf8');
        const archiveUrls = Array.from({ length: pageCount - 1 }, (_, index) => `<url><loc>https://mainbrella.com/blog/page/${index + 2}/</loc></url>`).join('');
        await writeFile(sitemapPath, sitemap.replace('</urlset>', `${archiveUrls}</urlset>`));
      }
    },
  };
}
