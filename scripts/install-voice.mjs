import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir, mkdir, writeFile, open, unlink } from "node:fs/promises";
import { resolve, relative, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const product = join(root, "products/voice");
const cache = join(root, ".cache");
const cli = join(root, "node_modules/wrangler/bin/wrangler.js");
const environment = { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: join(cache, "wrangler/logs"),
  XDG_CONFIG_HOME: join(cache, "config"), XDG_CACHE_HOME: cache, TMPDIR: join(cache, "tmp") };

function run(command, args, cwd = root, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: environment, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    let output = "";
    if (capture) child.stdout.on("data", chunk => { output += chunk; });
    // Captured auth output (including errors) must never print a token.
    if (capture) child.stderr.on("data", () => {});
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve(output.trim()) : reject(new Error(`${command === process.execPath ? "Wrangler" : command} failed (${code}).${capture ? " Check repository-local Cloudflare authentication." : ""}`)));
  });
}
function repositoryPath(value) {
  const path = resolve(root, value);
  if (relative(root, path).startsWith("..") || path === root) throw new Error("Install configuration paths must stay inside Canopy.");
  return path;
}
function origin(value) { const url = new URL(value); return url.protocol === "https:" && url.origin === value; }
export function validateTarget(target, accounts, consoleConfig) {
  if (!/^[a-f0-9]{32}$/.test(target.accountId) || !/^[a-z][a-z0-9-]{2,62}$/.test(target.workerName)
    || !/^[a-z][a-z0-9-]{2,62}$/.test(target.databaseName) || !origin(target.origin)
    || !origin(target.accountsOrigin) || !origin(target.consoleOrigin)) throw new Error("Invalid Voice install target.");
  const db = accounts.d1_databases?.find(db => db.binding === "DB");
  if (accounts.account_id !== target.accountId || consoleConfig.account_id !== target.accountId
    || accounts.routes?.[0]?.pattern !== new URL(target.accountsOrigin).hostname
    || consoleConfig.routes?.[0]?.pattern !== new URL(target.consoleOrigin).hostname
    || !db?.database_id || db.database_name === target.databaseName || accounts.name === target.workerName
    || ["mainbrella-web", "mainbrella-api"].includes(accounts.name)
    || ["mainbrella-web", "mainbrella-api"].includes(consoleConfig.name) || db.database_name === "delta") {
    throw new Error("Install target does not match a dedicated Canopy instance.");
  }
  return db.database_id;
}

// Creation intent survives an interrupted response. A retry can reuse only the
// dedicated name whose absence was checked before the intent was persisted.
export async function ensureDatabase({ target, state, list, create, persist }) {
  const databases = await list();
  const found = databases.find(db => db.name === target.databaseName);
  if (state.databaseId) {
    if (!found || found.uuid !== state.databaseId) throw new Error("Recorded Voice database does not match the target account.");
    return found.uuid;
  }
  if (found && !state.creatingDatabase) throw new Error("A database already uses the dedicated Voice name. Refusing to adopt it.");
  if (!found) { state.creatingDatabase = true; await persist(); }
  const database = found ?? await create();
  state.databaseId = database.uuid;
  await persist();
  return state.databaseId;
}

