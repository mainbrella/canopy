import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { IMAGE_CATALOG } from '../apps/linux/containers/image-catalog.js';
import { artifactHash } from './deploy.mjs';
import { targetFor } from './deploy-targets.mjs';
import { STAGING } from './staging-config.mjs';
import { publishedStagingImages, stagingBootstrapConfig, stagingOperation, stagingSecrets,
  stagingBackendTargets, stagingTargets, validateStagingOperation } from './staging-release.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = 'a'.repeat(40);
const resources = { databaseId: '00000000-0000-4000-8000-000000000001',
  previewDatabaseId: '00000000-0000-4000-8000-000000000002', bucketName: STAGING.bucketName };
const releaseEnv = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'mainbrella/canopy',
  GITHUB_WORKFLOW_REF: 'mainbrella/canopy/.github/workflows/staging.yml@refs/heads/main',
  CANOPY_STAGING_DEPLOYS_ENABLED: 'true', RELEASE_SHA: sha,
  CLOUDFLARE_API_TOKEN: 'stage-only-provider-token', CLOUDFLARE_ACCOUNT_ID: STAGING.accountId };
const catalog = Object.fromEntries(IMAGE_CATALOG.map(entry => [entry.key, {
  image: `registry.cloudflare.com/${STAGING.accountId}/${entry.repository}@sha256:${'b'.repeat(64)}`,
}]));
const version = index => `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const source = target => {
  const selected = targetFor(target);
  return join(root, selected.directory, selected.config);
};

function fixture(t, behavior = {}) {
  const stagedResources = behavior.resources ?? resources;
  const stagedCatalog = behavior.catalog ?? catalog;
  const directory = mkdtempSync(join(tmpdir(), 'canopy-staging-release-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const original = new Map();
  for (const name of stagingTargets) {
    const selected = targetFor(name);
    const app = join(directory, selected.directory);
    mkdirSync(app, { recursive: true });
    const destination = join(app, selected.config);
    copyFileSync(source(name), destination);
    original.set(destination, readFileSync(destination));
    copyFileSync(join(root, selected.directory, 'package.json'), join(app, 'package.json'));
    if (selected.assets) {
      const assets = join(app, selected.assets);
      mkdirSync(assets, { recursive: true });
      writeFileSync(join(assets, 'index.html'), `<title>${name}</title>`);
    }
  }
  const wranglerPackage = join(directory, 'node_modules/wrangler');
  mkdirSync(join(wranglerPackage, 'bin'), { recursive: true });
  writeFileSync(join(wranglerPackage, 'package.json'), '{"name":"wrangler","version":"0.0.0"}');
  writeFileSync(join(wranglerPackage, 'bin/wrangler.js'), '');

  const calls = [];
  const run = (command, args, options = {}) => {
    const call = { command, args: [...args], cwd: options.cwd, env: options.env, input: options.input };
    calls.push(call);
    if (command === 'git') {
      assert.equal(options.cwd, directory);
      if (args.join(' ') === 'rev-parse HEAD') return behavior.sha ?? sha;
      if (args.join(' ') === 'status --porcelain') return behavior.dirty ? ' M worker/index.ts' : '';
      if (args.join(' ') === 'remote get-url origin') return behavior.origin ?? 'git@github.com:mainbrella/canopy.git';
      throw new Error(`Unexpected fixture git command: ${args.join(' ')}`);
    }
    if (command === 'npm') {
      assert.equal(args[0], 'run');
      assert.equal(options.env.VITE_API_URL, STAGING.apiOrigin);
      assert.equal(options.env.VITE_GA_MEASUREMENT_ID, '');
      return '';
    }
    assert.equal(command, process.execPath);
    assert.equal(realpathSync(args[0]), realpathSync(join(wranglerPackage, 'bin/wrangler.js')));
    if (args[1] === 'whoami') {
      assert.deepEqual(args.slice(1), ['whoami', '--json']);
      assert.equal(options.cwd, join(directory, 'apps/backend'));
      assert.equal(options.env.CLOUDFLARE_API_TOKEN, releaseEnv.CLOUDFLARE_API_TOKEN);
      return JSON.stringify(behavior.whoami ?? { loggedIn: true, accounts: [{ id: STAGING.accountId }] });
    }
    const configPath = args[args.indexOf('--config') + 1];
    assert.ok(configPath && configPath.startsWith(directory));
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    call.config = config;
    call.configPath = configPath;
    assert.equal(config.account_id, STAGING.accountId);
    assert.match(config.name, /-stg$/);
    assert.equal(config.vars.DEPLOYMENT_ENVIRONMENT, 'staging');
    assert.equal(options.cwd, join(directory, 'apps', config.name === 'mainbrella-raindrop-stg' ? 'raindrop'
      : ['mainbrella-web-stg', 'mainbrella-builder-stg'].includes(config.name) ? 'web' : 'backend'));
    if (args[1] === 'deploy' && args.includes('--dry-run')) {
      const outdir = join(options.cwd, args[args.indexOf('--outdir') + 1]);
      mkdirSync(outdir, { recursive: true });
      writeFileSync(join(outdir, 'bundle.js'), `// ${config.name}: ${config.main ?? 'assets'}\n`);
      if (['mainbrella-api-stg', 'mainbrella-admin-stg', 'mainbrella-marketing-stg'].includes(config.name)) {
        const input = config.name === 'mainbrella-api-stg' ? 'worker/index.ts'
          : config.name === 'mainbrella-admin-stg' ? 'worker/admin.ts' : 'worker/marketing.ts';
        writeFileSync(join(outdir, 'bundle-meta.json'), JSON.stringify({ inputs: { [input]: {} } }));
      }
      return '';
    }
    if (args[1] === 'deploy') {
      const secretFlag = args.indexOf('--secrets-file');
      if (secretFlag !== -1) {
        const secretPath = args[secretFlag + 1];
        assert.ok(secretPath.startsWith(directory));
        assert.equal(statSync(secretPath).mode & 0o777, 0o600);
        call.secrets = JSON.parse(readFileSync(secretPath, 'utf8'));
        call.secretPath = secretPath;
        assert.ok(Object.keys(call.secrets).every(key => !args.some(arg => arg.includes(call.secrets[key]))));
      }
      if (behavior.failDeploy === config.name && config.main !== 'worker/staging-bootstrap.ts') throw new Error('fixture deploy failed');
      const worker = behavior.wrongReceiptWorker === config.name ? 'mainbrella-api' : config.name;
      const receipt = options.env.WRANGLER_OUTPUT_FILE_PATH;
      assert.ok(receipt?.startsWith(join(directory, 'artifacts/staging')));
      if (behavior.omitReceipt !== config.name) {
        const publicationCount = calls.filter(item => item.command === process.execPath && item.args[1] === 'deploy'
          && !item.args.includes('--dry-run')).length;
        writeFileSync(receipt, JSON.stringify({ type: 'deploy', worker_name: worker,
          version_id: version(publicationCount), timestamp: '2026-10-16T00:00:00.000Z' }) + '\n', { flag: 'a' });
      }
      return '';
    }
    if (args[1] === 'd1') {
      assert.deepEqual(args.slice(1, 6), ['d1', 'migrations', 'apply', args[4], '--remote']);
      assert.ok(['DB', 'PREVIEW_ROUTES'].includes(args[4]));
      assert.equal(config.name, 'mainbrella-api-stg');
      return '';
    }
    throw new Error(`Unexpected fixture command: ${args.join(' ')}`);
  };
  const provider = [];
  const provision = async ({ env, create }) => {
    provider.push({ kind: 'provision', create });
    assert.equal(env.CLOUDFLARE_API_TOKEN, releaseEnv.CLOUDFLARE_API_TOKEN);
    return stagedResources;
  };
  const request = async (address, init) => {
    provider.push({ kind: 'request', address, method: init.method });
    assert.equal(init.method, 'GET');
    assert.equal(address, `https://api.cloudflare.com/client/v4/accounts/${STAGING.accountId}/workers/scripts/mainbrella-api-stg/deployments`);
    return behavior.existingApi ? Response.json({ success: true, result: { deployments: [{}] } })
      : new Response(null, { status: 404 });
  };
  const preflights = [];
  const preflight = async (name, options) => {
    preflights.push(name);
    assert.deepEqual(options.resources, stagedResources);
    assert.equal(options.directory, directory);
    assert.equal(options.configurations[name].name, `${targetFor(name).worker}-stg`);
    if (behavior.failPreflight === name) throw new Error('fixture preflight failed');
  };
  const imageReads = [];
  const images = ({ directory: location }) => {
    imageReads.push(location);
    assert.equal(location, directory);
    return structuredClone(stagedCatalog);
  };
  const logs = [];
  const options = { directory, env: { ...releaseEnv }, run, request, provision, preflight, images,
    log: message => logs.push(message) };
  const evidence = () => {
    const base = join(directory, 'artifacts/staging');
    const dirs = readdirSync(base);
    assert.equal(dirs.length, 1);
    return JSON.parse(readFileSync(join(base, dirs[0], 'release.json'), 'utf8'));
  };
  const assertClean = () => {
    for (const app of ['backend', 'web', 'raindrop']) {
      assert.deepEqual(readdirSync(join(directory, `apps/${app}`)).filter(name => name.startsWith('.wrangler-local-staging-')), []);
    }
    for (const [path, bytes] of original) assert.deepEqual(readFileSync(path), bytes, path);
  };
  return { directory, calls, provider, preflights, imageReads, logs, options, evidence, assertClean, original };
}

