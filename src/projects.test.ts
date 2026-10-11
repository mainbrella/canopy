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
  style: Record<string, string> = {};
  offsetWidth = 288;
  offsetHeight = 360;
  classList = { add: (name: string) => { this.className = `${this.className || ''} ${name}`.trim(); }, remove() {} };
  getBoundingClientRect() { return { top: 320, right: 1000, bottom: 364 }; }
  contains(node: Element | null): boolean { return node === this || this.children.some(child => child.contains(node)); }
  querySelector(selector: string): Element | null { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector: string): Element[] { return this.children.flatMap(child => [...(child.tagName === 'button' && !child.disabled && selector.startsWith('button') ? [child] : []), ...child.querySelectorAll(selector)]); }
  addEventListener(type: string, callback: (event: any) => unknown) { this.listeners.set(type, callback); }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  removeAttribute(key: string) { this.attributes.delete(key); }
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren(...children: Element[]) { this.children = children; }
  reportValidity() { return true; }
  focus() { if (!this.disabled) { this.focused = true; (document as any).activeElement = this; } }
  showModal() { this.open = true; }
  close() { this.open = false; void this.fire('close'); }
  async fire(type: string, event: any = { preventDefault() {} }) { return this.listeners.get(type)?.(event); }
  click() { void this.fire('click'); }
}

const originalProject = { id: 'project-1', name: 'First project', domain: 'example.com', created_at: '2026-01-01T00:00:00Z' };
const secondProject = { id: 'project-2', name: 'Second project', created_at: '2026-01-02T00:00:00Z' };

async function fixture(t: TestContext, respond: (url: string, options: RequestInit) => Promise<Response> | Response = defaultResponse, search = '') {
  const nodes = new Map<string, Element>();
  const node = (selector: string) => {
    if (!nodes.has(selector)) nodes.set(selector, new Element());
    return nodes.get(selector)!;
  };
  const name = node('#project-name');
  const domain = node('#project-domain');
  node('#project-form').reset = () => { name.value = ''; domain.value = ''; node('#project-git').checked = false; };
  node('#github-form').reset = () => {};
  const calls: { url: string; options: RequestInit }[] = [];
  const created: Element[] = [];
  const redirects: string[] = [];
  const history: string[] = [];
  const events = new Map<string, (event: any) => unknown>();
  t.after(() => events.get('pagehide')?.({}));
  const window = {
    localStorage: { getItem: () => 'accepted', setItem() {} },
    sessionStorage: { getItem: () => 'accepted', setItem() {} },
    location: { hostname: 'localhost', pathname: '/projects/', search, hash: '', replace: (url: string) => redirects.push(url) },
    innerWidth: 1280, innerHeight: 800,
    history: { replaceState: (_state: unknown, _title: string, url: string) => history.push(url) },
    addEventListener(type: string, callback: (event: any) => unknown) { events.set(type, callback); }, dispatchEvent() {},
  };
  const property = (key: string, value: unknown) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  };
  property('window', window);
  property('location', window.location);
  const documentEvents = new Map<string, (event: any) => unknown>();
  property('document', { querySelector: node, addEventListener: (type: string, callback: (event: any) => unknown) => documentEvents.set(type, callback), createElement: (tag: string) => { const element = new Element(); element.tagName = tag; created.push(element); return element; } });
  property('fetch', async (url: string, options: RequestInit) => {
    calls.push({ url, options });
    return respond(url, options);
  });
  await import(`./projects.ts?test=${++sequence}`);
  const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
  await flush();
  return { node: (selector: string) => node(selector), calls, redirects, history, flush, created, documentEvents, events, window };
}

