import { API_ORIGIN, createAuthClient } from './auth.ts';
import { createProjectHosting, createProjectHostingClient, safeEndpointUrl } from './project-hosting.ts';

interface Project { id: string; name: string; domain?: string | null; created_at: string; build_app_id?: string | null; git_version_id?: string | null; github_repo?: string | null; github_branch?: string | null; github_commit_id?: string | null }

const auth = createAuthClient();
const main = document.querySelector<HTMLElement>('#main')!;
const status = document.querySelector<HTMLElement>('#projects-status')!;
const error = document.querySelector<HTMLElement>('#projects-error')!;
const retry = document.querySelector<HTMLButtonElement>('#projects-retry')!;
const list = document.querySelector<HTMLTableSectionElement>('#project-list')!;
const newProject = document.querySelector<HTMLButtonElement>('#project-new')!;
const dialog = document.querySelector<HTMLDialogElement>('#project-dialog')!;
const form = document.querySelector<HTMLFormElement>('#project-form')!;
const name = document.querySelector<HTMLInputElement>('#project-name')!;
const domain = document.querySelector<HTMLInputElement>('#project-domain')!;
const git = document.querySelector<HTMLInputElement>('#project-git')!;
const gitOption = document.querySelector<HTMLElement>('#project-git-option')!;
const gitNote = document.querySelector<HTMLElement>('#project-git-note')!;
const create = document.querySelector<HTMLButtonElement>('#project-create')!;
const cancel = document.querySelector<HTMLButtonElement>('#project-cancel')!;
const formError = document.querySelector<HTMLElement>('#project-error')!;
const formStatus = document.querySelector<HTMLElement>('#project-status')!;
const dialogTitle = document.querySelector<HTMLElement>('#project-dialog-title')!;
const githubDialog = document.querySelector<HTMLDialogElement>('#github-dialog')!;
const githubForm = document.querySelector<HTMLFormElement>('#github-form')!;
const githubRepo = document.querySelector<HTMLSelectElement>('#github-repo')!;
const githubBranch = document.querySelector<HTMLInputElement>('#github-branch')!;
const githubSubmit = document.querySelector<HTMLButtonElement>('#github-submit')!;
const githubCancel = document.querySelector<HTMLButtonElement>('#github-cancel')!;
const githubError = document.querySelector<HTMLElement>('#github-error')!;
const githubStatus = document.querySelector<HTMLElement>('#github-status')!;
const githubTitle = document.querySelector<HTMLElement>('#github-dialog-title')!;
const githubNote = document.querySelector<HTMLElement>('#github-note')!;
const githubPicker = document.querySelector<HTMLElement>('#github-picker')!;
const githubInstallNote = document.querySelector<HTMLElement>('#github-install-note')!;
const githubManage = document.querySelector<HTMLButtonElement>('#github-manage')!;
const githubMore = document.querySelector<HTMLButtonElement>('#github-more')!;
const abort = new AbortController();
const previewClient = createProjectHostingClient({ onUnauthenticated: () => goToLogin(), signal: abort.signal });
const hosting = createProjectHosting({ onUnauthenticated: () => goToLogin(), onClose: refreshPreview });
let projects: Project[] = [];
let editButtons = new Map<string, HTMLButtonElement>();
let endpointButtons = new Map<string, HTMLButtonElement>();
let gitButtons = new Map<string, HTMLButtonElement>();
let previewCells = new Map<string, HTMLElement>();
type PreviewState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; url: string | null; configured: boolean; available: boolean };
const previews = new Map<string, PreviewState>();
const previewEpoch = new Map<string, number>();
let editingProject: Project | null = null;
let busy = false;
let authenticated = false;
let disposed = false;
let refreshOnClose = false;
let githubProject: Project | null = null;
let githubReauthorize = false;
let githubAuthorized = false;
let githubLoading = false;
let githubGeneration = 0;
let githubCursor: string | null = null;
interface GithubRepository { id: number; fullName: string; defaultBranch: string; private: boolean }
let githubRepositories: GithubRepository[] = [];
let githubActions = new Map<string, HTMLButtonElement>();
const builderURL = (id: string) => `/build/?${new URLSearchParams({ app: id })}`;