const deployCalls = fixture => fixture.calls.filter(call => call.command === process.execPath && call.args[1] === 'deploy'
  && !call.args.includes('--dry-run'));
const bundleCalls = (fixture, worker) => fixture.calls.filter(call => call.command === process.execPath
  && call.args[1] === 'deploy' && call.args.includes('--dry-run') && call.config.name === worker);
function expectedPublishedHash(call, assets) {
  const outdir = join(call.cwd, call.args[call.args.indexOf('--outdir') + 1]);
  return createHash('sha256').update(artifactHash([outdir, ...(assets ? [join(call.cwd, assets)] : [])]))
    .update('\0').update(JSON.stringify(call.config)).digest('hex');
}

test('operation and secret gates reject the wrong source or live credentials before mutation', async t => {
  assert.throws(() => validateStagingOperation('deploy', 'all', releaseEnv, sha), /one staging deploy target/);
  for (const change of [
    { GITHUB_ACTIONS: 'false' }, { GITHUB_REPOSITORY: 'other/repo' },
    { GITHUB_WORKFLOW_REF: 'mainbrella/canopy/.github/workflows/deploy.yml@refs/heads/main' },
    { CANOPY_STAGING_DEPLOYS_ENABLED: 'false' }, { RELEASE_SHA: 'b'.repeat(40) },
    { CLOUDFLARE_ACCOUNT_ID: 'wrong' }, { CLOUDFLARE_API_TOKEN: '' },
  ]) assert.throws(() => validateStagingOperation('deploy', 'api', { ...releaseEnv, ...change }, sha));
  for (const invalid of ['{', '[]', '{"STRIPE_SECRET_KEY":"sk_live_bad"}',
    '{"STRIPE_PUBLISHABLE_KEY":"pk_live_bad"}', '{"UNKNOWN":"value"}',
    '{"MONITORING_SECRET":"short"}', '{"STRIPE_PREPAID_PRICE_ID":"price_test"}',
    '{"STRIPE_SECRET_KEY":"sk_test_safe","STRIPE_PREPAID_PRICE_ID":"invalid"}']) assert.throws(() => stagingSecrets(invalid));
  assert.deepEqual(stagingSecrets('{"STRIPE_SECRET_KEY":"rk_test_safe","STRIPE_PUBLISHABLE_KEY":"pk_test_safe"}'),
    { STRIPE_SECRET_KEY: 'rk_test_safe', STRIPE_PUBLISHABLE_KEY: 'pk_test_safe' });
  assert.deepEqual(stagingSecrets('{"STRIPE_SECRET_KEY":"sk_test_safe","STRIPE_PREPAID_PRICE_ID":"price_test"}'),
    { STRIPE_SECRET_KEY: 'sk_test_safe', STRIPE_PREPAID_PRICE_ID: 'price_test' });
  const f = fixture(t);
  f.options.env.STAGING_SECRETS_JSON = '{"STRIPE_SECRET_KEY":"sk_live_bad"}';
  await assert.rejects(stagingOperation('deploy', { ...f.options, target: 'api' }), /test keys only/);
  assert.deepEqual(f.calls.map(call => call.command), ['git']);
  assert.deepEqual(f.provider, []);
  assert.equal(existsSync(join(f.directory, 'artifacts/staging')), false);
  f.assertClean();
});

