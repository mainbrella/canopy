import type { TestContext } from 'node:test';
import test from 'node:test';
import assert from 'node:assert/strict';

let sequence = 0;
class Element {
  [key: string]: any;
  children: Element[] = [];
  parent?: Element;
  textContent = '';
  value = '';
  hidden = false;
  disabled = false;
  dataset: Record<string, string> = {};
  style = {};
  attributes = new Map<string, string>();
  listeners = new Map<string, (event: any) => unknown>();
  constructor(public tagName = 'div') {}
  get options() { return this.children; }
  addEventListener(type: string, callback: (event: any) => unknown) { this.listeners.set(type, callback); }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  append(...children: Element[]) { children.forEach(child => { child.parent = this; this.children.push(child); }); }
  replaceChildren(...children: Element[]) { this.children = []; this.append(...children); }
  replaceWith(child: Element) { const parent = this.parent!; child.parent = parent; parent.children[parent.children.indexOf(this)] = child; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  querySelectorAll() { return this.children.filter(child => child.dataset.historicalVersion !== undefined); }
  querySelector(_selector: string) { return this.children.find(child => child.attributes.has('aria-current')); }
  focus() {}
  async fire(type: string, event: any = {}) { return this.listeners.get(type)?.(event); }
  click() { void this.fire('click'); }
  find(predicate: (element: Element) => boolean): Element | undefined {
    if (predicate(this)) return this;
    for (const child of this.children) { const result = child.find(predicate); if (result) return result; }
  }
}

const project = { id: 'git-project', name: 'Git-only project', build_app_id: null, git_version_id: 'head' };
const saved = { id: 'head', commitId: 'a'.repeat(40), message: 'Saved source', parentVersionId: 'older', verified: true, createdAt: '2026-10-01T12:00:00Z' };
const older = { ...saved, id: 'older', commitId: 'b'.repeat(40), message: 'Earlier source', parentVersionId: null };

function defaultResponse(url: string) {
  const path = new URL(url).pathname;
  if (path === '/auth/me') return Response.json({ user: { id: 'account' } });
  if (path === '/projects') return Response.json({ projects: [project] });
  if (path.endsWith('/versions')) return Response.json({ versions: [saved, older], versionId: 'head', verifiedVersionId: 'head' });
  if (path.endsWith('/files')) {
    const versionId = new URL(url).searchParams.get('versionId');
    return Response.json({ revision: 2, version: versionId === 'older' ? older : versionId ? saved : null,
      files: [{ path: 'src/notes.txt', type: 'text', size: 12 }, { path: 'public/logo.jpg', type: 'image', size: 100 }] });
  }
  if (path.endsWith('/file')) return new Response('literal <html>\nsource\n');
  if (path.endsWith('/repository')) return new Response(new Uint8Array([0, 255, 1]));
  throw new Error(`Unexpected request: ${url}`);
}

async function fixture(t: TestContext, respond: (url: string, options: RequestInit) => Response | Promise<Response> = defaultResponse, search = '?project=git-project') {
  const nodes = new Map<string, Element>(), calls: { url: string; options: RequestInit }[] = [], redirects: string[] = [], created: Element[] = [];
  const node = (selector: string) => {
    if (!nodes.has(selector)) nodes.set(selector, new Element());
    return nodes.get(selector)!;
  };
  const view = node('select');
  view.append(Object.assign(new Element('option'), { value: 'repository' }), Object.assign(new Element('option'), { value: 'working' }));
  node('#code-source').querySelector = node;
  const listeners = new Map<string, (event: any) => void>();
  const location = { hostname: 'localhost', pathname: '/projects/code/', search, hash: '', replace: (url: string) => redirects.push(url) };
  const window = {
    location, localStorage: { getItem: () => 'accepted' }, sessionStorage: { getItem: () => 'accepted' },
    addEventListener: (type: string, callback: (event: any) => void) => listeners.set(type, callback),
    dispatchEvent: (event: any) => listeners.get(event.type)?.(event),
  };
  const property = (key: string, value: unknown) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  };
  property('location', location); property('window', window);
  property('document', { querySelector: node, createElement: (tag: string) => { const element = new Element(tag); created.push(element); return element; },
    createElementNS: (_namespace: string, tag: string) => new Element(tag) });
  property('fetch', async (url: string, options: RequestInit) => { calls.push({ url, options }); return respond(url, options); });
  await import(`./project-code.ts?test=${++sequence}`);
  const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
  await flush();
  return { node, calls, redirects, created, view, flush, listeners };
}

