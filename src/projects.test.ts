import type { TestContext } from 'node:test';
import test from 'node:test';
import assert from 'node:assert/strict';

let sequence = 0;
class Element {
  [key: string]: any;
  hidden = true;
  disabled = false;
  textContent = '';
  value = '';
  checked = false;
  children: Element[] = [];
  listeners = new Map<string, (event: any) => unknown>();
  attributes = new Map<string, string>();
  classList = { add() {}, remove() {} };
  addEventListener(type: string, callback: (event: any) => unknown) { this.listeners.set(type, callback); }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren(...children: Element[]) { this.children = children; }
  reportValidity() { return true; }
  focus() { if (!this.disabled) this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; void this.fire('close'); }
  async fire(type: string, event: any = { preventDefault() {} }) { return this.listeners.get(type)?.(event); }
  click() { void this.fire('click'); }
}

const originalProject = { id: 'project-1', name: 'First project', domain: 'example.com', created_at: '2026-01-01T00:00:00Z' };
const secondProject = { id: 'project-2', name: 'Second project', created_at: '2026-01-02T00:00:00Z' };

async function fixture(t: TestContext, respond: (url: string, options: RequestInit) => Promise<Response> | Response = defaultResponse) {
  const nodes = new Map<string, Element>();
  const node = (selector: string) => {
    if (!nodes.has(selector)) nodes.set(selector, new Element());
    return nodes.get(selector)!;
  };
  const name = node('#project-name');
  const domain = node('#project-domain');
  node('#project-form').reset = () => { name.value = ''; domain.value = ''; node('#project-git').checked = false; };
  const calls: { url: string; options: RequestInit }[] = [];
  const created: Element[] = [];
  const redirects: string[] = [];
  const window = {
    localStorage: { getItem: () => 'accepted', setItem() {} },
    sessionStorage: { getItem: () => 'accepted', setItem() {} },
    location: { hostname: 'localhost', pathname: '/projects/', search: '', hash: '', replace: (url: string) => redirects.push(url) },
    addEventListener() {}, dispatchEvent() {},
  };
  const property = (key: string, value: unknown) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  };
  property('window', window);
  property('location', window.location);
  property('document', { querySelector: node, createElement: () => { const element = new Element(); created.push(element); return element; } });
  property('fetch', async (url: string, options: RequestInit) => {
    calls.push({ url, options });
    return respond(url, options);
  });
  await import(`./projects.ts?test=${++sequence}`);
  const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
  await flush();
  return { node: (selector: string) => node(selector), calls, redirects, flush, created };
}

function defaultResponse(url: string, options: RequestInit) {
  if (new URL(url).pathname === '/auth/me') return Response.json({ user: { id: 'account' } });
  if (new URL(url).pathname === '/projects/endpoint') return Response.json({ endpoint: { projectId: new URL(url).searchParams.get('id'), url: 'https://p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mainbrella.dev/', target: null, backendStatus: 'unlinked' }, domains: [], hosting: { supported: true, customDomains: true, apexIps: [] } });
  if (options.method === 'GET') return Response.json({ projects: [originalProject, secondProject] });
  if (options.method === 'PATCH') {
    const requested = JSON.parse(String(options.body));
    return Response.json({ project: { ...originalProject, name: requested.name, domain: requested.domain } });
  }
  return Response.json({ project: { id: 'project-3', ...JSON.parse(String(options.body)), created_at: '2026-01-03T00:00:00Z' } }, { status: 201 });
}

function editButton(f: Awaited<ReturnType<typeof fixture>>, index: number) {
  return f.node('#project-list').children[index].children[4].children[0].children[0];
}