async function sourceIdentity() {
  const files = [];
  async function collect(path) {
    for (const entry of (await readdir(join(product, path), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const name = `${path}/${entry.name}`;
      if (entry.isDirectory()) await collect(name); else files.push(name);
    }
  }
  for (const path of ["worker", "src", "public", "migrations"]) await collect(path);
  files.push("index.html", "login.html", "handoff.html", "package.json", "vite.config.ts", "wrangler.jsonc");
  const hashes = {};
  for (const file of files.sort()) hashes[file] = createHash("sha256").update(await readFile(join(product,file))).digest("hex");
  const fingerprint = createHash("sha256").update(JSON.stringify(hashes)).digest("hex");
  const revision = await run("git", ["rev-parse", "HEAD"], root, true);
  const dirty = Boolean(await run("git", ["status", "--porcelain", "--untracked-files=all"], root, true));
  return { version: `0.1.0+${fingerprint.slice(0,16)}`, revision, dirty, fingerprint, hashes };
}

export async function main(args = process.argv.slice(2)) {
  if (args[0] !== "--config" || !args[1] || args.slice(2).some(arg => arg !== "--plan")) throw new Error("Use --config config/voice.staging.json [--plan].");
  const target = JSON.parse(await readFile(repositoryPath(args[1]), "utf8"));
  const accountsPath = repositoryPath(target.accountsConfig);
  const consolePath = repositoryPath(target.consoleConfig);
  const accounts = JSON.parse(await readFile(accountsPath, "utf8"));
  const consoleConfig = JSON.parse(await readFile(consolePath, "utf8"));
  const accountsDb = validateTarget(target, accounts, consoleConfig);
  const source = await sourceIdentity();
  console.log(JSON.stringify({ target, source: { version: source.version, revision: source.revision, dirty: source.dirty } },null,2));
  if (args.includes("--plan")) return;
  const directory = join(cache,"voice-installs",createHash("sha256").update(`${target.accountId}:${target.origin}`).digest("hex").slice(0,16));
  await mkdir(join(cache,"tmp"),{recursive:true});
  await mkdir(directory,{recursive:true,mode:0o700});
  const lockPath = join(directory,"lock");
  try {
    const lock = await open(lockPath,"wx",0o600);
    await lock.writeFile(String(process.pid)); await lock.close();
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const pid = Number(await readFile(lockPath,"utf8"));
    try { process.kill(pid,0); } catch (error) {
      if (error.code === "ESRCH") { await unlink(lockPath); return main(args); }
      throw error;
    }
    throw new Error("This installation is already running. No resources were changed.");
  }
  let api, query, state, lease;
  const stateFile = join(directory,"private.json");
  const persist = () => writeFile(stateFile,`${JSON.stringify(state,null,2)}\n`,{mode:0o600});
  try {
    const credentials = JSON.parse(await run(process.execPath,[cli,"auth","token","--json"],root,true));
    if (!["oauth","api_token"].includes(credentials.type) || !credentials.token) throw new Error("An OAuth login or scoped API token is required.");
    api = async (path, method = "GET", body) => {
      const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, { method, redirect:"error", signal:AbortSignal.timeout(30000),
        headers:{authorization:`Bearer ${credentials.token}`,"content-type":"application/json"}, body:body?JSON.stringify(body):undefined });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(`Cloudflare ${method} ${path} failed (HTTP ${response.status}; codes ${(result.errors??[]).map(error=>error.code).join(",")}).`);
      return result.result;
    };
    const accountPath = `/accounts/${target.accountId}`;
    await api(accountPath);
    await run(process.execPath,[cli,"d1","migrations","apply","DB","--remote","--config",accountsPath],dirname(accountsPath));
    query = async (sql, params = []) => (await api(`${accountPath}/d1/database/${accountsDb}/query`,"POST",{sql,params}))[0].results;
    const existing = (await query("SELECT * FROM product_installations WHERE product='voice'"))[0];
    try { state = JSON.parse(await readFile(stateFile,"utf8")); }
    catch(error) { if(error.code!=="ENOENT")throw error; }
    if (existing && !state) throw new Error("An installation already exists. Restore its private operator state before retrying; do not recreate resources.");
    state ??= { installationId:randomUUID(),secret:randomBytes(32).toString("hex"),target,creatingDatabase:false };
    if (JSON.stringify(state.target)!==JSON.stringify(target) || existing && existing.installation_id!==state.installationId) throw new Error("Installation ownership does not match this target.");
    if (existing?.state === "installed" && existing.version !== source.version) throw new Error("Voice is already installed at a different version. Automatic upgrades are outside this installer.");
    await persist();
    const workers = await api(`${accountPath}/workers/scripts`);
    const domains = await api(`${accountPath}/workers/domains`);
    if (domains.some(domain=>domain.hostname===new URL(target.origin).hostname && domain.service!==target.workerName)) throw new Error("The Voice hostname is already owned by another Worker.");
    if (!existing && workers.some(worker=>worker.id===target.workerName)) throw new Error("A Worker already uses the Voice name. Refusing to overwrite it.");
    lease = randomUUID();
    await query(`INSERT OR IGNORE INTO product_installations(product,installation_id,account_id,worker_name,origin,version,source_revision,state,updated_at)
      VALUES('voice',?,?,?,?,?,?,'installing',?)`,[state.installationId,target.accountId,target.workerName,target.origin,source.version,`${source.revision}${source.dirty?`+dirty.${source.fingerprint}`:""}`,new Date().toISOString()]);
    const claimed = await query("UPDATE product_installations SET lease_token=?,lease_expires=? WHERE product='voice' AND (lease_expires IS NULL OR lease_expires<=?) RETURNING installation_id",[lease,Date.now()+15*60_000,Date.now()]);
    if (!claimed.length) { lease=null; throw new Error("Another operator holds this installation lease. Retry when it finishes or its 15-minute lease expires."); }
    if (existing?.state === "installed") {
      console.log("Voice is already installed; no resources or deployments were created.");
      return;
    }
    await query("UPDATE product_installations SET state='installing',version=?,source_revision=?,updated_at=? WHERE product='voice' AND lease_token=?",[source.version,`${source.revision}${source.dirty?`+dirty.${source.fingerprint}`:""}`,new Date().toISOString(),lease]);
    const databaseId = await ensureDatabase({target,state,persist,list:()=>api(`${accountPath}/d1/database?per_page=100`),create:()=>api(`${accountPath}/d1/database`,"POST",{name:target.databaseName})});
    await query("UPDATE product_installations SET database_id=? WHERE product='voice' AND lease_token=?",[databaseId,lease]);
    const voiceConfig = JSON.parse(await readFile(join(product,"wrangler.jsonc"),"utf8"));
    Object.assign(voiceConfig,{name:target.workerName,account_id:target.accountId,workers_dev:false,routes:[{pattern:new URL(target.origin).hostname,custom_domain:true}],secrets:{required:["CANOPY_AUTH_SECRET"]}});
    voiceConfig.d1_databases[0].database_name=target.databaseName;
    voiceConfig.d1_databases[0].database_id=databaseId;
    Object.assign(voiceConfig.vars,{VOICE_ENABLED:"true",VOICE_PUBLIC_ORIGIN:target.origin,VOICE_AUTH_MODE:"canopy",CANOPY_ACCOUNTS_ORIGIN:target.accountsOrigin,
      CANOPY_CONSOLE_ORIGIN:target.consoleOrigin,CANOPY_INSTALLATION_ID:state.installationId,CANOPY_SOURCE_VERSION:source.version});
    const voicePath = join(product,"wrangler.install.jsonc");
    await writeFile(voicePath,`${JSON.stringify(voiceConfig,null,2)}\n`);
    const voiceSecrets=join(directory,"voice-secrets.json"), accountSecrets=join(directory,"accounts-secrets.json");
    await writeFile(voiceSecrets,JSON.stringify({CANOPY_AUTH_SECRET:state.secret}),{mode:0o600});
    await writeFile(accountSecrets,JSON.stringify({VOICE_AUTH_SECRET:state.secret}),{mode:0o600});
    await run("npm",["run","build:client","--workspace","@canopy/voice"]);
    await run(process.execPath,[cli,"d1","migrations","apply","DB","--remote","--config",voicePath],product);
    await run(process.execPath,[cli,"deploy","--config",voicePath,"--secrets-file",voiceSecrets],product);
    const readiness=await fetch(`${target.origin}/_canopy/ready`,{headers:{authorization:`Bearer ${state.secret}`},redirect:"error",signal:AbortSignal.timeout(15000)});
    const ready=await readiness.json();
    if(!readiness.ok||!ready.ready||ready.installationId!==state.installationId||ready.version!==source.version)throw new Error("Voice runtime readiness did not match the installation.");
    await run(process.execPath,[cli,"deploy","--config",accountsPath,"--secrets-file",accountSecrets],dirname(accountsPath));
    const settings=await api(`${accountPath}/workers/scripts/${target.workerName}/settings`);
    const namespaceId=settings.bindings.find(binding=>binding.name==="RECEPTIONIST_CALL")?.namespace_id;
    if(!namespaceId)throw new Error("The deployed Voice namespace was not found.");
    await query("UPDATE product_installations SET state='installed',namespace_id=?,updated_at=? WHERE product='voice' AND lease_token=?",[namespaceId,new Date().toISOString(),lease]);
    await run("npm",["run","build:staging","--workspace","@canopy/console"]);
    await run(process.execPath,[cli,"deploy","--config",consolePath],dirname(consolePath));
    const inventory={time:new Date().toISOString(),target,installationId:state.installationId,databaseId,namespaceId,source};
    await writeFile(join(directory,"inventory.json"),`${JSON.stringify(inventory,null,2)}\n`);
    console.log(`Voice installed for this Canopy instance: ${target.consoleOrigin}/#/products/voice\nInventory: ${relative(root,join(directory,"inventory.json"))}`);
  } catch(error) {
    if (query && lease) await query("UPDATE product_installations SET state='failed',updated_at=? WHERE product='voice' AND lease_token=?",[new Date().toISOString(),lease]).catch(()=>{});
    throw error;
  } finally {
    if (query && lease) await query("UPDATE product_installations SET lease_token=NULL,lease_expires=NULL WHERE product='voice' AND lease_token=?",[lease]).catch(()=>{});
    await unlink(lockPath).catch(()=>{});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error=>{console.error(error.message);process.exitCode=1;});