test('Git-only projects browse saved files and images without loading Builder or billing', async t => {
  const f = await fixture(t);
  assert.equal(f.node('#code-title').textContent, 'Git-only project · Code');
  assert.equal(f.node('#code-source').hidden, false);
  assert.equal(f.view.value, 'repository');
  assert.equal(f.node('#build-source-commit').textContent, 'aaaaaaaa');
  assert.equal(f.node('.build-source-message').textContent, 'Saved source');
  assert.equal(f.node('#code-download').disabled, false);
  assert.equal(f.calls.some(call => /\/billing|\/config$|\/apps$|\/apps\/git-project$/.test(new URL(call.url).pathname)), false);
  const content = f.node('.build-files');
  await content.find(element => element.attributes.get('aria-label') === 'Open folder src')!.fire('click');
  await content.find(element => element.attributes.get('aria-label') === 'Open file src/notes.txt')!.fire('click');
  await f.flush();
  assert.equal(content.find(element => element.tagName === 'code')!.textContent, 'literal <html>\nsource\n');
  const fileCall = f.calls.find(call => new URL(call.url).pathname.endsWith('/file'))!;
  assert.equal(new URL(fileCall.url).searchParams.get('versionId'), 'head');
  assert.equal(fileCall.options.credentials, 'include');
  await content.find(element => element.textContent === 'Files')!.fire('click');
  await content.find(element => element.attributes.get('aria-label') === 'Open folder public')!.fire('click');
  await content.find(element => element.attributes.get('aria-label') === 'Open file public/logo.jpg')!.fire('click');
  const image = content.find(element => element.tagName === 'img')!;
  assert.equal(new URL(image.src).searchParams.get('versionId'), 'head');
  assert.equal(image.alt, 'public/logo.jpg');
});

test('the shared version selector browses historical and working source', async t => {
  const f = await fixture(t);
  f.view.value = 'older'; await f.view.fire('change'); await f.flush();
  assert.equal(f.node('#build-source-commit').textContent, 'bbbbbbbb');
  f.view.value = 'working'; await f.view.fire('change'); await f.flush();
  assert.equal(f.node('#build-source-commit').textContent, 'Revision 2');
  assert.equal(f.node('.build-source-message').hidden, true);
  const reads = f.calls.filter(call => new URL(call.url).pathname.endsWith('/files'));
  assert.deepEqual(reads.map(call => new URL(call.url).searchParams.get('versionId')), ['head', 'older', null]);
});

test('changing source versions ignores an obsolete file-list response', async t => {
  let finish!: (response: Response) => void;
  const f = await fixture(t, url => {
    if (new URL(url).pathname.endsWith('/files') && new URL(url).searchParams.get('versionId') === 'older') {
      return new Promise(resolve => { finish = resolve; });
    }
    return defaultResponse(url);
  });
  f.view.value = 'older'; await f.view.fire('change'); await f.flush();
  f.view.value = 'working'; await f.view.fire('change'); await f.flush();
  finish(defaultResponse('http://localhost/build/apps/git-project/files?versionId=older')); await f.flush();
  assert.equal(f.node('#build-source-commit').textContent, 'Revision 2');
  assert.equal(f.node('.build-source-message').hidden, true);
  assert.equal(f.node('#code-source').attributes.get('aria-busy'), 'false');
});

test('file-list failures can be retried in place', async t => {
  let fail = true;
  const f = await fixture(t, url => new URL(url).pathname.endsWith('/files') && fail
    ? Response.json({ error: 'network' }, { status: 503 }) : defaultResponse(url));
  assert.equal(f.node('#code-error').hidden, false);
  assert.equal(f.node('#code-retry').hidden, false);
  fail = false; await f.node('#code-retry').fire('click'); await f.flush();
  assert.equal(f.node('#code-error').hidden, true);
  assert.ok(f.node('.build-files').find(element => element.attributes.get('aria-label') === 'Open folder src'));
});