function goToLogin() {
  disposed = true;
  abort.abort();
  hosting.dispose();
  dialog.close();
  githubDialog.close();
  list.replaceChildren();
  controls();
  window.location.replace(`/login/?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
}

function controls() {
  main.setAttribute('aria-busy', String(busy));
  newProject.disabled = busy || disposed || !authenticated;
  retry.disabled = busy || disposed;
  name.disabled = domain.disabled = git.disabled = create.disabled = cancel.disabled = busy || disposed;
  for (const button of editButtons.values()) button.disabled = busy || disposed;
  for (const button of endpointButtons.values()) button.disabled = busy || disposed;
  for (const button of gitButtons.values()) button.disabled = busy || disposed;
  for (const button of githubActions.values()) button.disabled = busy || disposed;
  githubRepo.disabled = githubBranch.disabled = busy || disposed || githubLoading || !githubAuthorized;
  githubSubmit.disabled = busy || disposed || githubLoading || githubAuthorized && !githubRepo.value;
  githubCancel.disabled = busy || disposed;
  githubManage.disabled = githubMore.disabled = busy || disposed || githubLoading;
  form.setAttribute('aria-busy', String(busy));
  githubForm.setAttribute('aria-busy', String(busy));
}

function renderPreview(projectId: string) {
  const cell = previewCells.get(projectId);
  if (!cell) return;
  cell.replaceChildren();
  const preview = previews.get(projectId) ?? { kind: 'loading' as const };
  if (preview.kind === 'loading') {
    cell.textContent = 'Loading…';
    return;
  }
  if (preview.kind === 'error') {
    const label = document.createElement('span');
    label.textContent = 'Could not load';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dashboard-retry';
    button.textContent = 'Retry';
    button.setAttribute('aria-label', 'Retry preview URL');
    button.addEventListener('click', () => refreshPreview(projectId));
    cell.append(label, button);
    return;
  }
  if (!preview.url) {
    cell.textContent = preview.configured ? 'Unavailable' : 'Not set';
    return;
  }
  if (preview.available) {
    const link = document.createElement('a');
    link.href = preview.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Open preview';
    link.title = preview.url;
    link.setAttribute('aria-label', `Open preview for ${projects.find(project => project.id === projectId)?.name ?? 'project'}`);
    cell.append(link);
  } else {
    const url = document.createElement('span');
    url.textContent = preview.url;
    const note = document.createElement('span');
    note.className = 'project-preview-note';
    note.textContent = 'Unavailable';
    cell.append(url, note);
  }
}

function refreshPreview(projectId: string) {
  if (disposed || !projects.some(project => project.id === projectId)) return;
  const epoch = (previewEpoch.get(projectId) ?? 0) + 1;
  previewEpoch.set(projectId, epoch);
  previews.set(projectId, { kind: 'loading' });
  renderPreview(projectId);
  void previewClient.endpoint(projectId).then(data => {
    if (disposed || previewEpoch.get(projectId) !== epoch) return;
    const configured = data.endpoint.target !== null && data.endpoint.backendStatus !== 'unlinked';
    const safeUrl = configured ? safeEndpointUrl(data.endpoint.url) : null;
    if (configured && !safeUrl) {
      previews.set(projectId, { kind: 'error' });
      renderPreview(projectId);
      return;
    }
    previews.set(projectId, {
      kind: 'ready',
      url: safeUrl?.href ?? null,
      configured,
      available: data.endpoint.backendStatus === 'running',
    });
    renderPreview(projectId);
  }).catch(() => {
    if (disposed || previewEpoch.get(projectId) !== epoch) return;
    previews.set(projectId, { kind: 'error' });
    renderPreview(projectId);
  });
}

function render() {
  list.replaceChildren();
  editButtons = new Map();
  endpointButtons = new Map();
  gitButtons = new Map();
  githubActions = new Map();
  previewCells = new Map();
  for (const project of projects) {
    const row = document.createElement('tr');
    row.className = 'project-table-row';
    const title = document.createElement('td');
    title.className = 'project-name';
    if (project.build_app_id) {
      const link = document.createElement('a');
      link.href = builderURL(project.build_app_id);
      link.textContent = project.name;
      link.setAttribute('aria-label', `Open ${project.name} in Builder`);
      title.append(link);
    } else title.textContent = project.name;
    const projectDomain = document.createElement('td');
    projectDomain.className = 'project-domain';
    projectDomain.textContent = project.domain || '—';
    const previewCell = document.createElement('td');
    previewCell.className = 'project-preview';
    previewCells.set(project.id, previewCell);
    const gitCell = document.createElement('td');
    gitCell.className = 'project-git';
    if (project.github_repo) {
      const repo = document.createElement('a');
      repo.href = `https://github.com/${encodeURIComponent(project.github_repo.split('/')[0])}/${encodeURIComponent(project.github_repo.split('/')[1] ?? '')}`;
      repo.target = '_blank';
      repo.rel = 'noopener';
      repo.textContent = project.github_repo;
      repo.setAttribute('aria-label', `Open ${project.github_repo} on GitHub`);
      const state = document.createElement('span');
      state.className = 'project-github-state';
      const commit = project.github_commit_id ? ` · ${project.github_commit_id.slice(0, 7)}` : '';
      state.textContent = `GitHub · ${project.github_branch || 'main'}${commit} · hosted Git off`;
      const code = document.createElement('a');
      code.className = 'dashboard-retry';
      code.href = `/projects/code/?${new URLSearchParams({ project: project.id })}`;
      code.textContent = 'Code';
      code.setAttribute('aria-label', `Browse source code for ${project.name}`);
      const reconnect = document.createElement('button');
      reconnect.type = 'button';
      reconnect.className = 'dashboard-retry';
      reconnect.textContent = 'Reconnect access';
      reconnect.setAttribute('aria-label', `Reconnect GitHub access for ${project.name}`);
      reconnect.addEventListener('click', () => openGitHubDialog(project, true));
      githubActions.set(project.id, reconnect);
      gitCell.append(repo, code, state, reconnect);
    } else if (project.build_app_id || project.git_version_id) {
      const code = document.createElement('a');
      code.className = 'dashboard-retry';
      code.href = `/projects/code/?${new URLSearchParams({ project: project.id })}`;
      code.textContent = 'Code';
      code.setAttribute('aria-label', `Browse source code for ${project.name}`);
      const connect = githubButton(project);
      gitCell.append(code, connect);
    } else {
      const enableGit = document.createElement('button');
      enableGit.type = 'button';
      enableGit.className = 'dashboard-retry';
      enableGit.textContent = 'Enable Git';
      enableGit.setAttribute('aria-label', `Enable Git for ${project.name}`);
      enableGit.addEventListener('click', () => {
        if (busy || disposed) return;
        openProjectDialog(project); git.checked = true; git.focus();
      });
      gitButtons.set(project.id, enableGit);
      const connect = githubButton(project);
      gitCell.append(enableGit, connect);
    }
    const actions = document.createElement('div');
    actions.className = 'container-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'dashboard-retry';
    edit.textContent = 'Edit';
    edit.setAttribute('aria-label', `Edit project ${project.name}`);
    edit.disabled = busy || disposed;
    edit.addEventListener('click', () => openProjectDialog(project));
    editButtons.set(project.id, edit);
    actions.append(edit);
    const endpoint = document.createElement('button');
    endpoint.type = 'button';
    endpoint.className = 'dashboard-retry';
    endpoint.textContent = 'Endpoint';
    endpoint.setAttribute('aria-label', `Manage endpoint for ${project.name}`);
    endpoint.disabled = busy || disposed;
    endpoint.addEventListener('click', () => hosting.open(project));
    endpointButtons.set(project.id, endpoint);
    actions.append(endpoint);
    const actionCell = document.createElement('td');
    actionCell.className = 'project-actions';
    actionCell.append(actions);
    row.append(title, projectDomain, previewCell, gitCell, actionCell);
    list.append(row);
    if (!previews.has(project.id)) refreshPreview(project.id);
    else renderPreview(project.id);
  }
  status.textContent = projects.length ? '' : "You haven't created any projects.";
}