test('offline check validates every staging target without provider calls, secrets, or source edits', async t => {
  const f = fixture(t);
  f.options.env.STAGING_SECRETS_JSON = '{"STRIPE_SECRET_KEY":"sk_live_ignored_offline"}';
  f.options.env.VITE_API_URL = 'https://api.mainbrella.com';
  f.options.env.VITE_GA_MEASUREMENT_ID = 'G-PRODUCTION';
  f.options.provision = () => { throw new Error('Offline check reached provisioner'); };
  f.options.request = () => { throw new Error('Offline check reached provider'); };
  f.options.images = () => { throw new Error('Offline check reached image publisher'); };
  const result = await stagingOperation('check', f.options);
  assert.equal(result.status, 'success');
  assert.deepEqual(Object.keys(result.validatedArtifacts), stagingTargets);
  assert.deepEqual(f.provider, []);
  assert.equal(deployCalls(f).length, 0);
  assert.equal(f.calls.filter(call => call.command === process.execPath && call.args.includes('--dry-run')).length, 8);
  assert.ok(f.calls.filter(call => call.command === 'npm').every(call => call.env.VITE_API_URL === STAGING.apiOrigin
    && call.env.VITE_GA_MEASUREMENT_ID === ''));
  assert.equal(f.evidence().publications.length, 0);
  f.assertClean();
});