function defaultResponse(url: string, options: RequestInit) {
  if (new URL(url).pathname === '/auth/me') return Response.json({ user: { id: 'account' } });
  if (new URL(url).pathname === '/projects/endpoint') return Response.json({ endpoint: { projectId: new URL(url).searchParams.get('id'), url: 'https://p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mainbrella.dev/', target: null, backendStatus: 'unlinked' }, domains: [], hosting: { supported: true, customDomains: true, apexIps: [] } });
  if (new URL(url).pathname === '/github/build/connect') return Response.json({ url: 'https://github.com/apps/mainbrella-build/installations/new?state=install' });
  if (new URL(url).pathname === '/github/build/repositories') return Response.json({ repositories: [{ id: 1, fullName: 'owner/repo', defaultBranch: 'main', private: true }], nextCursor: null });
  if (new URL(url).pathname === '/projects/github') return Response.json({ github: { repo: 'owner/repo', branch: 'main', commitId: 'a'.repeat(40), url: 'https://github.com/owner/repo' } });
  if (options.method === 'GET') return Response.json({ projects: [originalProject, secondProject] });
  if (options.method === 'PATCH') {
    const requested = JSON.parse(String(options.body));
    return Response.json({ project: { ...originalProject, name: requested.name, domain: requested.domain } });
  }
  return Response.json({ project: { id: 'project-3', ...JSON.parse(String(options.body)), created_at: '2026-01-03T00:00:00Z' } }, { status: 201 });
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
function descendants(element: Element): Element[] {
  return element.children.flatMap(child => [child, ...descendants(child)]);
}
function projectAction(f: Fixture, label: string, index = 0) {
  return descendants(f.node('#project-list').children[index]).find(child => child.textContent === label && child.tagName === 'button')!;
}
function manageButton(f: Fixture, index = 0) { return projectAction(f, 'Manage', index); }
function editButton(f: Fixture, index: number) { return projectAction(f, 'Edit details', index); }
function codeLink(f: Fixture, index = 0) {
  return descendants(f.node('#project-list').children[index]).find(child => child.textContent === 'Code')!;
}
function menuPanel(f: Fixture, index = 0) {
  return descendants(f.node('#project-list').children[index]).find(child => child.className === 'project-menu-panel')!;
}
function menuText(f: Fixture, className: string) {
  return descendants(menuPanel(f)).find(child => child.className === className)?.textContent;
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
  assert.equal(manageButton(f, 0).focused, true);

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
  assert.equal(manageButton(f, 1).focused, true);
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
  assert.equal(codeLink(f).textContent, 'Code');
  assert.equal(codeLink(f).href, '/projects/code/?project=project-1');
  assert.equal(codeLink(f).target, undefined);
  await editButton(f, 0).fire('click');
  assert.equal(f.node('#project-git-option').hidden, true);
  await f.node('#project-cancel').fire('click');
  await projectAction(f, 'Enable Git history', 1).fire('click');
  assert.equal(f.node('#project-git-option').hidden, false);
  assert.equal(f.node('#project-git').checked, true);
  await f.node('#project-form').fire('submit');
  const update = f.calls.find(call => call.options.method === 'PATCH')!;
  assert.deepEqual(JSON.parse(String(update.options.body)), { name: 'Second project', domain: null, git: true });
  assert.equal(codeLink(f, 1).textContent, 'Code');
  await f.node('#project-new').fire('click');
  assert.equal(f.node('#project-git').checked, false);
  f.node('#project-name').value = 'Optional Git';
  f.node('#project-git').checked = true;
  await f.node('#project-form').fire('submit');
  const create = f.calls.find(call => call.options.method === 'POST')!;
  assert.equal(JSON.parse(String(create.options.body)).git, true);
});

test('projects with Git code and no Builder link still expose a standalone Code link', async t => {
  const f = await fixture(t, (url, options) => {
    if (new URL(url).pathname === '/projects' && options.method === 'GET') {
      return Response.json({ projects: [{ ...originalProject, git_version_id: 'saved-head' }] });
    }
    return defaultResponse(url, options);
  });
  const row = f.node('#project-list').children[0];
  assert.equal(row.children[0].textContent, originalProject.name);
  assert.equal(row.children[0].children.length, 0);
  const code = codeLink(f);
  assert.equal(code.textContent, 'Code');
  assert.equal(code.href, '/projects/code/?project=project-1');
  assert.equal(code.attributes.get('aria-label'), 'Browse source code for First project');
  await editButton(f, 0).fire('click');
  assert.equal(f.node('#project-git-option').hidden, true);
  assert.equal(f.calls.some(call => new URL(call.url).pathname.startsWith('/build/')), false);
});