test('shared dialog creates and edits projects, preserves order, and resets its mode', async t => {
  const f = await fixture(t);
  const dialog = f.node('#project-dialog');
  const title = f.node('#project-dialog-title');
  const form = f.node('#project-form');
  const name = f.node('#project-name');
  const domain = f.node('#project-domain');

  await editButton(f, 0).fire('click');
  assert.equal(name.value, 'First project');
  assert.equal(domain.value, 'example.com');
  assert.equal(title.textContent, 'Edit project');
  assert.equal(f.node('#project-create').textContent, 'Save changes');
  await f.node('#project-cancel').fire('click');
  assert.equal(dialog.open, false);
  assert.equal(title.textContent, 'New project');

  await f.node('#project-new').fire('click');
  assert.equal(name.value, '');
  assert.equal(domain.value, '');
  name.value = 'Third project';
  domain.value = '  third.example  ';
  await form.fire('submit');
  const createdCall = f.calls.find(call => call.options.method === 'POST')!;
  assert.deepEqual(JSON.parse(String(createdCall.options.body)), { name: 'Third project', domain: 'third.example' });
  assert.equal(f.node('#project-list').children[0].children[0].textContent, 'Third project');
  assert.equal(f.node('#project-list').children[0].children[1].textContent, 'third.example');
  assert.equal(editButton(f, 0).focused, true);

  await editButton(f, 1).fire('click');
  assert.equal(name.value, 'First project');
  assert.equal(domain.value, 'example.com');
  name.value = 'Renamed project';
  domain.value = '';
  await form.fire('submit');
  const updatedCall = f.calls.find(call => call.options.method === 'PATCH')!;
  assert.match(updatedCall.url, /\/projects\?id=project-1$/);
  assert.equal(updatedCall.options.credentials, 'include');
  assert.equal(updatedCall.options.redirect, 'error');
  assert.deepEqual(JSON.parse(String(updatedCall.options.body)), { name: 'Renamed project', domain: null });
  const rows = f.node('#project-list').children;
  assert.equal(rows.length, 3);
  assert.equal(rows[1].children[0].textContent, 'Renamed project');
  assert.equal(rows[1].children[1].textContent, '—');
  assert.equal(rows[2].children[0].textContent, 'Second project');
  assert.equal(editButton(f, 1).focused, true);
  assert.equal(title.textContent, 'New project');
  assert.equal(name.value, '');
  assert.equal(domain.value, '');
});

