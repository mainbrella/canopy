import type { BuildGitHub, BuildVersion, createBuildClient } from './build-api.ts';
import { createBuildFileBrowser } from './build-files.ts';

type SourceApp = { id: string; versionId?: string | null; github?: BuildGitHub | null };
type SourceClient = Pick<ReturnType<typeof createBuildClient>, 'files' | 'fileText' | 'fileURL'>;

export function repositoryBranchLabel(github?: Pick<BuildGitHub, 'branch'> | null) {
  return github?.branch?.trim() || 'main';
}

// Shared by Builder and the standalone project code page.
export function createBuildSourceBrowser(host: HTMLElement, client: SourceClient, onError: (cause: unknown, retry: () => Promise<void>) => void) {
  host.innerHTML = `<div class="build-source-toolbar"><label for="build-source-view" class="visually-hidden">Source version</label><select id="build-source-view"><option value="repository">main</option><option value="working">Working files</option></select><span id="build-source-commit"></span></div>
    <p id="build-source-message" class="build-source-message" hidden></p>
    <div id="build-files" class="build-files"></div>`;
  const view = host.querySelector<HTMLSelectElement>('select')!;
  const commit = host.querySelector<HTMLElement>('#build-source-commit')!;
  const message = host.querySelector<HTMLElement>('.build-source-message')!;
  const browser = createBuildFileBrowser(host.querySelector<HTMLElement>('.build-files')!);
  let app: SourceApp | null = null, generation = 0;

  function invalidate(reset = false) {
    generation++;
    browser.status('Loading files…', reset);
    commit.textContent = ''; message.textContent = ''; message.hidden = true;
    host.setAttribute('aria-busy', 'false');
  }

  function selectVersion(saved: BuildVersion) {
    let option = Array.from(view.options).find(option => option.value === saved.id);
    if (!option) {
      option = document.createElement('option'); option.value = saved.id;
      option.textContent = `Version ${saved.commitId.slice(0, 8)}`;
      option.dataset.historicalVersion = ''; view.append(option);
    }
    view.value = saved.id;
  }

  async function load() {
    if (!app) return;
    const id = app.id;
    const versionId = view.value === 'working' ? null : view.value === 'repository' ? app.versionId : view.value;
    invalidate();
    const current = generation;
    host.setAttribute('aria-busy', 'true');
    try {
      const next = await client.files(id, versionId);
      if (current !== generation) return;
      commit.textContent = next.version ? next.version.commitId.slice(0, 8) : `Revision ${next.revision}`;
      message.textContent = next.version?.message ?? ''; message.hidden = !next.version;
      browser.setFiles(next.files, path => client.fileText(id, path, versionId), path => client.fileURL(id, path, versionId));
    } catch (cause) {
      if (current !== generation) return;
      browser.status('Could not load files.');
      onError(cause, load);
    } finally {
      if (current === generation) host.setAttribute('aria-busy', 'false');
    }
  }

  view.addEventListener('change', () => void load());
  return {
    load, invalidate, selectVersion,
    setApp(next: SourceApp) {
      if (app?.id !== next.id) {
        invalidate(true);
        view.querySelectorAll('[data-historical-version]').forEach(option => option.remove());
        view.value = next.versionId ? 'repository' : 'working';
      } else if (!app.versionId && next.versionId) view.value = 'repository';
      view.options[0].disabled = !next.versionId;
      view.options[0].textContent = repositoryBranchLabel(next.github);
      app = { id: next.id, versionId: next.versionId, github: next.github };
    },
    setVersions(versions: BuildVersion[]) {
      const selected = view.value;
      view.querySelectorAll('[data-historical-version]').forEach(option => option.remove());
      for (const saved of versions) selectVersion(saved);
      view.value = selected;
    },
    reset() {
      app = null; invalidate(true);
      browser.status('', true);
      view.querySelectorAll('[data-historical-version]').forEach(option => option.remove());
    },
  };
}