test('GitHub installation starts without a repository URL or branch', async t => {
  const f = await fixture(t, (url, options) => new URL(url).pathname === '/github/build/repositories'
    ? Response.json({ error: 'github_connection_required' }, { status: 400 }) : defaultResponse(url, options));
  const connect = projectAction(f, 'Connect GitHub');
  await connect.fire('click');
  assert.equal(f.node('#github-dialog').open, true);
  assert.equal(f.node('#github-branch').value, 'main');
  assert.equal(f.node('#github-picker').hidden, true);
  assert.equal(f.node('#github-submit').textContent, 'Install GitHub app');
  assert.equal(f.node('#github-error').hidden, true);
  await f.node('#github-form').fire('submit');
  const call = f.calls.find(item => new URL(item.url).pathname === '/github/build/connect')!;
  const body = JSON.parse(String(call.options.body));
  assert.equal(body.repo, undefined);
  assert.equal(body.branch, undefined);
  assert.equal(body.projectId, 'project-1');
  const returnTo = new URL(body.returnTo, 'https://mainbrella.com');
  assert.equal(returnTo.pathname, '/projects/');
  assert.equal(returnTo.searchParams.get('githubProject'), 'project-1');
  assert.equal(returnTo.searchParams.has('githubRepo'), false);
  assert.match(f.redirects[0], /^https:\/\/github\.com\/apps\/mainbrella-build\/installations\/new/);
});

test('OAuth return requires an explicit final link and refreshes the row after success', async t => {
  let linkedProject: any = null;
  const f = await fixture(t, (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/projects' && options.method === 'GET') return Response.json({ projects: [linkedProject ?? originalProject] });
    if (parsed.pathname === '/projects/github' && options.method === 'PUT') {
      const input = JSON.parse(String(options.body));
      linkedProject = { ...originalProject, git_version_id: null, github_repo: input.repo, github_branch: input.branch, github_commit_id: 'a'.repeat(40) };
      return Response.json({ github: { repo: input.repo, branch: input.branch, commitId: 'a'.repeat(40), url: `https://github.com/${input.repo}` } });
    }
    return defaultResponse(url, options);
  }, '?githubProject=project-1&github=connected');
  await f.flush();
  assert.equal(f.node('#github-dialog').open, true);
  assert.equal(f.node('#github-repo').value, 'owner/repo');
  assert.equal(f.node('#github-submit').textContent, 'Link repository');
  assert.equal(f.node('#github-picker').hidden, false);
  assert.deepEqual(f.history, ['/projects/']);
  assert.equal(f.calls.some(call => new URL(call.url).pathname === '/projects/github'), false);
  await f.node('#github-form').fire('submit');
  const link = f.calls.find(call => new URL(call.url).pathname === '/projects/github')!;
  assert.equal(link.options.method, 'PUT');
  assert.deepEqual(JSON.parse(String(link.options.body)), { repo: 'owner/repo', branch: 'main' });
  const gitCell = f.node('#project-list').children[0].children[3];
  assert.equal(gitCell.children[0].children[0].textContent, 'owner/repo');
  assert.equal(gitCell.children[0].href, 'https://github.com/owner/repo');
  assert.equal(codeLink(f).textContent, 'Code');
  assert.equal(codeLink(f).href, 'https://github.com/owner/repo/tree/main');
  assert.equal(codeLink(f).target, '_blank');
  assert.equal(codeLink(f).rel, 'noopener');
  assert.equal(gitCell.children[0].children[1].textContent, 'GitHub · main');
  assert.equal(projectAction(f, 'Reconnect GitHub access').textContent, 'Reconnect GitHub access');
  assert.equal(linkedProject.git_version_id, null);
  assert.ok(f.calls.filter(call => new URL(call.url).pathname === '/projects' && call.options.method === 'GET').length >= 2);
  await projectAction(f, 'Reconnect GitHub access').fire('click');
  assert.equal(f.node('#github-picker').hidden, true);
  assert.equal(f.node('#github-submit').textContent, 'Install GitHub app');
});

test('GitHub Code links follow branch paths and editing clarifies retained storage charges', async t => {
  const f = await fixture(t, (url, options) => {
    if (new URL(url).pathname === '/projects' && options.method === 'GET') return Response.json({ projects: [{ ...originalProject, github_repo: 'owner/repo', github_branch: 'feature/spinner' }] });
    return defaultResponse(url, options);
  });
  assert.equal(codeLink(f).href, 'https://github.com/owner/repo/tree/feature/spinner');
  await editButton(f, 0).fire('click');
  assert.equal(f.node('#project-git-option').hidden, true);
  assert.match(f.node('#project-git-note').textContent, /GitHub.*Mainbrella.*storage charges/);
  await f.node('#project-cancel').fire('click');
});

const linkedProject = { ...originalProject, build_app_id: originalProject.id, github_repo: 'owner/repo', github_branch: 'main', github_commit_id: 'a'.repeat(40), github_storage: 'retained' };
function storageButton(f: Awaited<ReturnType<typeof fixture>>) {
  return projectAction(f, 'Delete Mainbrella copy');
}

