import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// This figure draws job identities and receipt counts from retained cloud
// observations. Positions describe branching, never duration or provider rank.
const evidence = new URL('../public/blog/we-ran-the-same-broken-app-on-three-cloud-sandboxes/evidence/worker/', import.meta.url);
const output = new URL('../public/images/blog/ai-agent-linux-box/', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const runs = {};
for (const provider of ['e2b', 'mainbrella', 'daytona']) {
  const bytes = await readFile(new URL(`${provider}/result.json`, evidence));
  const checksum = (await readFile(new URL(`${provider}/result.sha256`, evidence), 'utf8')).split(/\s/)[0];
  assert.equal(hash(bytes), checksum, `${provider}: result checksum`);
  const run = JSON.parse(bytes);
  assert.equal(run.provider, provider);
  assert.equal(run.status, 'completed');
  assert.equal(run.cleanup.confirmed, true);
  for (const branch of run.branches) {
    const observation = JSON.parse(await readFile(new URL(`${provider}/branch-${branch.id}.json`, evidence), 'utf8'));
    assert.deepEqual(observation, branch, `${provider}: branch observation`);
    assert.equal(branch.verification.expectedCount, run.ledger.jobs.length);
    assert.equal(branch.verification.actualCount, branch.after.outputs.length);
    assert.equal(new Set(branch.after.outputs.map(receipt => receipt.id)).size, branch.after.outputs.length);
    for (const receipt of branch.after.outputs) {
      assert.deepEqual(receipt, run.ledger.expected.find(expected => expected.id === receipt.id));
    }
  }
  runs[provider] = run;
}
const jobs = runs.e2b.ledger.jobs;
const expected = jobs.length;
assert.equal(expected, 5, 'This layout is for the retained five-job workload');
for (const run of Object.values(runs)) {
  assert.deepEqual(run.ledger.jobs, jobs);
  assert.equal(run.source.prepared.process.pending, expected);
}
const branches = ['correct', 'baseline', 'misleading'].map(id => runs.e2b.branches.find(branch => branch.id === id));
for (const branch of branches) {
  assert.equal(branch.inherited, true);
  assert.equal(branch.beforeResume.pending, expected);
  assert.equal(branch.beforeResume.nonce, runs.e2b.source.prepared.process.nonce);
  assert.equal(branch.beforeResume.inputFingerprint, runs.e2b.ledger.fingerprint);
}
assert.deepEqual(branches[0].after.outputs, runs.e2b.ledger.expected);
assert.equal(branches[1].after.outputs.length, jobs.filter(job => job.unitCents !== 0).length);
assert.equal(branches[2].after.outputs.length, 0);
const sourcePending = runs.e2b.coldRestart.before.process.pending;
assert.equal(sourcePending, expected, 'The source retained its queue after all branch runs');
for (const provider of ['mainbrella', 'daytona']) {
  for (const branch of runs[provider].branches) {
    assert.equal(branch.beforeLaunch.process, null);
    assert.equal(branch.beforeResume.pending, 0);
    assert.equal(branch.after.outputs.length, 0);
    assert.equal(branch.verification.status, 'reproduction-lost');
  }
}
const restoredPending = runs.mainbrella.branches[0].beforeResume.pending;
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const text = (x, y, value, className = '', anchor = 'start') =>
  `<text x="${x}" y="${y}" class="${className}" text-anchor="${anchor}">${escape(value)}</text>`;
const line = (d, className = 'flow') => `<path d="${d}" class="${className}"/>`;
const letter = job => job.id.split('-').at(-1).toUpperCase();

function token(x, y, job, receipt = false, missing = false, compact = false) {
  const width = compact ? 20 : 23;
  const height = 30;
  if (missing) return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="2" class="missing"/>`;
  const shape = receipt
    ? `<path d="M${x} ${y}h${width - 6}l6 6v${height - 6}h-${width}zM${x + width - 6} ${y}v6h6" class="receipt"/>`
    : `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="2" class="job"/>`;
  return shape + text(x + width / 2, y + 21, letter(job), 'letter', 'middle');
}
function queue(x, y, compact = false, empty = false) {
  const width = compact ? 136 : 153;
  return `<rect x="${x}" y="${y}" width="${width}" height="44" rx="4" class="queue${empty ? ' empty' : ''}"/>` +
    (empty ? text(x + width / 2, y + 28, `${restoredPending} pending`, 'empty-label', 'middle')
      : jobs.map((job, i) => token(x + 8 + i * (compact ? 24 : 28), y + 7, job, false, false, compact)).join(''));
}
function receipts(x, y, branch, compact = false) {
  const returned = new Set(branch.after.outputs.map(receipt => receipt.id));
  return jobs.map((job, i) => token(x + i * (compact ? 24 : 28), y, job, true, !returned.has(job.id), compact)).join('');
}
function files(x, y) {
  return `<g class="files"><path d="M${x + 12} ${y - 8}h35v43h-35z"/><path d="M${x + 6} ${y - 4}h35v43h-35z"/><path d="M${x} ${y}h27l8 8v35h-35zM${x + 27} ${y}v8h8"/>` +
    line(`M${x + 7} ${y + 16}h20M${x + 7} ${y + 23}h14M${x + 7} ${y + 30}h18`, 'file-lines') + '</g>';
}
function document(mobile) {
  const width = mobile ? 390 : 850;
  const height = mobile ? 690 : 500;
  const description = `Observed supplied-code controls. E2B live copies each retain ${expected} accepted jobs. The correct patch returns ${branches[0].after.outputs.length} receipts, unchanged code ${branches[1].after.outputs.length}, and the fake patch ${branches[2].after.outputs.length}, out of ${expected} expected. The original still has ${sourcePending} pending jobs after all three runs. Mainbrella saved workspaces and Daytona container snapshots copy files but start fresh workers with ${restoredPending} pending jobs. Missing receipt slots are dashed outlines.`;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
<title id="title">Copying a running program</title><desc id="desc">${escape(description)}</desc>
<defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M1 1l5 2.5L1 6" fill="none" stroke="#62736a" stroke-width="1.25"/></marker></defs>
<style>
text{font-family:Helvetica,Arial,sans-serif;fill:#293e34;font-size:19px}
.title{font-size:${mobile ? 23 : 25}px;font-weight:600}.heading{font-size:${mobile ? 20 : 21}px;font-weight:600}
.small{font-size:16px;fill:#5b6b60}.label{font-size:18px}.count{font-size:19px;font-weight:600}
.letter{font-size:16px;fill:#314e3c}.good{fill:#365b44}.short{fill:#966039}
.queue{fill:#ecf0e6;stroke:#8b9d8e;stroke-width:1.25}.job{fill:#f8f5ee;stroke:#72917a;stroke-width:1.25}
.receipt{fill:#e3eddf;stroke:#50765a;stroke-width:1.25;stroke-linejoin:round}
.missing{fill:none;stroke:#b8906a;stroke-width:1.25;stroke-dasharray:3 3}
.flow,.fork{fill:none;stroke:#62736a;stroke-width:1.5}.flow{marker-end:url(#arrow)}
.empty{fill:none;stroke:#b8906a;stroke-dasharray:4 3}.empty-label{font-size:18px;fill:#966039}
.files path{fill:#f8f5ee;stroke:#72917a;stroke-width:1.25;stroke-linejoin:round}.files .file-lines{fill:none}
</style><rect width="${width}" height="${height}" fill="#f8f5ee"/>
`;
  svg += text(mobile ? 20 : 28, 35, 'Copying a running program', 'title');
  svg += text(mobile ? 20 : 28, 62, `${expected} accepted jobs · ${expected} receipts expected`, 'small');
  if (mobile) {
    svg += text(20, 97, 'E2B · live copies', 'heading');
    svg += queue(28, 122, true);
    svg += text(192, 139, 'Original worker', 'label');
    svg += text(192, 161, `Still ${sourcePending} pending`, 'small');
    svg += line('M96 166v12H24v266', 'fork');
    svg += text(49, 195, 'Supplied patches', 'small');
    for (const [i, branch] of branches.entries()) {
      const y = 230 + i * 96;
      const count = branch.after.outputs.length;
      svg += text(49, y - 12, { correct: 'Correct patch', baseline: 'Unchanged code', misleading: 'Fake patch' }[branch.id], 'label');
      svg += text(220, y - 12, `${count} / ${expected} receipts`, `count ${count === expected ? 'good' : 'short'}`);
      svg += line(`M24 ${y + 22}h19`);
      svg += queue(49, y, true);
      svg += line(`M189 ${y + 22}h23`);
      svg += receipts(220, y + 7, branch, true);
    }
    svg += text(20, 523, 'Copying files', 'heading');
    svg += text(20, 549, 'Mainbrella / Daytona · filesystem copies', 'small');
    svg += files(42, 587);
    svg += line('M111 611h101');
    svg += queue(224, 589, true, true);
    svg += text(28, 661, 'Files kept.', 'label');
    svg += text(224, 661, 'Queue gone.', 'label short');
  } else {
    svg += text(28, 99, 'E2B · live copies', 'heading');
    svg += text(290, 99, 'Supplied patches', 'small');
    svg += text(556, 99, 'Returned receipts', 'small');
    svg += text(28, 207, 'Original worker', 'label');
    svg += queue(28, 218);
    svg += text(28, 288, `Still ${sourcePending} after all branches`, 'small');
    svg += line('M181 240h63M244 160v160', 'fork');
    for (const [i, branch] of branches.entries()) {
      const y = 138 + i * 80;
      const count = branch.after.outputs.length;
      svg += text(290, y - 12, { correct: 'Correct patch', baseline: 'Unchanged code', misleading: 'Fake patch' }[branch.id], 'label');
      svg += line(`M244 ${y + 22}h38`);
      svg += queue(290, y);
      svg += line(`M452 ${y + 22}h92`);
      svg += receipts(556, y + 7, branch);
      svg += text(733, y + 29, `${count} / ${expected}`, `count ${count === expected ? 'good' : 'short'}`);
    }
    svg += text(28, 391, 'Copying files · Mainbrella + Daytona (tested modes)', 'heading');
    svg += files(43, 430);
    svg += text(108, 455, 'Saved files', 'label');
    svg += line('M232 451h82');
    svg += queue(327, 428, false, true);
    svg += text(519, 445, 'Fresh worker', 'label');
    svg += text(519, 469, 'Files kept. Queue gone.', 'small');
  }
  return `${svg}</svg>\n`;
}
await mkdir(output, { recursive: true });
for (const [name, mobile] of [['pending-jobs.svg', false], ['pending-jobs-mobile.svg', true]]) {
  const path = new URL(name, output);
  await writeFile(path, document(mobile));
  console.log(fileURLToPath(path));
}
