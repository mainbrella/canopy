import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Draw the queue contents and receipt identities from the public observations.
// The arrangement explains copying, not capture duration or relative speed.
const evidence = new URL('../public/blog/we-ran-the-same-broken-app-on-three-cloud-sandboxes/evidence/worker/', import.meta.url);
const runs = Object.fromEntries(await Promise.all(['e2b', 'mainbrella', 'daytona'].map(async provider =>
  [provider, JSON.parse(await readFile(new URL(`${provider}/result.json`, evidence), 'utf8'))])));
const jobs = runs.e2b.ledger.jobs;
assert.equal(jobs.length, 5);
for (const run of Object.values(runs)) {
  assert.equal(run.seed, 12346);
  assert.deepEqual(run.ledger.jobs, jobs);
  assert.equal(run.source.prepared.process.pending, 5);
  assert.equal(run.coldRestart.verification.actualCount, 0);
  assert.equal(run.coldRestart.verification.status, 'reproduction-lost');
}
for (const provider of ['mainbrella', 'daytona']) {
  runs[provider].branches.forEach(branch => {
    assert.equal(branch.beforeResume.pending, 0);
    assert.equal(branch.after.outputs.length, 0);
  });
}
runs.e2b.branches.forEach(branch => assert.equal(branch.beforeResume.pending, 5));
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const text = (x, y, value, className = '', anchor = 'start') =>
  `<text x="${x}" y="${y}" class="${className}" text-anchor="${anchor}">${escape(value)}</text>`;
function chip(x, y, job, receipt = false) {
  const letter = job.id.split('-').at(-1).toUpperCase();
  if (receipt) return `<path d="M${x} ${y}h14l6 6v24h-20zM${x + 14} ${y}v6h6" class="receipt"/>${text(x + 10, y + 22, letter, 'letter', 'middle')}`;
  return `<rect x="${x}" y="${y}" width="20" height="32" rx="2" class="job ${job.unitCents === 0 ? 'zero' : ''}"/>` +
    text(x + 10, y + (job.unitCents === 0 ? 17 : 22), letter, 'letter', 'middle') +
    (job.unitCents === 0 ? text(x + 10, y + 29, '0¢', 'price', 'middle') : '');
}
function queue(x, y, contents) {
  return `<rect x="${x}" y="${y}" width="152" height="46" rx="4" class="heap"/>` +
    (contents.length ? contents.map((job, i) => chip(x + 14 + i * 25, y + 7, job)).join('') : text(x + 76, y + 29, 'empty', 'empty-label', 'middle'));
}
function panel(x, y, title, mode, memory) {
  let svg = text(x, y, title, 'provider') + text(x, y + 26, mode, 'small');
  svg += text(x + 56, y + 58, 'Prepared source · 5 jobs', 'small');
  svg += queue(x + 56, y + 70, jobs);
  svg += `<path d="M${x + 132} ${y + 116}v16h-110v225" class="fork ${memory ? '' : 'files-only'}"/>`;
  svg += text(x + 267, y + 158, 'Receipts', 'small');
  for (const [i, branch] of runs.e2b.branches.entries()) {
    const at = y + 174 + i * 80;
    const outputs = memory ? branch.after.outputs : [];
    svg += text(x + 56, at - 8, { baseline: 'Unchanged', correct: 'Correct patch', misleading: 'Misleading patch' }[branch.id], 'label');
    svg += `<path d="M${x + 22} ${at + 23}h27" class="flow"/>`;
    svg += queue(x + 56, at, memory ? jobs : []);
    svg += `<path d="M${x + 211} ${at + 23}h30" class="flow"/>`;
    svg += outputs.length ? outputs.map((job, index) => chip(x + 250 + index * 22, at + 8, job, true)).join('') :
      `<path d="M${x + 265} ${at + 23}h32" class="empty-mark"/>`;
    svg += text(x + 267, at + 60, `${outputs.length}/5`, 'count');
  }
  return svg;
}
function document(width, height, mobile) {
  const title = 'Five jobs in memory';
  const description = 'Observed seed-12346 controls. E2B copies five queued jobs into each of three workers; baseline returns C, E and A, correct patch returns B, C, D, E and A, and misleading patch returns none. B and D have zero unit price. Mainbrella and Daytona filesystem restores start empty workers and return no receipts. A cold restart loses all jobs on every provider.';
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
<title id="title">${title}</title><desc id="desc">${description}</desc>
<defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 7 3.5 0 7" fill="none" stroke="#69727a" stroke-width="1.3"/></marker></defs>
<style>
text{font-family:Helvetica,Arial,sans-serif;fill:#263238;font-size:19px}
.heading{font-size:${mobile ? 25 : 28}px;font-weight:600}.provider{font-size:${mobile ? 22 : 24}px;font-weight:600}
.small{font-size:16px;fill:#53616a}.label{font-size:17px}
.letter{font-size:17px}.price{font-size:10px}.count{font-size:18px;font-weight:600}.empty-label{font-size:18px;fill:#53616a}
.heap{fill:#eeece4;stroke:#69727a;stroke-width:1.5}.job{fill:#f7f4ec;stroke:#69727a;stroke-width:1.1}.zero{fill:#fae8d3;stroke:#a76116;stroke-width:1.5}
.receipt{fill:#f7f4ec;stroke:#374650;stroke-width:1.3;stroke-linejoin:round}.fork{fill:none;stroke:#69727a;stroke-width:1.5}
.files-only{stroke-dasharray:4 4}.flow{fill:none;stroke:#69727a;stroke-width:1.5;marker-end:url(#arrow)}.empty-mark{stroke:#69727a;stroke-width:2}
</style><rect width="${width}" height="${height}" rx="4" fill="#f7f4ec"/>`;
  svg += text(mobile ? 14 : 26, 38, title, 'heading');
  svg += text(mobile ? 14 : 26, 65, 'Observed controls · seed 12346 · Node 22.22.2', 'small');
  svg += chip(mobile ? 14 : 26, 78, jobs.find(job => job.unitCents === 0));
  svg += text(mobile ? 44 : 56, 99, 'B and D have a unit price of zero', 'small');
  svg += panel(mobile ? 14 : 26, 142, 'E2B', 'Live memory fork', true);
  svg += panel(mobile ? 14 : 446, mobile ? 582 : 142, 'Mainbrella / Daytona', 'Filesystem restore · fresh workers', false);
  const cold = mobile ? 992 : 552;
  svg += `<rect x="0" y="${cold}" width="${width}" height="${height - cold}" fill="#eeece4"/>`;
  svg += text(mobile ? 14 : 26, cold + 28, 'Cold restart · correct patch · every provider', 'small');
  svg += queue(mobile ? 14 : 26, cold + 39, jobs);
  svg += `<path d="M${mobile ? 174 : 190} ${cold + 62}h${mobile ? 26 : 101}" class="flow"/>`;
  svg += queue(mobile ? 214 : 308, cold + 39, []);
  if (!mobile) svg += text(494, cold + 68, '0/5 · reproduction lost', 'count');
  return `${svg}</svg>\n`;
}
for (const [name, width, height, mobile] of [
  ['worker-queue.svg', 850, 650, false], ['worker-queue-mobile.svg', 390, 1090, true],
]) {
  const path = new URL(`../public/images/blog/one-bug-three-clouds/${name}`, import.meta.url);
  await writeFile(path, document(width, height, mobile));
  console.log(fileURLToPath(path));
}