test('linked projects show both copies and require explicit confirmation to delete Mainbrella storage', async t => {
  const f = await fixture(t, (url, options) => new URL(url).pathname === '/projects' && options.method === 'GET'
    ? Response.json({ projects: [linkedProject] }) : defaultResponse(url, options));
  assert.equal(menuText(f, 'project-menu-detail'), 'main · aaaaaaa');
  assert.equal(menuText(f, 'project-storage-state'), 'Mainbrella copy · stored');
  assert.match(menuText(f, 'project-storage-note')!, /storage charges/);
  assert.match(storageButton(f).className, /button-danger/);
  await storageButton(f).fire('click');
  assert.equal(f.node('#project-storage-dialog').open, true);
  assert.equal(f.node('#project-storage-name').textContent, linkedProject.name);
  assert.equal(f.node('#project-storage-github').href, 'https://github.com/owner/repo/tree/main');
  assert.equal(f.node('#project-storage-cancel').focused, true);
  await f.node('#project-storage-cancel').fire('click');
  assert.equal(f.calls.some(call => call.options.method === 'DELETE'), false);
  assert.equal(manageButton(f).focused, true);
});

test('confirmed deletion locks controls and preserves the project’s Builder and GitHub links', async t => {
  let finish!: (response: Response) => void;
  const f = await fixture(t, (url, options) => {
    if (new URL(url).pathname === '/projects' && options.method === 'GET') return Response.json({ projects: [linkedProject] });
    if (new URL(url).pathname === '/projects/github/storage') return new Promise<Response>(resolve => { finish = resolve; });
    return defaultResponse(url, options);
  });
  await storageButton(f).fire('click');
  const deletion = f.node('#project-storage-delete').fire('click');
  assert.equal(f.node('#project-storage-delete').disabled, true);
  assert.equal(storageButton(f).disabled, true);
  assert.equal(editButton(f, 0).disabled, true);
  let prevented = false;
  await f.node('#project-storage-dialog').fire('cancel', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  finish(Response.json({ storage: 'github', github: { commitId: linkedProject.github_commit_id } }));
  await deletion;
  const deletedCall = f.calls.find(call => call.options.method === 'DELETE')!;
  assert.match(deletedCall.url, /\/projects\/github\/storage\?id=project-1$/);
  assert.equal(deletedCall.options.credentials, 'include');
  assert.equal(f.node('#project-storage-dialog').open, false);
  const row = f.node('#project-list').children[0];
  assert.equal(row.children[0].children[0].href, '/build/?app=project-1');
  assert.equal(row.children[3].children[0].href, 'https://github.com/owner/repo');
  assert.equal(menuText(f, 'project-storage-state'), 'Mainbrella copy · deleted');
  assert.equal(storageButton(f), undefined);
  assert.match(f.node('#projects-status').textContent, /stays in Builder/);
});

test('unpushed changes keep the copy and show a nearby retryable error', async t => {
  const f = await fixture(t, (url, options) => {
    if (new URL(url).pathname === '/projects' && options.method === 'GET') return Response.json({ projects: [linkedProject] });
    if (new URL(url).pathname === '/projects/github/storage') return Response.json({ error: 'github_source_not_pushed' }, { status: 409 });
    return defaultResponse(url, options);
  });
  await storageButton(f).fire('click');
  await f.node('#project-storage-delete').fire('click');
  assert.equal(f.node('#project-storage-dialog').open, true);
  assert.equal(f.node('#project-storage-error').hidden, false);
  assert.match(f.node('#project-storage-error').textContent, /not fully pushed.*copy was kept/);
  assert.equal(storageButton(f).disabled, false);
});

test('queued cleanup stays visible without claiming storage billing has stopped', async t => {
  const f = await fixture(t, (url, options) => {
    if (new URL(url).pathname === '/projects' && options.method === 'GET') return Response.json({ projects: [linkedProject] });
    if (new URL(url).pathname === '/projects/github/storage') return Response.json({ storage: 'deleting' }, { status: 202 });
    return defaultResponse(url, options);
  });
  await storageButton(f).fire('click');
  await f.node('#project-storage-delete').fire('click');
  const cell = f.node('#project-list').children[0].children[3];
  assert.equal(cell.children[1].textContent, 'Storage cleanup pending');
  assert.equal(menuText(f, 'project-storage-state'), 'Mainbrella copy · deleting…');
  assert.equal(menuText(f, 'project-storage-note'), 'Storage charges stop once cleanup finishes.');
  assert.equal(projectAction(f, 'Deleting copy…').disabled, true);
  assert.match(f.node('#projects-status').textContent, /retry automatically/);
});

test('expired GitHub access can be reauthorized without losing the repository draft', async t => {
  const f = await fixture(t, (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/projects' && options.method === 'GET') return Response.json({ projects: [originalProject] });
    if (parsed.pathname === '/projects/github' && options.method === 'PUT') return Response.json({ error: 'github_connection_required' }, { status: 409 });
    return defaultResponse(url, options);
  }, '?githubProject=project-1&github=connected&githubRepo=owner%2Frepo&githubBranch=feature%2Fsync');
  await f.flush();
  await f.node('#github-form').fire('submit');
  assert.equal(f.node('#github-repo').value, 'owner/repo');
  assert.equal(f.node('#github-branch').value, 'feature/sync');
  assert.equal(f.node('#github-submit').textContent, 'Install GitHub app');
  assert.match(f.node('#github-status').textContent, /access expired/i);
  await f.node('#github-form').fire('submit');
  const authorization = f.calls.filter(call => new URL(call.url).pathname === '/github/build/connect').at(-1)!;
  assert.equal(JSON.parse(String(authorization.options.body)).reauthorize, true);
});

test('connected users pick authorized repositories and their default branch without reinstalling', async t => {
  const f = await fixture(t, (url, options) => new URL(url).pathname === '/github/build/repositories'
    ? Response.json({ repositories: [
      { id: 1, fullName: 'personal/site', defaultBranch: 'main', private: true },
      { id: 2, fullName: 'organization/website', defaultBranch: 'master', private: false },
    ], nextCursor: null }) : defaultResponse(url, options));
  await projectAction(f, 'Connect GitHub').fire('click');
  assert.equal(f.node('#github-repo').value, '');
  assert.equal(f.node('#github-submit').disabled, true);
  f.node('#github-repo').value = 'organization/website';
  await f.node('#github-repo').fire('change');
  assert.equal(f.node('#github-branch').value, 'master');
  assert.equal(f.node('#github-submit').disabled, false);
  assert.equal(f.calls.some(call => new URL(call.url).pathname === '/github/build/connect'), false);
  await f.node('#github-manage').fire('click');
  assert.equal(f.redirects.length, 1);
  assert.equal(JSON.parse(String(f.calls.at(-1)!.options.body)).repo, undefined);
});

test('repository pagination preserves selection and a custom migration branch', async t => {
  const f = await fixture(t, (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/github/build/repositories') return parsed.searchParams.has('cursor')
      ? Response.json({ repositories: [{ id: 2, fullName: 'org/site', defaultBranch: 'master', private: false }], nextCursor: null })
      : Response.json({ repositories: [{ id: 1, fullName: 'owner/repo', defaultBranch: 'main', private: true }], nextCursor: '1:0:2' });
    return defaultResponse(url, options);
  }, '?githubProject=project-1&github=connected');
  assert.equal(f.node('#github-more').hidden, false);
  f.node('#github-branch').value = 'builder/migration';
  await f.node('#github-more').fire('click');
  assert.equal(f.node('#github-repo').children.length, 3);
  assert.equal(f.node('#github-repo').value, 'owner/repo');
  assert.equal(f.node('#github-branch').value, 'builder/migration');
  assert.equal(f.node('#github-more').hidden, true);
});

test('empty repository access offers installation management and cannot link', async t => {
  const f = await fixture(t, (url, options) => new URL(url).pathname === '/github/build/repositories'
    ? Response.json({ repositories: [], nextCursor: null }) : defaultResponse(url, options), '?githubProject=project-1&github=connected');
  assert.equal(f.node('#github-submit').disabled, true);
  assert.equal(f.node('#github-manage').hidden, false);
  assert.match(f.node('#github-status').textContent, /No writable repositories/);
  await f.node('#github-manage').fire('click');
  assert.match(f.redirects[0], /github.com\/apps\/mainbrella-build\/installations\/new/);
});

test('closing the picker ignores a pending private repository response', async t => {
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>(done => { resolve = done; });
  const f = await fixture(t, (url, options) => new URL(url).pathname === '/github/build/repositories' ? pending : defaultResponse(url, options));
  const opening = projectAction(f, 'Connect GitHub').fire('click');
  assert.equal(f.node('#github-cancel').disabled, false);
  await f.node('#github-cancel').fire('click');
  resolve(Response.json({ repositories: [{ id: 1, fullName: 'private/secret', defaultBranch: 'main' }], nextCursor: null }));
  await opening;
  assert.equal(f.node('#github-dialog').open, false);
  assert.equal(f.node('#github-repo').children.length, 0);
});

test('reconnect return verifies write access before reporting success', async t => {
  const f = await fixture(t, (url, options) => {
    if (new URL(url).pathname === '/projects' && options.method === 'GET') return Response.json({ projects: [{ ...originalProject, github_repo: 'owner/repo', github_branch: 'main' }] });
    if (new URL(url).pathname === '/projects/github') return Response.json({ error: 'github_write_access_required' }, { status: 403 });
    return defaultResponse(url, options);
  }, '?githubProject=project-1&github=connected');
  assert.equal(f.node('#github-dialog').open, true);
  assert.match(f.node('#github-error').textContent, /write access/);
  assert.notEqual(f.node('#projects-status').textContent, 'GitHub access updated.');
});


test('Manage isolates each project’s actions, closes on dismissal, and restores focus', async t => {
  const f = await fixture(t);
  const first = manageButton(f);
  const second = manageButton(f, 1);
  const firstPanel = menuPanel(f);
  const secondPanel = menuPanel(f, 1);
  assert.equal(firstPanel.hidden, true);
  assert.equal(first.attributes.get('aria-expanded'), 'false');
  assert.equal(first.attributes.get('aria-controls'), firstPanel.id);
  assert.equal(f.calls.some(call => new URL(call.url).pathname === '/github/build/repositories'), false);
  await first.fire('click');
  assert.equal(firstPanel.hidden, false);
  assert.equal(first.attributes.get('aria-expanded'), 'true');
  assert.equal(secondPanel.hidden, true);
  await second.fire('click');
  assert.equal(firstPanel.hidden, true);
  assert.equal(first.attributes.get('aria-expanded'), 'false');
  assert.equal(secondPanel.hidden, false);
  f.documentEvents.get('keydown')!({ key: 'Escape', preventDefault() {} });
  assert.equal(secondPanel.hidden, true);
  assert.equal((document as any).activeElement, second);
  await first.fire('click');
  f.documentEvents.get('click')!({ target: f.node('#main') });
  assert.equal(firstPanel.hidden, true);
  await second.fire('click');
  await editButton(f, 1).fire('click');
  assert.equal(secondPanel.hidden, true);
  assert.equal(f.node('#project-name').value, 'Second project');
  await f.node('#project-cancel').fire('click');
  assert.equal((document as any).activeElement, second);
});

test('keyboard navigation reaches management actions and skips unavailable storage deletion', async t => {
  const f = await fixture(t, (url, options) => new URL(url).pathname === '/projects' && options.method === 'GET'
    ? Response.json({ projects: [{ ...linkedProject, github_commit_id: null }] }) : defaultResponse(url, options));
  const toggle = manageButton(f);
  const panel = menuPanel(f);
  await toggle.fire('keydown', { key: 'ArrowDown', preventDefault() {} });
  assert.equal(panel.hidden, false);
  assert.equal((document as any).activeElement, editButton(f, 0));
  await panel.fire('keydown', { key: 'ArrowDown', preventDefault() {} });
  assert.equal((document as any).activeElement, projectAction(f, 'Hosting & domains'));
  await panel.fire('keydown', { key: 'End', preventDefault() {} });
  assert.equal((document as any).activeElement, projectAction(f, 'Reconnect GitHub access'));
  assert.equal(storageButton(f).disabled, true);
  await storageButton(f).fire('click');
  assert.equal(f.node('#project-storage-dialog').open, undefined);
  await panel.fire('keydown', { key: 'ArrowDown', preventDefault() {} });
  assert.equal((document as any).activeElement, editButton(f, 0));
});

test('opening Hosting from Manage targets that project and returns focus to its visible trigger', async t => {
  const f = await fixture(t);
  await manageButton(f, 1).fire('click');
  await projectAction(f, 'Hosting & domains', 1).fire('click');
  await f.flush();
  assert.equal(menuPanel(f, 1).hidden, true);
  assert.equal(f.node('#endpoint-dialog').open, true);
  assert.equal(f.node('#endpoint-title').textContent, 'Endpoint · Second project');
  await f.node('#endpoint-close').fire('click');
  assert.equal((document as any).activeElement, manageButton(f, 1));
});