test('backend-only check validates four workers offline without credentials or provider calls', async t => {
  const f = fixture(t);
  f.options.env = { STAGING_SECRETS_JSON: '{"STRIPE_SECRET_KEY":"sk_live_ignored_offline"}' };
  f.options.provision = () => { throw new Error('Backend check reached provisioner'); };
  f.options.request = () => { throw new Error('Backend check reached provider'); };
  f.options.images = () => { throw new Error('Backend check reached image publisher'); };
  const result = await stagingOperation('check-backend', f.options);
  assert.equal(result.status, 'success');
  assert.deepEqual(Object.keys(result.validatedArtifacts), stagingBackendTargets);
  assert.equal(f.calls.filter(call => call.command === 'npm').length, 7);
  assert.deepEqual(f.calls.filter(call => call.command === process.execPath && call.args.includes('--dry-run'))
    .map(call => call.config.name), stagingBackendTargets.map(name => `${targetFor(name).worker}-stg`));
  assert.equal(deployCalls(f).length, 0);
  assert.deepEqual(f.provider, []);
  f.assertClean();
});

test('local backend bootstrap gates source, origin, token, account and Wrangler identity before builds', async t => {
  const localEnv = { CLOUDFLARE_API_TOKEN: releaseEnv.CLOUDFLARE_API_TOKEN,
    CLOUDFLARE_ACCOUNT_ID: STAGING.accountId };
  assert.doesNotThrow(() => validateStagingOperation('bootstrap-backend', 'all', localEnv, sha));
  for (const [behavior, env, message] of [
    [{}, { ...localEnv, CLOUDFLARE_API_TOKEN: '' }, /Cloudflare token/],
    [{}, { ...localEnv, CLOUDFLARE_ACCOUNT_ID: undefined }, /explicit staging Cloudflare account/],
    [{ sha: 'short' }, localEnv, /full source commit SHA/],
    [{ dirty: true }, localEnv, /Commit all local changes/],
    [{ origin: 'git@github.com:other/canopy.git' }, localEnv, /canonical Canopy origin/],
    [{ whoami: { loggedIn: true, accounts: [{ id: 'wrong' }] } }, localEnv, /credentials must access/],
  ]) {
    const f = fixture(t, behavior);
    f.options.env = env;
    await assert.rejects(stagingOperation('bootstrap-backend', f.options), message);
    assert.deepEqual(f.provider, []);
    assert.equal(f.calls.some(call => call.command === 'npm'), false);
    assert.equal(deployCalls(f).length, 0);
    assert.equal(existsSync(join(f.directory, 'artifacts/staging')), false);
    f.assertClean();
  }
});