function githubButton(project: Project) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dashboard-retry';
  button.textContent = 'Connect GitHub';
  button.setAttribute('aria-label', `Connect GitHub for ${project.name}`);
  button.disabled = busy || disposed;
  button.addEventListener('click', () => openGitHubDialog(project));
  githubActions.set(project.id, button);
  return button;
}

async function openGitHubDialog(project: Project, reauthorize = false, repo = '', branch = 'main') {
  if (disposed || !authenticated) return;
  githubProject = project;
  githubReauthorize = reauthorize;
  const generation = ++githubGeneration;
  githubLoading = false;
  githubRepositories = [];
  githubCursor = null;
  githubForm.reset();
  githubRepo.replaceChildren();
  githubBranch.value = branch;
  githubPicker.hidden = true;
  githubInstallNote.hidden = false;
  githubManage.hidden = githubMore.hidden = true;
  githubNote.hidden = false;
  githubError.hidden = true;
  githubError.textContent = '';
  githubStatus.textContent = '';
  githubAuthorized = false;
  githubSubmit.textContent = 'Install GitHub app';
  githubTitle.textContent = project.github_repo ? 'Reconnect GitHub access' : 'Connect GitHub';
  githubDialog.showModal();
  controls();
  githubSubmit.focus();
  if (!reauthorize) await loadGithubRepositories(generation, repo, branch);
}

