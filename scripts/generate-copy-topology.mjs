import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

// This figure encodes receipt observations, not provider-wide capabilities or elapsed time.
const evidenceUrl = new URL('../public/blog/we-ran-the-same-broken-app-on-three-cloud-sandboxes/evidence/process-state.json', import.meta.url);
const evidence = JSON.parse(await readFile(evidenceUrl, 'utf8'));
const copies = ['baseline', 'correct', 'misleading'];
const labels = ['Baseline', 'Correct', 'Misleading'];
const modes = { Mainbrella: 'Saved workspace', E2B: 'Native memory fork', Daytona: 'Container snapshot' };
const rows = evidence.runs.map(run => {
  const observation = (copy, stage) => {
    const value = run.observations.find(item => item.copy === copy && item.stage === stage);
    assert.ok(value, `${run.provider}: missing ${copy} ${stage}`);
    assert.equal(value.filesystem.matchesExpectedHashes, true);
    assert.equal(value.filesystem.dependenciesMatchSource, true);
    assert.equal(value.filesystem.preparedMarkerMatchesSource, true);
    return value;
  };
  const before = observation('source', 'before capture');
  const source = observation('source', 'after capture');
  assert.ok(before.process.serverReachable && before.process.nonce);
  const sourceNonce = source.process.serverReachable ? 'A' : null;
  if (sourceNonce) assert.equal(source.process.nonce, before.process.nonce);
  else assert.equal(source.process.nonce, null);
  const freshNonces = new Set();
  const branches = copies.map((copy, index) => {
    const restored = observation(copy, 'before launch or patch');
    const started = observation(copy, 'after patch and explicit restart');
    assert.ok(started.process.serverReachable && started.process.nonce);
    assert.notEqual(started.process.nonce, before.process.nonce);
    freshNonces.add(started.process.nonce);
    if (restored.process.serverReachable) assert.equal(restored.process.nonce, before.process.nonce);
    else assert.equal(restored.process.nonce, null);
    return { label: labels[index], inherited: restored.process.serverReachable ? 'A' : null, fresh: String.fromCharCode(66 + index) };
  });
  assert.equal(freshNonces.size, 3, `${run.provider}: expected three distinct fresh nonces`);
  return { provider: run.provider, mode: modes[run.provider], sourceNonce, branches };
});
assert.deepEqual(rows.map(row => row.provider), ['Mainbrella', 'E2B', 'Daytona']);

const description = 'Observed topology from the retained runs, not a measured timeline. All three providers preserved the checked files. Mainbrella and E2B sources retained their process nonce through capture; Daytona’s source had no listener afterward. E2B’s three branches inherited the source nonce. Mainbrella and Daytona branches initially had no listener. Explicit starts or restarts gave every branch a fresh nonce. Letters identify nonces within each provider, not across providers.';
const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const text = (x, y, value, className = '', anchor = 'start') => `<text x="${x}" y="${y}" class="${className}" text-anchor="${anchor}">${escape(value)}</text>`;
const path = d => `<path d="${d}" class="flow"/>`;
const file = (x, y, size = 1) => `<use href="#files" transform="translate(${x} ${y}) scale(${size})"/>`;
const process = (x, y, nonce) => `<g><circle cx="${x}" cy="${y}" r="18" class="${nonce ? 'process' : 'absent'}"/>${nonce ? text(x, y + 6, nonce, 'nonce', 'middle') : `<path d="M${x - 6} ${y}h12" class="empty"/>`}</g>`;
const pair = (x, y, nonce) => file(x - 43, y - 20) + process(x + 25, y, nonce);