test('local backend bootstrap provisions stage resources and publishes stub plus exact four workers', async t => {
  const f = fixture(t);
  f.options.env = { CLOUDFLARE_API_TOKEN: releaseEnv.CLOUDFLARE_API_TOKEN,
    CLOUDFLARE_ACCOUNT_ID: STAGING.accountId };
  const result = await stagingOperation('bootstrap-backend', f.options);
  assert.equal(result.status, 'success');
  assert.deepEqual(f.provider.map(call => call.kind), ['provision', 'request']);
  assert.equal(f.provider[0].create, true);
  assert.deepEqual(f.calls.filter(call => call.command === process.execPath && call.args[1] === 'd1')
    .map(call => call.args[4]), ['DB', 'PREVIEW_ROUTES']);
  assert.deepEqual(deployCalls(f).map(call => call.config.name), [
    'mainbrella-api-stg', 'mainbrella-admin-stg', 'mainbrella-marketing-stg',
    'mainbrella-containers-stg', 'mainbrella-api-stg',
  ]);
  assert.equal(deployCalls(f)[0].config.main, 'worker/staging-bootstrap.ts');
  assert.deepEqual(deployCalls(f)[4].config.routes, [{ pattern: 'api-stg.mainbrella.com', custom_domain: true }]);
  assert.deepEqual(f.preflights, ['admin', 'marketing', 'containers', 'api']);
  assert.deepEqual(result.publications.map(item => item.kind),
    ['bootstrap-declarations', 'application', 'application', 'application', 'application']);
  assert.deepEqual(Object.keys(result.imageDigests), IMAGE_CATALOG.map(entry => entry.key));
  assert.ok(deployCalls(f).every(call => !['mainbrella-previews-stg', 'mainbrella-web-stg',
    'mainbrella-builder-stg', 'mainbrella-raindrop-stg'].includes(call.config.name)));
  f.assertClean();
});