async function loadGithubRepositories(generation = githubGeneration, preferredRepo = githubRepo.value, preferredBranch = githubBranch.value) {
  githubLoading = true;
  githubError.hidden = true;
  githubStatus.textContent = 'Loading repositories…';
  controls();
  try {
    const data = await githubRequest(`/github/build/repositories${githubCursor ? `?${new URLSearchParams({ cursor: githubCursor })}` : ''}`, 'GET');
    if (disposed || generation !== githubGeneration) return;
    if (!Array.isArray(data.repositories) || data.nextCursor !== null && typeof data.nextCursor !== 'string'
      || data.repositories.some((repo: GithubRepository) => typeof repo.fullName !== 'string' || typeof repo.defaultBranch !== 'string')) throw new Error('github_unavailable');
    githubRepositories = [...new Map([...githubRepositories, ...data.repositories].map((repo: GithubRepository) => [repo.fullName, repo])).values()]
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    githubCursor = data.nextCursor;
    githubAuthorized = true;
    githubPicker.hidden = false;
    githubInstallNote.hidden = true;
    githubManage.hidden = false;
    githubMore.hidden = !githubCursor;
    githubSubmit.textContent = 'Link repository';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = githubRepositories.length ? 'Choose a repository' : 'No writable repositories available';
    githubRepo.replaceChildren(placeholder);
    for (const repo of githubRepositories) {
      const option = document.createElement('option');
      option.value = repo.fullName;
      option.textContent = `${repo.fullName}${repo.private ? ' (private)' : ''}`;
      githubRepo.append(option);
    }
    const selected = githubRepositories.find(repo => repo.fullName === preferredRepo)
      ?? (githubRepositories.length === 1 ? githubRepositories[0] : null);
    githubRepo.value = selected?.fullName ?? '';
    githubBranch.value = selected?.fullName === preferredRepo ? preferredBranch : selected?.defaultBranch ?? 'main';
    githubStatus.textContent = githubRepositories.length ? '' : 'No writable repositories are available. Update repository access in GitHub, then return here.';
  } catch (cause) {
    if (disposed || generation !== githubGeneration) return;
    const code = cause instanceof Error ? cause.message : 'github_unavailable';
    githubStatus.textContent = '';
    if (code === 'github_connection_required') {
      githubAuthorized = false;
      githubPicker.hidden = true;
      githubInstallNote.hidden = false;
      githubManage.hidden = githubMore.hidden = true;
      githubReauthorize = true;
      githubSubmit.textContent = 'Install GitHub app';
    } else {
      githubError.textContent = githubErrorMessage(code);
      githubError.hidden = false;
    }
  } finally {
    if (generation === githubGeneration) { githubLoading = false; controls(); }
  }
}

