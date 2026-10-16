import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { artifactHash, dispatchRelease, parseArguments, release, validateConfiguration } from './deploy.mjs';
import { targetFor, targets } from './deploy-targets.mjs';

const sourceSha = 'a'.repeat(40);
const deploymentVersion = '12345678-1234-1234-1234-123456789abc';
const productionEnv = {
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'mainbrella/canopy',
  GITHUB_WORKFLOW_REF: 'mainbrella/canopy/.github/workflows/deploy.yml@refs/heads/main',
  RELEASE_SHA: sourceSha,
};

function withoutConsoleOutput(callback) {
  const log = console.log;
  console.log = () => {};
  try { return callback(); } finally { console.log = log; }
}

function fixture(t, name) {
  const directory = mkdtempSync(join(tmpdir(), 'canopy-deploy-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const target = targetFor(name);
  const app = join(directory, target.directory);
  mkdirSync(app, { recursive: true });
  const wranglerPackage = join(app, 'node_modules/wrangler');
  mkdirSync(join(wranglerPackage, 'bin'), { recursive: true });
  writeFileSync(join(wranglerPackage, 'package.json'), JSON.stringify({ name: 'wrangler', version: '0.0.0' }));
  writeFileSync(join(wranglerPackage, 'bin/wrangler.js'), '');
  if (target.assets) {
    const assetDirectory = join(app, target.assets);
    mkdirSync(assetDirectory, { recursive: true });
    writeFileSync(join(assetDirectory, 'index.html'), '<main>built</main>');
  }
  writeFileSync(join(app, target.config), JSON.stringify(mockConfig(target), null, 2) + '\n');
  return { directory, app, target };
}

function stubRun(log, { failOn = null, status = '', sha = sourceSha, onCall = () => {},
  publicationContent, deploymentRows, onPublish = () => {} } = {}) {
  return (command, args, options = {}) => {
    const call = { command, args, cwd: options.cwd, env: options.env };
    log.push(call);
    onCall(call);
    if (failOn === `${command} ${args.join(' ')}`) throw new Error(`stub failed: ${failOn}`);
    if (command === 'git' && args[0] === 'status') return status;
    if (command === 'git' && args[0] === 'rev-parse') return sha;
    if (command === 'git' && args[0] === 'remote') return 'git@github.com:mainbrella/canopy.git';
    if (command === 'npm' && args[0] === 'run') {
      const targetName = Object.keys(targets).find(name => targets[name].publish === args[1]);
      if (targetName) {
        const receiptPath = options.env?.WRANGLER_OUTPUT_FILE_PATH;
        assert.ok(receiptPath, 'only the scoped publisher receives the Wrangler output path');
        mkdirSync(dirname(receiptPath), { recursive: true });
        const content = typeof publicationContent === 'function'
          ? publicationContent(targets[targetName])
          : publicationContent ?? [
            { type: 'build', worker_name: targets[targetName].worker, version_id: deploymentVersion },
            { type: 'deploy', worker_name: targets[targetName].worker, version_id: null },
            { type: 'deploy', worker_name: targets[targetName].worker, version_id: deploymentVersion },
          ].map(JSON.stringify).join('\n') + '\n';
        writeFileSync(receiptPath, content);
        onPublish({ target: targets[targetName], options, receiptPath });
      }
    }
    if (command === process.execPath && args.includes('--dry-run')) {
      const output = args[args.indexOf('--outdir') + 1];
      mkdirSync(join(options.cwd, output), { recursive: true });
      writeFileSync(join(options.cwd, output, 'worker.js'), 'bundle');
    }
    if (command === process.execPath && args.includes('list') && args.includes('--json')) {
      return JSON.stringify(deploymentRows ?? [
        { id: 'intended-deployment', created_on: '2026-01-01T00:00:00Z',
          versions: [{ version_id: deploymentVersion }] },
        { id: 'unrelated-newer-deployment', created_on: '2026-12-31T00:00:00Z',
          versions: [{ version_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }] },
      ]);
    }
    return '';
  };
}

function mockConfig(target) {
  return {
    $schema: 'https://example.invalid/config-schema.json',
    name: target.worker,
    assets: target.assets ? { directory: target.assets } : undefined,
    containers: target.worker === 'mainbrella-containers'
      ? [{ class_name: 'UserContainer', images: { terminal: { dockerfile: './containers/Dockerfile' } } }]
      : undefined,
    preserved_setting: 'fixture-value',
    workers_dev: target.worker === 'mainbrella-admin' || target.worker === 'mainbrella-marketing'
      || target.worker === 'mainbrella-containers' ? false : undefined,
    preview_urls: target.worker === 'mainbrella-admin' || target.worker === 'mainbrella-marketing'
      || target.worker === 'mainbrella-containers' ? false : undefined,
  };
}

test('each registry target checks and publishes exactly one scoped worker', t => {
  for (const name of Object.keys(targets)) {
    const { directory, app, target } = fixture(t, name);
    const log = [];
    const originalConfigPath = join(app, target.config);
    const originalConfig = readFileSync(originalConfigPath, 'utf8');
    const temporaryConfig = `.wrangler-local-bundle-${process.pid}.jsonc`;
    const receiptPath = join(directory, 'artifacts/releases', `${name}.wrangler.jsonl`);
    const evidence = withoutConsoleOutput(() => release(name, {
      publish: true,
      directory,
      env: productionEnv,
      run: stubRun(log, { onCall: call => {
        if (!call.args.includes('--dry-run')) return;
        const configArgument = call.args[call.args.indexOf('--config') + 1];
        if (name === 'containers') {
          assert.equal(configArgument, temporaryConfig);
          const bundleConfig = JSON.parse(readFileSync(join(app, configArgument), 'utf8'));
          const source = JSON.parse(originalConfig);
          delete source.containers;
          assert.deepEqual(bundleConfig, source);
        } else {
          assert.equal(configArgument, target.config);
        }
      } }),
      readConfig: path => {
        assert.equal(path, join(app, target.config));
        return mockConfig(target);
      },
      record: () => {},
    }));

    const npmCalls = log.filter(call => call.command === 'npm');
    assert.deepEqual(npmCalls.map(call => call.args), [
      ...target.checks.map(script => ['run', script, '--workspace', target.workspace]),
      ...target.preflight.map(script => ['run', script, '--workspace', target.workspace]),
      ['run', target.publish, '--workspace', target.workspace],
    ], `${name}: check, preflight, and single publish sequence`);
    assert.ok(npmCalls.every(call => call.cwd === app), `${name}: npm runs from its app directory`);
    for (const call of npmCalls) {
      assert.equal(call.env?.WRANGLER_OUTPUT_FILE_PATH,
        call.args[1] === target.publish ? receiptPath : undefined,
        `${name}: receipt output is scoped to its publisher`);
    }
    const publishCalls = npmCalls.filter(call => call.args[1] === target.publish);
    assert.equal(publishCalls.length, 1, `${name}: one scoped publish`);

    const dryRun = log.find(call => call.args.includes('--dry-run'));
    assert.ok(dryRun, `${name}: Wrangler dry-run runs`);
    assert.equal(dryRun.cwd, app);
    if (name !== 'containers') assert.equal(dryRun.args[dryRun.args.indexOf('--config') + 1], target.config);
    assert.equal(readFileSync(originalConfigPath, 'utf8'), originalConfig, `${name}: source config stays untouched`);
    if (name === 'containers') assert.equal(existsSync(join(app, temporaryConfig)), false, 'temporary config is removed after success');
    assert.equal(evidence.target, name);
    assert.equal(evidence.worker, target.worker);
    assert.equal(evidence.sourceSha, sourceSha);
    assert.match(evidence.artifactSha256, /^[a-f0-9]{64}$/);
    assert.equal(evidence.workerVersion, deploymentVersion);
    assert.equal(evidence.deploymentId, 'intended-deployment');
  }
});

test('checks run before preflight, then the target-scoped publish', t => {
  const { directory, target } = fixture(t, 'containers');
  const log = [];
  withoutConsoleOutput(() => release('containers', { publish: true, run: stubRun(log), directory, env: productionEnv,
    readConfig: () => mockConfig(target), record: () => {} }));
  const npmCalls = log.filter(call => call.command === 'npm').map(call => call.args[1]);
  assert.deepEqual(npmCalls, [...target.checks, ...target.preflight, target.publish]);
});

test('check or preflight failures stop before any publish', t => {
  for (const [name, failScript] of [['api', 'test:api'], ['admin', 'admin:preflight']]) {
    const { directory, target } = fixture(t, name);
    const log = [];
    const failure = `npm run ${failScript} --workspace ${target.workspace}`;
    assert.throws(() => release(name, { publish: true,
      run: stubRun(log, { failOn: failure }), directory, env: productionEnv,
      readConfig: () => mockConfig(target), record: () => {} }), /stub failed/);
    assert.equal(log.some(call => call.command === 'npm' && call.args[1] === target.publish), false, name);
  }
});

test('configuration validation rejects mismatched workers, assets, and private service exposure', () => {
  assert.throws(() => validateConfiguration('api', { name: 'wrong-worker' }), /must name/);
  assert.throws(() => validateConfiguration('site', { name: targetFor('site').worker,
    assets: { directory: './wrong' } }), /asset directory/);
  assert.throws(() => validateConfiguration('admin', { ...mockConfig(targetFor('admin')), route: 'admin.example.com' }), /remain private/);
});

test('arguments reject bare, unknown, duplicate, and unsupported deployment options', () => {
  for (const args of [[], ['unknown'], ['api', '--check', '--execute'], ['api', '--config', 'custom.jsonc']]) {
    assert.throws(() => parseArguments(args));
  }
  assert.deepEqual(parseArguments(['api']), { target: 'api', mode: 'dispatch' });
  assert.deepEqual(parseArguments(['api', '--check']), { target: 'api', mode: 'check' });
  assert.deepEqual(parseArguments(['api', '--execute']), { target: 'api', mode: 'execute' });
});

test('local execute is rejected before checks or publishing', t => {
  const { directory, target } = fixture(t, 'site');
  const log = [];
  assert.throws(() => release('site', { publish: true, run: stubRun(log), directory,
    env: {}, readConfig: () => mockConfig(target), record: () => {} }), /production workflow/);
  assert.deepEqual(log, []);
});

test('--check runs checks and bundle dry-run without remote preflight or publishing', t => {
  const { directory, target } = fixture(t, 'containers');
  const log = [];
  withoutConsoleOutput(() => release('containers', { publish: false, run: stubRun(log), directory, env: {},
    readConfig: () => mockConfig(target), record: () => {} }));
  const npmCalls = log.filter(call => call.command === 'npm').map(call => call.args[1]);
  assert.deepEqual(npmCalls, target.checks);
  assert.ok(log.some(call => call.args.includes('--dry-run')));
  assert.equal(log.some(call => call.args[1]?.includes('preflight')), false);
  assert.equal(log.some(call => call.command === 'npm' && call.args[1] === target.publish), false);
});

test('containers temporary bundle config is removed after Wrangler failure', t => {
  const { directory, app, target } = fixture(t, 'containers');
  const originalConfigPath = join(app, target.config);
  const originalConfig = readFileSync(originalConfigPath, 'utf8');
  const temporaryConfig = join(app, `.wrangler-local-bundle-${process.pid}.jsonc`);
  const log = [];
  assert.throws(() => release('containers', { publish: false,
    run: stubRun(log, { onCall: call => {
      if (!call.args.includes('--dry-run')) return;
      assert.equal(call.args[call.args.indexOf('--config') + 1], temporaryConfig.split('/').at(-1));
      const bundled = JSON.parse(readFileSync(temporaryConfig, 'utf8'));
      assert.equal('containers' in bundled, false);
      throw new Error('stub Wrangler failure');
    } }), directory, env: {}, readConfig: () => mockConfig(target) }), /stub Wrangler failure/);
  assert.equal(existsSync(temporaryConfig), false);
  assert.equal(readFileSync(originalConfigPath, 'utf8'), originalConfig);
});

test('release hash includes static assets rebuilt by the publisher', t => {
  const { directory, app, target } = fixture(t, 'site');
  const log = [];
  const evidence = withoutConsoleOutput(() => release('site', { publish: true,
    run: stubRun(log, { onPublish: ({ options }) => {
      assert.equal(options.env.WRANGLER_OUTPUT_FILE_PATH, join(directory, 'artifacts/releases/site.wrangler.jsonl'));
      writeFileSync(join(app, 'dist/index.html'), '<main>rebuilt by publisher</main>');
    } }), directory, env: productionEnv,
    readConfig: () => mockConfig(target), record: () => {} }));
  const expected = artifactHash([join(app, '.wrangler/release-site'), join(app, 'dist')]);
  assert.equal(evidence.artifactSha256, expected);
  assert.equal(readFileSync(join(app, 'dist/index.html'), 'utf8'), '<main>rebuilt by publisher</main>');
});

test('malformed, unexpected, or multiple publisher receipts stop before deployment lookup', t => {
  const cases = [
    ['malformed JSONL', '{not-json\n', /JSON/],
    ['unexpected worker', JSON.stringify({ type: 'deploy', worker_name: 'other-worker', version_id: deploymentVersion }) + '\n', /exactly one selected worker version/],
    ['multiple deploy receipts', [
      { type: 'deploy', worker_name: targetFor('api').worker, version_id: deploymentVersion },
      { type: 'deploy', worker_name: targetFor('api').worker, version_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
    ].map(JSON.stringify).join('\n') + '\n', /exactly one selected worker version/],
  ];
  for (const [label, publicationContent, expectedError] of cases) {
    const { directory, target } = fixture(t, 'api');
    const log = [];
    assert.throws(() => release('api', { publish: true,
      run: stubRun(log, { publicationContent }), directory, env: productionEnv,
      readConfig: () => mockConfig(target), record: () => {} }), expectedError, label);
    assert.equal(log.some(call => call.command === process.execPath && call.args.includes('list')),
      false, `${label}: does not query unrelated deployment records`);
  }
});

test('local dispatch names only the requested target and requires a clean main ancestor', () => {
  const log = [];
  withoutConsoleOutput(() => dispatchRelease('builder', { run: stubRun(log), directory: '/fixture' }));
  const workflow = log.find(call => call.command === 'gh');
  assert.deepEqual(workflow.args, ['workflow', 'run', 'deploy.yml', '--repo', 'mainbrella/canopy', '--ref', 'main',
    '-f', 'target=builder', '-f', `source_sha=${sourceSha}`, '-f', 'environment=production']);

  for (const status of [' M apps/web/index.html', 'UU apps/web/index.html']) {
    const rejected = [];
    assert.throws(() => dispatchRelease('site', { run: stubRun(rejected, { status }), directory: '/fixture' }), /Commit the intended release/);
    assert.deepEqual(rejected.map(call => call.args[0]), ['status']);
  }

  const unrelated = [];
  assert.throws(() => dispatchRelease('site', {
    run: stubRun(unrelated, { failOn: `git merge-base --is-ancestor ${sourceSha} FETCH_HEAD` }),
    directory: '/fixture',
  }), /stub failed/);
  assert.equal(unrelated.some(call => call.command === 'gh'), false);
});