test('ordinary release deploys only the selected worker with staged build env and exact receipt', async t => {
  const f = fixture(t);
  Object.assign(f.options.env, { VITE_API_URL: 'https://api.mainbrella.com', VITE_GA_MEASUREMENT_ID: 'G-PRODUCTION',
    VITE_GOOGLE_CLIENT_ID: 'production-client', STAGING_GOOGLE_CLIENT_ID: 'staging-client' });
  const result = await stagingOperation('deploy', { ...f.options, target: 'site' });
  assert.equal(result.status, 'success');
  assert.deepEqual(f.provider, [{ kind: 'provision', create: false }]);
  assert.deepEqual(f.preflights, ['site']);
  assert.equal(f.imageReads.length, 0);
  assert.deepEqual(deployCalls(f).map(call => call.config.name), ['mainbrella-web-stg']);
  assert.deepEqual(result.publications.map(item => [item.worker, item.workerVersion, item.target, item.kind]),
    [['mainbrella-web-stg', version(1), 'site', 'application']]);
  assert.match(result.publications[0].validatedArtifactSha256, /^[a-f0-9]{64}$/);
  for (const call of f.calls.filter(item => item.command !== 'git')) {
    assert.equal(call.env.VITE_API_URL, STAGING.apiOrigin);
    assert.equal(call.env.VITE_GA_MEASUREMENT_ID, '');
    assert.equal(call.env.VITE_GOOGLE_CLIENT_ID, 'staging-client');
  }
  assert.equal(deployCalls(f)[0].secrets, undefined);
  f.assertClean();
});

test('publication hash covers final stage bindings and image digests after offline checks', async t => {
  const changedResources = { ...resources,
    databaseId: '00000000-0000-4000-8000-000000000003',
    previewDatabaseId: '00000000-0000-4000-8000-000000000004' };
  const api = fixture(t, { resources: changedResources });
  const apiResult = await stagingOperation('deploy', { ...api.options, target: 'api' });
  const apiBundles = bundleCalls(api, 'mainbrella-api-stg');
  assert.equal(apiBundles.length, 2);
  assert.equal(apiBundles[0].config.d1_databases[0].database_id, resources.databaseId);
  assert.equal(apiBundles[1].config.d1_databases[0].database_id, changedResources.databaseId);
  assert.equal(apiResult.publications[0].validatedArtifactSha256, expectedPublishedHash(apiBundles[1]));
  assert.notEqual(apiResult.publications[0].validatedArtifactSha256, expectedPublishedHash(apiBundles[0]));
  api.assertClean();

  const changedCatalog = structuredClone(catalog);
  changedCatalog.terminal.image = changedCatalog.terminal.image.replace(/b{64}$/, 'c'.repeat(64));
  const containers = fixture(t, { catalog: changedCatalog });
  const containerResult = await stagingOperation('deploy', { ...containers.options, target: 'containers' });
  const containerBundles = bundleCalls(containers, 'mainbrella-containers-stg');
  assert.equal(containerBundles.length, 2);
  assert.equal(containerBundles[0].config.containers, undefined);
  assert.equal(containerBundles[1].config.containers, undefined);
  const finalConfig = deployCalls(containers)[0].config;
  assert.deepEqual(finalConfig.containers[0].images, changedCatalog);
  const finalBundle = join(containerBundles[1].cwd, containerBundles[1].args[containerBundles[1].args.indexOf('--outdir') + 1]);
  const expected = createHash('sha256').update(artifactHash([finalBundle])).update('\0')
    .update(JSON.stringify(finalConfig)).digest('hex');
  assert.equal(containerResult.publications[0].validatedArtifactSha256, expected);
  containers.assertClean();
});

test('test-only secrets travel with the selected code version and are erased afterward', async t => {
  const f = fixture(t);
  f.options.env.STAGING_SECRETS_JSON = JSON.stringify({ STRIPE_SECRET_KEY: 'sk_test_stage',
    STRIPE_PUBLISHABLE_KEY: 'pk_test_stage', MONITORING_SECRET: 'm'.repeat(32) });
  const result = await stagingOperation('deploy', { ...f.options, target: 'api' });
  assert.equal(result.status, 'success');
  const [publish] = deployCalls(f);
  assert.deepEqual(publish.secrets, { STRIPE_SECRET_KEY: 'sk_test_stage',
    STRIPE_PUBLISHABLE_KEY: 'pk_test_stage', MONITORING_SECRET: 'm'.repeat(32) });
  assert.equal(existsSync(publish.secretPath), false);
  assert.ok(!JSON.stringify(f.evidence()).includes('sk_test_stage'));
  assert.ok(!JSON.stringify(publish.args).includes('sk_test_stage'));
  f.assertClean();
});