function githubErrorMessage(code: string) {
  const messages: Record<string, string> = {
    github_build_unavailable: 'GitHub linking is temporarily unavailable. Try again shortly.',
    github_connection_required: 'Authorize GitHub to continue.',
    github_connection_busy: 'GitHub access is refreshing. Try again shortly.',
    github_repository_access_required: 'Grant access to this repository in GitHub, then try again.',
    github_write_access_required: 'This GitHub connection needs write access to the repository.',
    github_branch_conflict: 'That branch contains unrelated history. Choose an empty branch or the branch at this project’s saved head.',
    github_branch_protected: 'GitHub protects this branch from updates. Choose another branch or change its protection rules.',
    github_project_busy: 'This project is busy. Wait for its current operation to finish, then try again.',
    github_source_limit: 'This repository exceeds Builder source limits. Reduce its size in GitHub before linking.',
    build_git_file_limit: 'A repository file exceeds the 25 MiB limit. Reduce its size before linking.',
    build_app_limit: 'You have reached the 50-app limit. Delete an app before linking this project.',
    github_rate_limited: 'GitHub is limiting requests right now. Try again shortly.',
    github_unavailable: 'GitHub is temporarily unavailable. Try again shortly.',
    invalid_request: 'Enter a valid GitHub repository and branch.',
  };
  return messages[code] ?? 'Could not connect this repository. Check the details and try again.';
}

async function request(fields?: { name: string; domain: string | null; git?: boolean }, id?: string) {
  const method = fields === undefined ? 'GET' : id === undefined ? 'POST' : 'PATCH';
  const endpoint = id === undefined ? `${API_ORIGIN}/projects` : `${API_ORIGIN}/projects?id=${encodeURIComponent(id)}`;
  const response = await fetch(endpoint, {
    method, credentials: 'include', redirect: 'error',
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]),
    headers: { accept: 'application/json', ...(fields === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(fields === undefined ? {} : { body: JSON.stringify(fields) }),
  });
  if (response.status === 401) { goToLogin(); throw new Error('not_authenticated'); }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error === 'build_app_limit' ? 'build_app_limit' : 'projects_unavailable');
  return data;
}

async function githubRequest(path: string, method: string, body?: unknown, timeoutMs = 15_000) {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    method, credentials: 'include', redirect: 'error',
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(timeoutMs)]),
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 401) { goToLogin(); throw new Error('not_authenticated'); }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(typeof data?.error === 'string' ? data.error : 'github_build_unavailable');
  return data;
}

async function handleGitHubReturn() {
  const params = new URLSearchParams(location.search);
  const projectId = params.get('githubProject');
  const result = params.get('github');
  if (!projectId || !result) return;
  const project = projects.find(item => item.id === projectId);
  if (!project) return;
  const repo = params.get('githubRepo') ?? project.github_repo ?? '';
  const branch = params.get('githubBranch') ?? project.github_branch ?? 'main';
  for (const key of ['githubProject', 'github', 'githubRepo', 'githubBranch']) params.delete(key);
  window.history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
  if (result === 'connected') {
    if (project.github_repo) {
      try {
        await githubRequest(`/projects/github?id=${encodeURIComponent(project.id)}`, 'PUT', { repo: project.github_repo, branch: project.github_branch ?? 'main' });
        if (!disposed) status.textContent = 'GitHub access updated.';
      } catch (cause) {
        if (disposed) return;
        await openGitHubDialog(project, true);
        githubError.textContent = githubErrorMessage(cause instanceof Error ? cause.message : 'github_unavailable');
        githubError.hidden = false;
      }
    } else {
      await openGitHubDialog(project, false, repo, branch);
    }
  } else {
    status.textContent = result === 'approval_pending'
      ? 'GitHub approval is pending. Complete the approval, then reconnect GitHub.'
      : result === 'cancelled' ? 'GitHub authorization was cancelled.' : githubErrorMessage(result);
    if (!project.github_repo) {
      const message = status.textContent;
      await openGitHubDialog(project, true, repo, branch);
      githubError.textContent = message;
      githubError.hidden = false;
    }
  }
}