test('an empty Git project shows working files without offering an empty repository download', async t => {
  const f = await fixture(t, url => {
    if (new URL(url).pathname === '/projects') return Response.json({ projects: [{ ...project, build_app_id: 'source-store', git_version_id: null }] });
    if (new URL(url).pathname.endsWith('/versions')) return Response.json({ versions: [], versionId: null, verifiedVersionId: null });
    if (new URL(url).pathname.endsWith('/files')) return Response.json({ revision: 0, version: null, files: [] });
    return defaultResponse(url);
  });
  assert.equal(f.view.value, 'working');
  assert.equal(f.node('#code-download').hidden, true);
  assert.ok(f.node('.build-files').find(element => element.textContent === 'No files yet.'));
  assert.ok(f.calls.some(call => new URL(call.url).pathname === '/build/apps/source-store/files'));
});

test('repository downloads preserve bytes and can be retried after a failure', async t => {
  let fail = true, downloaded: Blob | undefined;
  t.mock.method(URL, 'createObjectURL', (blob: Blob) => { downloaded = blob; return 'blob:project-code'; });
  t.mock.method(URL, 'revokeObjectURL', () => {});
  const f = await fixture(t, url => new URL(url).pathname.endsWith('/repository') && fail
    ? Response.json({ error: 'unavailable' }, { status: 503 }) : defaultResponse(url));
  await f.node('#code-download').fire('click');
  assert.equal(f.node('#code-error').hidden, false);
  assert.equal(f.node('#code-download').disabled, false);
  fail = false; await f.node('#code-download').fire('click');
  assert.deepEqual(new Uint8Array(await downloaded!.arrayBuffer()), new Uint8Array([0, 255, 1]));
  assert.equal(f.created.find(element => element.download === 'project.bundle')!.href, 'blob:project-code');
});

test('sign-out clears private source and ignores a pending file response', async t => {
  let finish!: (response: Response) => void;
  let signal: AbortSignal | undefined;
  const f = await fixture(t, (url, options) => {
    if (new URL(url).pathname.endsWith('/files')) { signal = options.signal as AbortSignal; return new Promise(resolve => { finish = resolve; }); }
    return defaultResponse(url);
  });
  f.listeners.get('auth-change')!({ detail: { user: null } });
  finish(defaultResponse('http://localhost/build/apps/git-project/files?versionId=head')); await f.flush();
  assert.equal(signal?.aborted, true);
  assert.equal(f.node('#code-source').hidden, true);
  assert.equal(f.node('#code-title').textContent, 'Code');
  assert.equal(f.node('#build-source-commit').textContent, '');
  assert.equal(f.node('.build-source-message').textContent, '');
  assert.equal(f.node('.build-files').find(element => element.tagName === 'ul'), undefined);
  assert.deepEqual(f.redirects, ['/login/?returnTo=%2Fprojects%2Fcode%2F%3Fproject%3Dgit-project']);
});

test('a source 401 redirects to login and leaves the code panel empty', async t => {
  const f = await fixture(t, url => new URL(url).pathname.endsWith('/versions')
    ? Response.json({ error: 'not_authenticated' }, { status: 401 }) : defaultResponse(url));
  assert.equal(f.node('#code-source').hidden, true);
  assert.equal(f.node('#code-download').disabled, true);
  assert.equal(f.redirects.length, 1);
});

test('a missing project parameter shows a concise empty state', async t => {
  const f = await fixture(t, defaultResponse, '');
  assert.match(f.node('#code-status').textContent, /Choose a project/);
  assert.equal(f.calls.length, 0);
});

test('unavailable projects do not make source requests', async t => {
  const f = await fixture(t, url => new URL(url).pathname === '/projects' ? Response.json({ projects: [] }) : defaultResponse(url));
  assert.match(f.node('#code-status').textContent, /Project not found/);
  assert.equal(f.calls.length, 2);
});

test('projects without Git explain the empty state without making source requests', async t => {
  const f = await fixture(t, url => new URL(url).pathname === '/projects'
    ? Response.json({ projects: [{ ...project, git_version_id: null }] }) : defaultResponse(url));
  assert.equal(f.node('#code-status').textContent, 'Git is not enabled for this project.');
  assert.equal(f.calls.length, 2);
});
