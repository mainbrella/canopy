import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Re-export observations from sealed records, never the live journals. No API
// credentials, request bodies, preview addresses or execution output are copied.
const web = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repository = resolve(process.argv[2] || join(web, '../repo-rodeo'));
const output = join(web, 'public/blog/we-ran-the-same-broken-app-on-three-cloud-sandboxes/evidence');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const runs = [
  ['Mainbrella', 'mainbrella-production-2026-10-12T09-16-42-487Z', '/blog/one-bug-three-clouds/mainbrella-production/result.json'],
  ['E2B', 'e2b-cloud-followup-2026-10-12', '/blog/one-bug-three-clouds/e2b-followup/result.json'],
  ['Daytona', 'daytona-cloud-snapshot-2026-10-12T09-49-16-492Z', '/blog/we-ran-the-same-broken-app-on-three-cloud-sandboxes/evidence/daytona-rerun/result.json'],
];

const exported = [];
for (const [provider, directory, publicResult] of runs) {
  const root = join(repository, 'artifacts', directory, 'run');
  const resultBytes = await readFile(join(root, 'result.json'));
  const result = JSON.parse(resultBytes);
  assert.equal(hash(await readFile(join(web, 'public', publicResult))), hash(resultBytes),
    `Public result differs from the sealed run: ${provider}`);
  assert.equal(result.checks.filesystem.status, 'verified');
  assert.equal(result.checks.processes.status, 'verified');
  const records = new Map();
  for (const [path, digest] of Object.entries(result.evidence.files)) {
    if (!path.startsWith('journal-snapshot/operations/')) continue;
    const bytes = await readFile(join(root, 'private', path));
    assert.equal(hash(bytes), digest, `Sealed receipt changed: ${path}`);
    const record = JSON.parse(bytes);
    records.set(record.name, { record, path, sha256: digest });
  }
  function state(name) {
    const entry = records.get(name);
    assert.ok(entry, `Missing observation: ${name}`);
    const receipts = [{ path: entry.path, sha256: entry.sha256 }];
    let response = entry.record.response;
    if (!response) {
      const submitted = JSON.parse(entry.record.responseBody);
      const id = (submitted.execution || submitted).id;
      const polled = records.get(`job-poll-${id}`);
      assert.ok(polled, `Missing completed execution for ${name}`);
      const body = JSON.parse(polled.record.responseBody);
      response = body.execution || body;
      receipts.push({ path: polled.path, sha256: polled.sha256 });
    }
    assert.equal(response.exitCode, 0, name);
    assert.notEqual(response.outputTruncated, true, name);
    return { observation: JSON.parse(response.stdout), receipts, operation: name };
  }
  function ready(name) {
    for (let i = 0; i < 15; i++) {
      if (!records.has(`${name}-ready-${i}`)) continue;
      const record = state(`${name}-ready-${i}`);
      if (record.observation.process.serverReachable) return record;
    }
    throw new Error(`No listening process for ${name}`);
  }
  const original = ready('source');
  const reference = original.observation;
  const samples = [
    ['source', 'before capture', original],
    ['source', 'after capture', state('source-after-capture')],
    ...(provider === 'Daytona' ? [['source', 'after explicit restart', ready('source-resumed')]] : []),
    ...['baseline', 'correct', 'misleading'].flatMap(branch => [
      [branch, 'before launch or patch', state(`${branch}-restored-state`)],
      [branch, 'after patch and explicit restart', ready(branch)],
    ]),
  ];
  exported.push({
    provider, runId: result.runId, mode: result.mode,
    sourceCommit: result.source.commit, runnerCommit: result.runner.commit,
    result: publicResult, resultSha256: hash(resultBytes),
    observations: samples.map(([copy, stage, sample]) => {
      const { observation: observed, receipts, operation } = sample;
      const expected = stage === 'after patch and explicit restart'
        ? result.controls.find(control => control.id === copy).sourceHashes : reference.hashes;
      assert.deepEqual(observed.hashes, expected, `${provider} ${copy} ${stage}: files`);
      assert.equal(observed.dependencyHash, reference.dependencyHash);
      assert.equal(observed.prepared, reference.prepared);
      assert.equal(observed.mode, reference.mode);
      assert.equal(observed.link, reference.link);
      assert.match(observed.process.nonce || '', observed.process.serverReachable ? /^[0-9a-f-]{36}$/ : /^$/);
      return {
        copy, stage, process: observed.process,
        filesystem: {
          checkedFiles: Object.keys(observed.hashes).length,
          matchesExpectedHashes: true, dependenciesMatchSource: true,
          dependencyLockSha256: observed.dependencyHash,
          preparedMarkerMatchesSource: true, permissionMode: observed.mode.toString(8),
          symlinkTarget: observed.link,
        },
        provenance: { operation, receipts },
      };
    }),
  });
}
await mkdir(output, { recursive: true });
const bytes = JSON.stringify({
  schemaVersion: 1,
  description: 'Allowlisted process observations from the October 12 editor runs. Each input receipt was checked against its sealed result hash. Nonces originate in process memory, not a file.',
  limitations: 'The private receipts include credentials and are not published. This extract makes reported values inspectable; it does not independently replay the original verification. Browser localStorage is external to these servers.',
  runs: exported,
}, null, 2) + '\n';
await writeFile(join(output, 'process-state.json'), bytes);
await writeFile(join(output, 'process-state.sha256'), `${hash(bytes)}  process-state.json\n`);
const rows = exported.flatMap(run => run.observations.filter(observation =>
  observation.stage === 'before capture' || observation.stage === 'before launch or patch')
  .map((observation, index) => {
    const { process, filesystem } = observation;
    const copy = observation.copy === 'source' ? 'source, before capture' : observation.copy;
    return `            <tr${index === 0 ? ' class="provider-start"' : ''}><th scope="row">${run.provider} · ${copy}</th><td>${process.serverReachable ? 'Yes' : 'No'}</td><td>${process.pid ?? 'none'}</td><td>${process.nonce ? `<code>${process.nonce.slice(0, 8)}</code>` : 'none'}</td><td>${filesystem.checkedFiles}/${filesystem.checkedFiles}</td></tr>`;
  })).join('\n');
const table = `<!-- process-table:start -->
        <div class="rodeo-table-scroll" tabindex="0" role="region" aria-label="Source and branch process observations; scroll horizontally if needed">
          <table class="rodeo-results rodeo-process-table">
            <caption class="sr-only">Observed editor processes before any branch launch or patch. Files column counts matching tracked file hashes; dependencies, permissions, marker and symlink were also checked.</caption>
            <thead><tr><th scope="col">Provider · copy</th><th scope="col">Listening</th><th scope="col">PID</th><th scope="col">Nonce</th><th scope="col">Files</th></tr></thead>
            <tbody>
${rows}
            </tbody>
          </table>
        </div>
        <!-- process-table:end -->`;
const articlePath = join(web, 'blog/we-ran-the-same-broken-app-on-three-cloud-sandboxes/index.html');
const article = await readFile(articlePath, 'utf8');
const placeholder = /<!-- process-table -->|<!-- process-table:start -->[\s\S]*?<!-- process-table:end -->/;
assert.match(article, placeholder, 'Article must retain generated table markers');
await writeFile(articlePath, article.replace(placeholder, table));
console.log(`Exported ${exported.reduce((n, run) => n + run.observations.length, 0)} verified process observations.`);