function svg(width, height, body, mobile = false) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">What the copies kept</title>
  <desc id="desc">${escape(description)}</desc>
  <defs>
    <marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 7 3.5 0 7" fill="none" stroke="#69727a" stroke-width="1.3"/></marker>
    <g id="files" fill="#f7f4ec" stroke="#374650" stroke-width="1.8" stroke-linejoin="round"><path d="M1 7h23l9 9v27H1z"/><path d="M6 1h23l9 9v27H6z"/><path d="M29 1v9h9M13 18h17M13 25h17M13 32h11"/></g>
  </defs>
  <style>
    text{font-family:Helvetica,Arial,sans-serif;fill:#263238;font-size:${mobile ? 18 : 20}px}
    .heading{font-size:${mobile ? 24 : 27}px;font-weight:600}.provider{font-size:${mobile ? 23 : 24}px;font-weight:600}
    .small{font-size:${mobile ? 16 : 17}px;fill:#53616a}.label{font-size:${mobile ? 17 : 18}px}.nonce{font-size:19px;font-weight:600}
    .flow{fill:none;stroke:#69727a;stroke-width:1.6;marker-end:url(#arrow)}
    .process{fill:#f7f4ec;stroke:#374650;stroke-width:2.4}.absent{fill:#f7f4ec;stroke:#69727a;stroke-width:1.8;stroke-dasharray:4 4}
    .empty{fill:none;stroke:#69727a;stroke-width:1.6}.separator{stroke:#ced1cf;stroke-width:1}
  </style>
  <rect width="${width}" height="${height}" rx="4" fill="#f7f4ec"/>
${body}
</svg>
`;
}

const desktop = [
  text(26, 39, 'What the copies kept', 'heading'),
  text(26, 66, 'Observed copy topology · not a measured timeline', 'small'),
  file(27, 82, .55), text(58, 102, 'Checked files', 'small'),
  process(234, 96, 'A'), text(262, 102, 'Process nonce', 'small'),
  process(442, 96, null), text(471, 102, 'No listener', 'small'),
  text(260, 139, 'Source', '', 'middle'), text(260, 161, 'after capture', 'small', 'middle'),
  text(493, 139, 'Three branches', '', 'middle'), text(493, 161, 'before launch or patch', 'small', 'middle'),
  text(741, 139, 'After explicit', '', 'middle'), text(741, 161, 'start / restart', 'small', 'middle'),
];
rows.forEach((row, index) => {
  const center = 245 + index * 167;
  desktop.push(text(26, center - 34, row.provider, 'provider'), text(26, center - 10, row.mode, 'small'));
  desktop.push(pair(248, center, row.sourceNonce));
  desktop.push(text(248, center + 44, row.sourceNonce ? 'Same nonce' : 'No listener', 'small', 'middle'));
  desktop.push(`<path d="M295 ${center}H350M350 ${center - 46}V${center + 46}" fill="none" stroke="#69727a" stroke-width="1.6"/>`);
  row.branches.forEach((branch, branchIndex) => {
    const y = center - 46 + branchIndex * 46;
    desktop.push(path(`M350 ${y}H394`), pair(443, y, branch.inherited), text(503, y + 6, branch.label, 'label'));
    desktop.push(path(`M615 ${y}H708`), process(741, y, branch.fresh));
  });
  if (index < rows.length - 1) desktop.push(`<path d="M26 ${center + 78}H824" class="separator"/>`);
});
desktop.push(text(26, 692, 'A = source nonce within each provider. B, C, D = fresh nonces.', 'small'));

const mobile = [
  text(20, 36, 'What the copies kept', 'heading'),
  text(20, 62, 'Observed topology, not a timeline', 'small'),
  file(20, 82, .5), text(47, 101, 'Files', 'small'),
  process(123, 95, 'A'), text(150, 101, 'Nonce', 'small'),
  process(252, 95, null), text(280, 101, 'No listener', 'small'),
];
rows.forEach((row, index) => {
  const top = 144 + index * 356;
  mobile.push(text(20, top, row.provider, 'provider'), text(20, top + 24, row.mode, 'small'));
  mobile.push(text(195, top + 53, 'Source after capture', 'label', 'middle'), pair(195, top + 82, row.sourceNonce));
  mobile.push(`<path d="M195 ${top + 104}V${top + 125}M69 ${top + 125}H321" fill="none" stroke="#69727a" stroke-width="1.6"/>`);
  row.branches.forEach((branch, branchIndex) => {
    const x = 69 + branchIndex * 126;
    mobile.push(path(`M${x} ${top + 125}V${top + 145}`), pair(x, top + 171, branch.inherited));
    mobile.push(text(x, top + 218, branch.label, 'label', 'middle'));
    mobile.push(path(`M${x} ${top + 229}V${top + 249}`), process(x, top + 274, branch.fresh));
  });
  mobile.push(text(195, top + 314, 'Fresh nonces after explicit start / restart', 'small', 'middle'));
  if (index < rows.length - 1) mobile.push(`<path d="M20 ${top + 330}H370" class="separator"/>`);
});
mobile.push(text(20, 1214, 'A = source nonce within each provider.', 'small'), text(20, 1237, 'B, C, D = fresh nonces.', 'small'));

const directory = new URL('../public/images/blog/one-bug-three-clouds/', import.meta.url);
await writeFile(new URL('what-the-copies-kept.svg', directory), svg(850, 716, desktop.join('\n')));
await writeFile(new URL('what-the-copies-kept-mobile.svg', directory), svg(390, 1258, mobile.join('\n'), true));
console.log('Generated desktop and mobile copy topology from process-state.json');