test('new bootstrap uses one unrouted namespace stub, stage migrations, then all stage workers', async t => {
  const f = fixture(t);
  f.options.env.STAGING_SECRETS_JSON = JSON.stringify({ STRIPE_SECRET_KEY: 'sk_test_stage' });
  const result = await stagingOperation('bootstrap', f.options);
  assert.equal(result.status, 'success');
  assert.deepEqual(f.provider.map(call => call.kind), ['provision', 'request']);
  assert.equal(f.provider[0].create, true);
  const migrations = f.calls.filter(call => call.command === process.execPath && call.args[1] === 'd1');
  assert.deepEqual(migrations.map(call => call.args[4]), ['DB', 'PREVIEW_ROUTES']);
  assert.deepEqual(result.migrations, ['DB', 'PREVIEW_ROUTES']);
  const published = deployCalls(f);
  assert.deepEqual(published.map(call => call.config.name), ['mainbrella-api-stg',
    ...['admin', 'marketing', 'containers', 'api', 'previews', 'site', 'builder', 'raindrop']
      .map(name => `${targetFor(name).worker}-stg`)]);
  const stub = published[0].config;
  assert.equal(stub.main, 'worker/staging-bootstrap.ts');
  assert.deepEqual(stub.vars, { DEPLOYMENT_ENVIRONMENT: 'staging' });
  for (const field of ['routes', 'triggers', 'services', 'workflows', 'd1_databases', 'r2_buckets', 'containers', 'send_email']) {
    assert.equal(stub[field], undefined, field);
  }
  assert.ok(stub.durable_objects.bindings.every(binding => !binding.script_name));
  assert.deepEqual(stub.exports, stagingBootstrapConfig(published[4].config).exports);
  assert.deepEqual(published[1].secrets, { STRIPE_SECRET_KEY: 'sk_test_stage' });
  assert.deepEqual(published[4].secrets, { STRIPE_SECRET_KEY: 'sk_test_stage' });
  assert.equal(published[0].secrets, undefined);
  assert.equal(result.publications.length, 9);
  assert.equal(result.publications[0].kind, 'bootstrap-declarations');
  const [stubBundle] = bundleCalls(f, 'mainbrella-api-stg').filter(call => call.config.main === 'worker/staging-bootstrap.ts');
  assert.equal(result.publications[0].validatedArtifactSha256, expectedPublishedHash(stubBundle));
  assert.deepEqual(f.preflights, ['admin', 'marketing', 'containers', 'api', 'previews', 'site', 'builder', 'raindrop']);
  assert.deepEqual(f.imageReads, [f.directory]);
  assert.deepEqual(result.imageDigests, catalog);
  const productionIds = JSON.parse(readFileSync(source('api'), 'utf8')).d1_databases.map(item => item.database_id);
  for (const call of published) {
    for (const database of call.config.d1_databases ?? []) {
      assert.equal(database.database_id, database.binding === 'PREVIEW_ROUTES' ? resources.previewDatabaseId : resources.databaseId);
    }
    for (const id of productionIds) assert.ok(!JSON.stringify(call.config).includes(id));
  }
  f.assertClean();
});

test('bootstrap skips the namespace stub when the staged API already exists', async t => {
  const f = fixture(t, { existingApi: true });
  const result = await stagingOperation('bootstrap', f.options);
  assert.equal(result.status, 'success');
  assert.equal(deployCalls(f).length, 8);
  assert.equal(deployCalls(f).some(call => call.config.main === 'worker/staging-bootstrap.ts'), false);
  assert.equal(result.publications.length, 8);
  f.assertClean();
});

