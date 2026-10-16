import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { targetFor } from './deploy-targets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const execute = (command, args, options) => execFileSync(command, args, { stdio: 'inherit', ...options });
const capture = (run, command, args, options) => String(run(command, args, { ...options, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).trim();

export function parseArguments(args) {
  const [target, ...flags] = args;
  targetFor(target);
  if (flags.length > 1 || flags.some(flag => !['--check', '--execute'].includes(flag))) {
    throw new Error('Usage: npm run deploy:<target> [-- --check]. Releases use the production workflow at a committed source SHA.');
  }
  return { target, mode: flags[0]?.slice(2) ?? 'dispatch' };
}

export function validateConfiguration(name, configuration) {
  const target = targetFor(name);
  if (configuration.name !== target.worker) throw new Error(`${name}: config must name ${target.worker}.`);
  if (target.assets && configuration.assets?.directory !== target.assets) throw new Error(`${name}: unexpected asset directory.`);
  if (['admin', 'marketing', 'containers'].includes(name)
    && (configuration.workers_dev !== false || configuration.preview_urls !== false || configuration.routes?.length || configuration.route)) {
    throw new Error(`${name}: private worker must remain private.`);
  }
  if (['admin', 'marketing'].includes(name) && configuration.d1_databases?.some(database => database.migrations_dir)) {
    throw new Error('Only the API configuration owns shared D1 migrations.');
  }
  return target;
}

// Local commands dispatch the workflow so production releases share its lock.
export function dispatchRelease(name, { run = execute, directory = root } = {}) {
  targetFor(name);
  const options = { cwd: directory };
  if (capture(run, 'git', ['status', '--porcelain'], options)) throw new Error('Commit the intended release before dispatching it.');
  const sha = capture(run, 'git', ['rev-parse', 'HEAD'], options);
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Cannot identify the selected source commit.');
  const remote = capture(run, 'git', ['remote', 'get-url', 'origin'], options);
  if (!/^(?:git@github\.com:|https:\/\/github\.com\/)mainbrella\/canopy(?:\.git)?$/.test(remote)) throw new Error('Origin must be mainbrella/canopy.');
  run('git', ['fetch', '--no-tags', 'origin', 'main'], options);
  run('git', ['merge-base', '--is-ancestor', sha, 'FETCH_HEAD'], options);
  run('gh', ['workflow', 'run', 'deploy.yml', '--repo', 'mainbrella/canopy', '--ref', 'main',
    '-f', `target=${name}`, '-f', `source_sha=${sha}`, '-f', 'environment=production'], options);
  console.log(`Requested ${name} at ${sha}. Follow the production run in mainbrella/canopy Actions.`);
}

export function artifactHash(directories) {
  const hash = createHash('sha256');
  function walk(directory, relative = '') {
    for (const item of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(relative, item.name);
      if (item.isDirectory()) walk(join(directory, item.name), path);
      else if (item.isFile()) hash.update(path).update('\0').update(readFileSync(join(directory, item.name))).update('\0');
    }
  }
  for (const directory of directories) walk(directory);
  return hash.digest('hex');
}

export function release(name, { publish = false, run = execute, directory = root, env = process.env,
  readConfig = path => JSON.parse(readFileSync(path, 'utf8')), record = writeFileSync } = {}) {
  const target = targetFor(name);
  const cwd = join(directory, target.directory);
  const configuration = readConfig(join(cwd, target.config));
  validateConfiguration(name, configuration);
  if (publish && (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== 'mainbrella/canopy'
    || env.GITHUB_WORKFLOW_REF !== 'mainbrella/canopy/.github/workflows/deploy.yml@refs/heads/main')) {
    throw new Error('Production publishing must run through the Canopy production workflow and its deployment lock.');
  }
  const options = { cwd, env };
  const npm = (script, commandEnv = env, args = []) => run('npm', ['run', script, '--workspace', target.workspace, ...args], { cwd, env: commandEnv });
  if (!publish) {
    for (const script of target.checks) npm(script);
    bundleTarget(name, { run, directory, env, configuration });
    return;
  }
  for (const script of target.preflight) npm(script);
  const sourceSha = capture(run, 'git', ['rev-parse', 'HEAD'], { cwd: directory });
  if (sourceSha !== env.RELEASE_SHA || !/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error('Release checkout differs from the selected source SHA.');
  const output = join(directory, 'artifacts/releases');
  mkdirSync(output, { recursive: true });
  const publication = join(output, `${name}.wrangler.jsonl`);
  rmSync(publication, { force: true });
  const bundle = join('.wrangler', `release-${name}`);
  rmSync(join(cwd, bundle), { recursive: true, force: true });
  npm(target.publish, { ...env, WRANGLER_OUTPUT_FILE_PATH: publication }, ['--', `--outdir=${bundle}`]);
  // Record the actual deployment output, including assets built by its publisher.
  const hash = artifactHash([join(cwd, bundle), ...(target.assets ? [join(cwd, target.assets)] : [])]);
  const published = readFileSync(publication, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    .filter(entry => entry.type === 'deploy' && entry.version_id);
  if (published.length !== 1 || published[0].worker_name !== target.worker
    || !/^[a-f0-9-]{36}$/.test(published[0].version_id)) throw new Error('Publisher did not report exactly one selected worker version; inspect release output before retrying.');
  const workerVersion = published[0].version_id;
  const require = createRequire(join(cwd, 'package.json'));
  const wrangler = join(dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js');
  const deployments = JSON.parse(capture(run, process.execPath,
    [wrangler, 'deployments', 'list', '--config', target.config, '--json'], options));
  const deployed = deployments.find(item => item.versions?.length === 1 && item.versions[0].version_id === workerVersion);
  if (!deployed) throw new Error('Published worker deployment could not be recorded; inspect the deployment before retrying.');
  const evidence = { sourceSha, target: name, worker: target.worker, environment: 'production', artifactSha256: hash,
    workerVersion, deploymentId: deployed.id, recordedAt: new Date().toISOString() };
  record(join(output, `${name}.json`), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
  return evidence;
}

export function bundleTarget(name, { run = execute, directory = root, env = process.env,
  configuration = JSON.parse(readFileSync(join(directory, targetFor(name).directory, targetFor(name).config), 'utf8')) } = {}) {
  const target = validateConfiguration(name, configuration);
  const cwd = join(directory, target.directory);
  const require = createRequire(join(cwd, 'package.json'));
  const wrangler = join(dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js');
  const bundle = join('.wrangler', `release-${name}`);
  rmSync(join(cwd, bundle), { recursive: true, force: true });
  const temporary = name === 'containers' ? `.wrangler-local-bundle-${process.pid}.jsonc` : undefined;
  try {
    if (temporary) {
      // Even Wrangler's dry run builds Docker images. The bundle check only
      // needs worker code and bindings; the guarded publisher selects digests.
      const { containers, ...workerOnly } = configuration;
      writeFileSync(join(cwd, temporary), JSON.stringify(workerOnly));
    }
    run(process.execPath, [wrangler, 'deploy', '--dry-run', '--config', temporary ?? target.config, '--outdir', bundle], { cwd, env });
  } finally {
    if (temporary) rmSync(join(cwd, temporary), { force: true });
  }
  return { wrangler, bundle };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { target, mode } = parseArguments(process.argv.slice(2));
    if (mode === 'dispatch') dispatchRelease(target);
    else release(target, { publish: mode === 'execute' });
  } catch (error) {
    console.error(error.status ? 'Release command failed. Review the preceding command output before retrying.' : error.message);
    process.exitCode = 1;
  }
}