async function load() {
  if (busy || disposed) return;
  busy = true;
  controls();
  error.hidden = retry.hidden = true;
  status.textContent = 'Loading projects…';
  try {
    const session = await auth.readSession();
    if (disposed) return;
    if (!session?.user) { goToLogin(); return; }
    authenticated = true;
    window.dispatchEvent(new CustomEvent('auth-change', { detail: { user: session.user } }));
    const data = await request();
    if (disposed) return;
    if (!Array.isArray(data.projects)) throw new Error('invalid_response');
    projects = data.projects;
    for (const id of previews.keys()) if (!projects.some(project => project.id === id)) { previews.delete(id); previewEpoch.delete(id); }
    render();
    await handleGitHubReturn();
  } catch {
    if (disposed) return;
    status.textContent = '';
    error.textContent = 'Could not load your projects. Check your connection and try again.';
    error.hidden = retry.hidden = false;
  } finally { busy = false; controls(); }
}

function openProjectDialog(project?: Project) {
  if (busy || disposed || !authenticated) return;
  editingProject = project ?? null;
  form.reset();
  formError.hidden = true;
  formError.textContent = '';
  formStatus.textContent = '';
  dialogTitle.textContent = editingProject ? 'Edit project' : 'New project';
  create.textContent = editingProject ? 'Save changes' : 'Create project';
  git.checked = false;
  gitOption.hidden = Boolean(editingProject?.build_app_id || editingProject?.git_version_id || editingProject?.github_repo);
  gitNote.textContent = editingProject?.github_repo ? 'This project uses GitHub. Hosted Git is off; source versions follow the linked branch.'
    : (editingProject?.build_app_id || editingProject?.git_version_id) ? 'Git history is enabled. Your saved versions are preserved.'
    : 'Save versions as you build. Enabling Git does not start a build.';
  if (editingProject) {
    name.value = editingProject.name;
    domain.value = editingProject.domain ?? '';
  }
  dialog.showModal();
  name.focus();
}

function resetProjectDialog() {
  editingProject = null;
  form.reset();
  formError.hidden = true;
  formError.textContent = '';
  formStatus.textContent = '';
  dialogTitle.textContent = 'New project';
  create.textContent = 'Create project';
}

newProject.addEventListener('click', () => openProjectDialog());
cancel.addEventListener('click', () => dialog.close());
dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || disposed || !form.reportValidity()) return;
  const fields = { name: name.value.trim(), domain: domain.value.trim() || null, ...(!(editingProject?.build_app_id || editingProject?.git_version_id || editingProject?.github_repo) && git.checked ? { git: true } : {}) };
  if (!fields.name) {
    formError.textContent = 'Enter a project name.';
    formError.hidden = false;
    name.focus();
    return;
  }
  busy = true;
  const editing = editingProject;
  let restoreFocusId: string | null = null;
  controls();
  formError.hidden = true;
  formStatus.textContent = editing ? 'Saving changes…' : 'Creating project…';
  try {
    const data = await request(fields, editing?.id);
    if (disposed) return;
    if (!data.project || typeof data.project.id !== 'string' || typeof data.project.name !== 'string'
      || (editing && data.project.id !== editing.id)) throw new Error('invalid_response');
    if (editing) {
      const index = projects.findIndex(project => project.id === editing.id);
      if (index < 0) throw new Error('project_missing');
      projects[index] = data.project;
    } else projects.unshift(data.project);
    render();
    dialog.close();
    restoreFocusId = data.project.id;
    status.textContent = editing ? 'Project updated.' : 'Project created.';
  } catch (cause) {
    if (disposed) return;
    refreshOnClose = !editing;
    formError.textContent = cause instanceof Error && cause.message === 'build_app_limit'
      ? 'You have reached the 50-workspace limit. Create this project without Git, or free a workspace in Builder.' : editing
      ? 'Could not save your changes. Check your connection and try again.'
      : 'Could not confirm project creation. Close this dialog and refresh the list before trying again.';
    formError.hidden = false;
  } finally {
    busy = false;
    formStatus.textContent = '';
    controls();
    if (restoreFocusId && !disposed) editButtons.get(restoreFocusId)?.focus();
  }
});