test('failed edit keeps the draft, locks controls while pending, and can be retried', async t => {
  let finish!: (response: Response) => void;
  let failNext = true;
  const f = await fixture(t, (url, options) => {
    if (new URL(url).pathname === '/auth/me') return Response.json({ user: { id: 'account' } });
    if (new URL(url).pathname === '/projects/endpoint') return defaultResponse(url, options);
    if (options.method === 'GET') return Response.json({ projects: [originalProject] });
    if (failNext) return new Promise<Response>(resolve => { finish = resolve; });
    const requested = JSON.parse(String(options.body));
    return Response.json({ project: { ...originalProject, name: requested.name, domain: requested.domain } });
  });
  const name = f.node('#project-name');
  const domain = f.node('#project-domain');
  await editButton(f, 0).fire('click');
  name.value = 'Draft name';
  domain.value = 'draft.example';
  const submitted = f.node('#project-form').fire('submit');
  assert.equal(f.node('#project-create').disabled, true);
  assert.equal(domain.disabled, true);
  assert.equal(editButton(f, 0).disabled, true);
  let prevented = false;
  await f.node('#project-dialog').fire('cancel', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  failNext = false;
  finish(Response.json({ error: 'unavailable' }, { status: 503 }));
  await submitted;
  assert.equal(f.node('#project-error').hidden, false);
  assert.match(f.node('#project-error').textContent, /Could not save/);
  assert.equal(name.value, 'Draft name');
  assert.equal(domain.value, 'draft.example');
  assert.equal(f.node('#project-create').disabled, false);
  assert.equal(domain.disabled, false);
  await f.node('#project-form').fire('submit');
  assert.equal(f.node('#project-list').children.length, 1);
  assert.equal(f.node('#project-list').children[0].children[0].textContent, 'Draft name');
  assert.equal(f.node('#project-list').children[0].children[1].textContent, 'draft.example');
});

test('a 401 during edit disposes the page and redirects to login', async t => {
  const f = await fixture(t, (url, options) => {
    if (new URL(url).pathname === '/auth/me') return Response.json({ user: { id: 'account' } });
    if (new URL(url).pathname === '/projects/endpoint') return defaultResponse(url, options);
    if (options.method === 'GET') return Response.json({ projects: [originalProject] });
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  });
  const staleEdit = editButton(f, 0);
  await staleEdit.fire('click');
  f.node('#project-name').value = 'Private draft';
  await f.node('#project-form').fire('submit');
  assert.deepEqual(f.redirects, ['/login/?returnTo=%2Fprojects%2F']);
  assert.equal(f.node('#project-list').children.length, 0);
  assert.equal(f.node('#project-new').disabled, true);
  await staleEdit.fire('click');
  assert.equal(f.node('#project-dialog').open, false);
});

test('preview shows configured safe URLs and marks unavailable endpoints', async t => {
  const f = await fixture(t, (url, options) => {
    if (new URL(url).pathname === '/auth/me') return Response.json({ user: { id: 'account' } });
    if (options.method === 'GET' && new URL(url).pathname === '/projects') return Response.json({ projects: [originalProject, secondProject] });
    const projectId = new URL(url).searchParams.get('id');
    const offline = projectId === 'project-2';
    const host = offline ? `p-${'b'.repeat(32)}` : `p-${'a'.repeat(32)}`;
    return Response.json({ endpoint: { projectId, url: `https://${host}.mainbrella.dev/`, target: { kind: 'container', id: 'container-1', createdAt: '2026-01-01T00:00:00.000Z', port: 3000 }, backendStatus: offline ? 'unavailable' : 'running' }, domains: [], hosting: { supported: true, customDomains: true, apexIps: [] } });
  });
  const rows = f.node('#project-list').children;
  const link = rows[0].children[2].children[0];
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener');
  assert.match(link.href, /^https:\/\/p-a{32}\.mainbrella\.dev\/$/);
  assert.equal(rows[1].children[2].children[0].textContent, `https://p-${'b'.repeat(32)}.mainbrella.dev/`);
  assert.equal(rows[1].children[2].children[1].textContent, 'Unavailable');
});

test('preview lookup failures stay local and can be retried', async t => {
  let fail = true;
  const f = await fixture(t, (url, options) => {
    if (new URL(url).pathname === '/auth/me') return Response.json({ user: { id: 'account' } });
    if (new URL(url).pathname === '/projects' && options.method === 'GET') return Response.json({ projects: [originalProject] });
    if (new URL(url).pathname === '/projects/endpoint' && fail) return Response.json({ error: 'unavailable' }, { status: 503 });
    return Response.json({ endpoint: { projectId: 'project-1', url: 'https://p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mainbrella.dev/', target: null, backendStatus: 'unlinked' }, domains: [], hosting: { supported: true, customDomains: true, apexIps: [] } });
  });
  const row = f.node('#project-list').children[0];
  const retryPreview = row.children[2].children[1];
  assert.equal(row.children[0].textContent, 'First project');
  assert.equal(row.children[2].children[0].textContent, 'Could not load');
  fail = false;
  await retryPreview.fire('click');
  await f.flush();
  assert.equal(row.children[2].textContent, 'Not set');
  assert.equal(f.node('#projects-error').hidden, true);
});

test('unsafe configured preview URLs show a retryable error, not an unset state', async t => {
  const f = await fixture(t, (url, options) => {
    if (new URL(url).pathname === '/auth/me') return Response.json({ user: { id: 'account' } });
    if (new URL(url).pathname === '/projects' && options.method === 'GET') return Response.json({ projects: [originalProject] });
    return Response.json({ endpoint: { projectId: 'project-1', url: 'javascript:alert(1)', target: { kind: 'container', id: 'container-1', createdAt: '2026-01-01T00:00:00.000Z', port: 3000 }, backendStatus: 'running' }, domains: [], hosting: { supported: true, customDomains: true, apexIps: [] } });
  });
  const preview = f.node('#project-list').children[0].children[2];
  assert.equal(preview.children[0].textContent, 'Could not load');
  assert.equal(preview.children[1].textContent, 'Retry');
});

test('sign-out aborts pending preview lookups and ignores their late responses', async t => {
  let finishPreview!: (response: Response) => void;
  let previewSignal: AbortSignal | undefined;
  const f = await fixture(t, (url, options) => {
    if (new URL(url).pathname === '/auth/me') return Response.json({ user: { id: 'account' } });
    if (new URL(url).pathname === '/projects/endpoint' && new URL(url).searchParams.get('id') === 'project-1') {
      previewSignal = options.signal as AbortSignal;
      return new Promise<Response>(resolve => { finishPreview = resolve; });
    }
    if (new URL(url).pathname === '/projects/endpoint') return defaultResponse(url, options);
    if (options.method === 'GET') return Response.json({ projects: [originalProject, secondProject] });
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  });
  const submit = editButton(f, 0).fire('click').then(() => {
    f.node('#project-name').value = 'Private draft';
    return f.node('#project-form').fire('submit');
  });
  await submit;
  assert.deepEqual(f.redirects, ['/login/?returnTo=%2Fprojects%2F']);
  assert.equal(previewSignal?.aborted, true);
  finishPreview(Response.json({ endpoint: { projectId: 'project-1', url: `https://p-${'a'.repeat(32)}.mainbrella.dev/`, target: { kind: 'container', id: 'container-1', createdAt: '2026-01-01T00:00:00.000Z', port: 3000 }, backendStatus: 'running' }, domains: [], hosting: { supported: true, customDomains: true, apexIps: [] } }));
  await f.flush();
  assert.equal(f.node('#project-list').children.length, 0);
});

const builderProject = { ...originalProject, build_app_id: originalProject.id, git_version_id: 'version-1' };
const savedVersion = { id: 'version-1', commitId: 'a'.repeat(40), parentVersionId: null, message: 'First saved build', verified: true, createdAt: '2026-10-01T12:00:00Z' };

test('Builder projects link to their workspace and Git stays optional for standalone creation and edits', async t => {
  const f = await fixture(t, (url, options) => {
    if (new URL(url).pathname === '/projects' && options.method === 'GET') return Response.json({ projects: [builderProject, secondProject] });
    if (options.method === 'PATCH') {
      const fields = JSON.parse(String(options.body));
      return Response.json({ project: { ...secondProject, ...fields, build_app_id: secondProject.id, git_version_id: null } });
    }
    return defaultResponse(url, options);
  });
  const rows = f.node('#project-list').children;
  assert.equal(rows[0].children[0].children[0].href, '/build/?app=project-1');
  assert.equal(rows[0].children[3].children[0].textContent, 'History');
  await editButton(f, 0).fire('click');
  assert.equal(f.node('#project-git-option').hidden, true);
  await f.node('#project-cancel').fire('click');
  await rows[1].children[3].children[0].fire('click');
  assert.equal(f.node('#project-git-option').hidden, false);
  assert.equal(f.node('#project-git').checked, true);
  await f.node('#project-form').fire('submit');
  const update = f.calls.find(call => call.options.method === 'PATCH')!;
  assert.deepEqual(JSON.parse(String(update.options.body)), { name: 'Second project', domain: null, git: true });
  assert.equal(f.node('#project-list').children[1].children[3].children[0].textContent, 'History');
  await f.node('#project-new').fire('click');
  assert.equal(f.node('#project-git').checked, false);
  f.node('#project-name').value = 'Optional Git';
  f.node('#project-git').checked = true;
  await f.node('#project-form').fire('submit');
  const create = f.calls.find(call => call.options.method === 'POST')!;
  assert.equal(JSON.parse(String(create.options.body)).git, true);
});

test('Git history reuses saved versions and downloads an authenticated complete repository', async t => {
  let failDownload = true;
  let downloaded: Blob | undefined;
  t.mock.method(URL, 'createObjectURL', (blob: Blob) => { downloaded = blob; return 'blob:test-project'; });
  t.mock.method(URL, 'revokeObjectURL', () => {});
  const f = await fixture(t, (url, options) => {
    const path = new URL(url).pathname;
    if (path === '/projects' && options.method === 'GET') return Response.json({ projects: [builderProject] });
    if (path.endsWith('/versions')) return Response.json({ versions: [savedVersion], versionId: savedVersion.id, verifiedVersionId: savedVersion.id });
    if (path.endsWith('/repository')) return failDownload ? Response.json({ error: 'storage_export_busy' }, { status: 429 }) : new Response(new Uint8Array([0, 255, 1]));
    return defaultResponse(url, options);
  });
  await f.node('#project-list').children[0].children[3].children[0].fire('click');
  await f.flush();
  assert.equal(f.node('#project-git-dialog').open, true);
  assert.equal(f.node('#project-git-versions').children[0].children[0].textContent, 'First saved build');
  assert.match(f.node('#project-git-versions').children[0].children[1].textContent, /aaaaaaaa.*Verified/);
  assert.equal(f.node('#project-git-download').disabled, false);
  await f.node('#project-git-download').fire('click');
  assert.equal(f.node('#project-git-error').hidden, false);
  assert.equal(f.node('#project-git-download').disabled, false);
  failDownload = false;
  await f.node('#project-git-download').fire('click');
  assert.equal(f.node('#project-git-status').textContent, 'Repository downloaded.');
  assert.deepEqual(new Uint8Array(await downloaded!.arrayBuffer()), new Uint8Array([0, 255, 1]));
  const download = f.created.find(element => element.download === 'project.bundle')!;
  assert.equal(download.href, 'blob:test-project');
  const repository = f.calls.find(call => new URL(call.url).pathname.endsWith('/repository'))!;
  assert.equal(repository.options.credentials, 'include');
});

test('empty Git history cannot download and history failures can be retried', async t => {
  let fail = true;
  const f = await fixture(t, (url, options) => {
    const path = new URL(url).pathname;
    if (path === '/projects' && options.method === 'GET') return Response.json({ projects: [builderProject] });
    if (path.endsWith('/versions')) return fail ? Response.json({ error: 'unavailable' }, { status: 503 }) : Response.json({ versions: [], versionId: null, verifiedVersionId: null });
    return defaultResponse(url, options);
  });
  await f.node('#project-list').children[0].children[3].children[0].fire('click');
  await f.flush();
  assert.equal(f.node('#project-git-error').hidden, false);
  assert.equal(f.node('#project-git-retry').hidden, false);
  assert.equal(f.node('#project-git-download').disabled, true);
  fail = false;
  await f.node('#project-git-retry').fire('click');
  await f.flush();
  assert.match(f.node('#project-git-status').textContent, /No saved versions yet/);
  assert.equal(f.node('#project-git-download').disabled, true);
  assert.equal(f.node('#project-git-clone').hidden, true);
});

test('closing history or losing the session ignores pending private Git responses', async t => {
  let finish!: (response: Response) => void;
  let signal: AbortSignal | undefined;
  let expire = false;
  const f = await fixture(t, (url, options) => {
    const path = new URL(url).pathname;
    if (path === '/projects' && options.method === 'GET') return Response.json({ projects: [builderProject] });
    if (path.endsWith('/versions')) {
      signal = options.signal as AbortSignal;
      return expire ? Response.json({ error: 'not_authenticated' }, { status: 401 }) : new Promise(resolve => { finish = resolve; });
    }
    return defaultResponse(url, options);
  });
  await f.node('#project-list').children[0].children[3].children[0].fire('click');
  await f.node('#project-git-close').fire('click');
  finish(Response.json({ versions: [savedVersion], versionId: savedVersion.id, verifiedVersionId: savedVersion.id }));
  await f.flush();
  assert.equal(f.node('#project-git-versions').children.length, 0);
  expire = true;
  await f.node('#project-list').children[0].children[3].children[0].fire('click');
  await f.flush();
  assert.equal(signal?.aborted, true);
  assert.equal(f.node('#project-git-dialog').open, false);
  assert.equal(f.node('#project-list').children.length, 0);
  assert.deepEqual(f.redirects, ['/login/?returnTo=%2Fprojects%2F']);
});
