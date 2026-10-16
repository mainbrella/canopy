// Small, shared transport for the two explicit operator workflows; no browser credentials.
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('../', import.meta.url));
export const cache = join(root, '.cache');
export const cli = join(root, 'node_modules/wrangler/bin/wrangler.js');
export const environment = { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_SEND_ERROR_REPORTS: 'false',
  WRANGLER_LOG_PATH: join(cache, 'wrangler/logs'), XDG_CONFIG_HOME: join(cache, 'config'), XDG_CACHE_HOME: cache, TMPDIR: join(cache, 'tmp') };
export function repositoryPath(value) {
  const path = resolve(root, value);
  if (relative(root, path).startsWith('..') || path === root) throw new Error('Operator paths must stay inside Canopy.');
  return path;
}
export const validOrigin = value => { try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value; } catch { return false; } };
export function validateCoreConnection(target, accounts, consoleConfig) {
  const db=accounts.d1_databases?.find(binding=>binding.binding==='DB');
  if (!/^[a-f0-9]{32}$/.test(target.accountId) || !validOrigin(target.accountsOrigin) || !validOrigin(target.consoleOrigin)
    || target.accountsOrigin===target.consoleOrigin || accounts.account_id!==target.accountId || consoleConfig.account_id!==target.accountId
    || accounts.routes?.[0]?.pattern!==new URL(target.accountsOrigin).hostname || consoleConfig.routes?.[0]?.pattern!==new URL(target.consoleOrigin).hostname
    || !db?.database_id || db.database_id==='41be6d7b-26fb-4701-a3fb-fdf3454e14f9' || db.database_name==='delta'
    || [target.accountsOrigin,target.consoleOrigin].some(value=>['mainbrella.com','www.mainbrella.com','api.mainbrella.com'].includes(new URL(value).hostname))
    || [accounts.name,consoleConfig.name].some(name=>['mainbrella-web','mainbrella-api'].includes(name))) throw new Error('Dedicated core configuration does not match this account/origins.');
  return db.database_id;
}
export async function privateJSON(path, value) {
  await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}
export async function readJSON(path) { return JSON.parse(await readFile(path, 'utf8')); }
export function run(command, args, { cwd = root, capture = false, env = {}, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...environment, ...env }, signal, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let output = '';
    if (capture) { child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', () => {}); }
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(output.trim()) : reject(new Error(`${command === process.execPath ? 'Wrangler' : command} failed (${code}).`)));
  });
}
export async function cloudflare() {
  await mkdir(join(cache, 'tmp'), { recursive: true });
  const credentials = JSON.parse(await run(process.execPath, [cli, 'auth', 'token', '--json'], { capture: true }));
  if (!['oauth', 'api_token'].includes(credentials.type) || !credentials.token) throw new Error('A scoped Cloudflare API token or OAuth login is required.');
  return async (path, method = 'GET', body) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { authorization: `Bearer ${credentials.token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(`Cloudflare ${method} ${path} failed (HTTP ${response.status}).`);
    return result.result;
  };
}
export const d1Query = (api, accountId, databaseId) => async (sql, params = []) => {
  const result = await api(`/accounts/${accountId}/d1/database/${databaseId}/query`, 'POST', { sql, params });
  if (!result[0]?.success) throw new Error('D1 query failed.');
  return result[0].results;
};
export async function listDatabases(api, accountId) {
  const databases = [];
  for (let page = 1; page <= 1000; page++) {
    const batch = await api(`/accounts/${accountId}/d1/database?per_page=100&page=${page}`);
    databases.push(...batch);
    if (batch.length < 100) return databases;
  }
  throw new Error('Database inventory exceeds the supported pagination bound.');
}
export async function buildConsole(target, signal) {
  // Dedicated staging continues to use its guarded build. Other instances are explicit.
  const staging = target.consoleOrigin === 'https://stg.mainbrella.com';
  if (staging && target.accountsOrigin !== 'https://api-stg.mainbrella.com') throw new Error('Staging origins must remain paired.');
  await run('npm', ['run', staging ? 'build:staging' : 'build', '--workspace', '@canopy/console', ...(!staging ? ['--', '--mode', 'operator'] : [])], {
    signal, env: { CANOPY_ACCOUNTS_ORIGIN: target.accountsOrigin, CANOPY_PRODUCTS: (target.products ?? ['voice', 'cut']).join(','), CANOPY_INSTANCE_NAME: target.name ?? 'Canopy' },
  });
}