test('missing bootstrap receipt stops before any dependent worker publishes', async t => {
  const f = fixture(t, { omitReceipt: 'mainbrella-api-stg' });
  await assert.rejects(stagingOperation('bootstrap', f.options), /namespace bootstrap must report exactly one version/);
  assert.deepEqual(deployCalls(f).map(call => call.config.name), ['mainbrella-api-stg']);
  assert.deepEqual(f.evidence().publications, []);
  assert.equal(f.evidence().status, 'failed');
  f.assertClean();
});

test('failed deploy removes its temporary secret file and records no credentials', async t => {
  const f = fixture(t, { failDeploy: 'mainbrella-api-stg' });
  f.options.env.STAGING_SECRETS_JSON = '{"STRIPE_SECRET_KEY":"sk_test_stage"}';
  await assert.rejects(stagingOperation('deploy', { ...f.options, target: 'api' }), /fixture deploy failed/);
  const [publish] = deployCalls(f);
  assert.deepEqual(publish.secrets, { STRIPE_SECRET_KEY: 'sk_test_stage' });
  assert.equal(existsSync(publish.secretPath), false);
  assert.deepEqual(f.evidence().publications, []);
  assert.ok(!JSON.stringify(f.evidence()).includes('sk_test_stage'));
  f.assertClean();
});

test('preflight failure prevents publication, while wrong receipts and partial failures preserve evidence', async t => {
  const preflight = fixture(t, { failPreflight: 'api' });
  await assert.rejects(stagingOperation('deploy', { ...preflight.options, target: 'api' }), /fixture preflight failed/);
  assert.equal(deployCalls(preflight).length, 0);
  assert.equal(preflight.evidence().status, 'failed');
  preflight.assertClean();

  const wrong = fixture(t, { wrongReceiptWorker: 'mainbrella-web-stg' });
  await assert.rejects(stagingOperation('deploy', { ...wrong.options, target: 'site' }), /Unexpected staging publication receipt/);
  assert.equal(wrong.evidence().status, 'failed');
  assert.ok(wrong.evidence().receiptError);
  wrong.assertClean();

  const partial = fixture(t, { failDeploy: 'mainbrella-marketing-stg' });
  await assert.rejects(stagingOperation('bootstrap', partial.options), /fixture deploy failed/);
  assert.equal(partial.evidence().status, 'failed');
  assert.deepEqual(partial.evidence().publications.map(item => item.worker), ['mainbrella-api-stg', 'mainbrella-admin-stg']);
  assert.ok(partial.logs.at(-1).includes('failed'));
  partial.assertClean();
});

test('published catalog images are read-only release assets pinned to this account and Dockerfiles', t => {
  const directory = mkdtempSync(join(tmpdir(), 'canopy-staging-images-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const values = Object.fromEntries(IMAGE_CATALOG.map(entry => {
    const from = join(root, 'apps/linux', entry.dockerfile);
    const to = join(directory, 'apps/linux', entry.dockerfile);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    return [entry.key, { image: catalog[entry.key].image,
      dockerfileHash: createHash('sha256').update(readFileSync(to)).digest('hex') }];
  }));
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    assert.equal(command, 'gh');
    if (args[1] === 'repos/mainbrella/backend/releases/tags/terminal-image') return JSON.stringify({ assets: [
      { name: 'terminal-image.json', id: 1 }, { name: 'catalog-images.json', id: 2 },
    ] });
    return JSON.stringify(args[1].endsWith('/1') ? values.terminal : { images: values });
  };
  assert.deepEqual(publishedStagingImages({ directory, run }), catalog);
  assert.deepEqual(calls.map(call => call.slice(0, 3)), [
    ['gh', 'api', 'repos/mainbrella/backend/releases/tags/terminal-image'], ['gh', 'api', 'repos/mainbrella/backend/releases/assets/1'],
    ['gh', 'api', 'repos/mainbrella/backend/releases/assets/2'],
  ]);
});