retry.addEventListener('click', load);
dialog.addEventListener('close', () => {
  resetProjectDialog();
  if (refreshOnClose && !disposed) { refreshOnClose = false; load(); }
});
githubCancel.addEventListener('click', () => githubDialog.close());
githubDialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
githubDialog.addEventListener('close', () => { githubGeneration++; githubLoading = false; controls(); });
githubRepo.addEventListener('change', () => {
  githubBranch.value = githubRepositories.find(repo => repo.fullName === githubRepo.value)?.defaultBranch ?? 'main';
  controls();
});
githubMore.addEventListener('click', () => loadGithubRepositories());
async function installGithubApp() {
  if (busy || disposed || !githubProject) return;
  busy = true;
  controls();
  githubError.hidden = true;
  githubStatus.textContent = 'Opening GitHub…';
  try {
    const returnTo = `/projects/?${new URLSearchParams({ githubProject: githubProject.id })}`;
    const result = await githubRequest('/github/build/connect', 'POST', {
      projectId: githubProject.id, returnTo, ...(githubReauthorize ? { reauthorize: true } : {}),
    });
    if (disposed) return;
    const target = typeof result.url === 'string' ? new URL(result.url) : null;
    if (!target || target.protocol !== 'https:' || target.origin !== 'https://github.com') throw new Error('github_build_unavailable');
    window.location.replace(target.href);
  } catch (cause) {
    if (disposed) return;
    githubStatus.textContent = '';
    githubError.textContent = githubErrorMessage(cause instanceof Error ? cause.message : 'github_unavailable');
    githubError.hidden = false;
  } finally { busy = false; controls(); }
}
githubManage.addEventListener('click', installGithubApp);
githubForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || disposed || githubLoading || !githubProject) return;
  if (!githubAuthorized) { await installGithubApp(); return; }
  if (!githubForm.reportValidity()) return;
  const repo = githubRepositories.find(repo => repo.fullName === githubRepo.value)?.fullName;
  const branch = githubBranch.value.trim();
  if (!repo || !branch || branch.length > 255 || /[\s~^:?*\[\\]/.test(branch) || branch.startsWith('/') || branch.endsWith('/') || branch.endsWith('.')) {
    githubError.textContent = 'Enter a valid GitHub repository and branch.';
    githubError.hidden = false;
    return;
  }
  busy = true;
  controls();
  githubError.hidden = true;
  try {
      githubStatus.textContent = 'Linking repository… This can take up to two minutes.';
      const result = await githubRequest(`/projects/github?id=${encodeURIComponent(githubProject.id)}`, 'PUT', { repo, branch }, 120_000);
      if (disposed) return;
      const index = projects.findIndex(item => item.id === githubProject?.id);
      if (index < 0) throw new Error('project_missing');
      projects[index] = { ...projects[index], git_version_id: null, github_repo: result.github?.repo ?? repo, github_branch: result.github?.branch ?? branch, github_commit_id: result.github?.commitId ?? null };
      githubDialog.close();
      render();
      status.textContent = 'GitHub repository linked.';
      try {
        const refreshed = await request();
        if (Array.isArray(refreshed.projects) && !disposed) { projects = refreshed.projects; render(); status.textContent = 'GitHub repository linked.'; }
      } catch { /* Keep the successful link shown while the project list refreshes later. */ }
  } catch (cause) {
    if (disposed) return;
    if (githubAuthorized && cause instanceof Error && cause.message === 'github_connection_required') {
      githubAuthorized = false;
      githubReauthorize = true;
      githubSubmit.textContent = 'Install GitHub app';
      githubStatus.textContent = 'GitHub access expired. Reconnect to finish linking this repository.';
    }
    githubError.textContent = githubErrorMessage(cause instanceof Error ? cause.message : 'github_build_unavailable');
    githubError.hidden = false;
  } finally {
    busy = false;
    controls();
  }
});
window.addEventListener('auth-change', event => { if (event.detail?.user === null) goToLogin(); });
load();
