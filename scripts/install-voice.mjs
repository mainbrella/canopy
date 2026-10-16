import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir, mkdir, writeFile, open, unlink } from "node:fs/promises";
import { resolve, relative, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { root, cache, cli, run as command, repositoryPath, cloudflare, d1Query, listDatabases, buildConsole, privateJSON } from "./operator.mjs";

const product = join(root, "products/voice");
let activeSignal;
const run = (cmd, args, cwd = root, capture = false, env = {}) => command(cmd, args, { cwd, capture, env, signal: activeSignal });
function origin(value) { try { const url = new URL(value); return url.protocol === "https:" && url.origin === value; } catch { return false; } }
export function validateTarget(target, accounts, consoleConfig) {
  if (!/^[a-f0-9]{32}$/.test(target.accountId) || !/^[a-z][a-z0-9-]{2,62}$/.test(target.workerName)
    || !/^[a-z][a-z0-9-]{2,62}$/.test(target.databaseName) || !origin(target.origin)
    || !origin(target.accountsOrigin) || !origin(target.consoleOrigin)
    || [target.origin,target.accountsOrigin,target.consoleOrigin].some(value=>['mainbrella.com','www.mainbrella.com','api.mainbrella.com'].includes(new URL(value).hostname))
    || (target.basePath ? target.basePath !== "/installed/voice" || target.origin !== target.consoleOrigin || target.accountsOrigin === target.consoleOrigin
      : new Set([target.origin,target.accountsOrigin,target.consoleOrigin]).size !== 3)
    || target.stateKey !== undefined && !/^[a-f0-9]{16}$/.test(target.stateKey)
    || target.legacyOrigin !== undefined && (!origin(target.legacyOrigin) || [target.origin,target.accountsOrigin].includes(target.legacyOrigin))
    || target.legacyOrigin && ['mainbrella.com','www.mainbrella.com','api.mainbrella.com'].includes(new URL(target.legacyOrigin).hostname)
    || [target.workerName,target.databaseName].some(name=>["mainbrella-web","mainbrella-api","delta"].includes(name))) throw new Error("Invalid Voice install target.");
  const db = accounts.d1_databases?.find(db => db.binding === "DB");
  if (accounts.account_id !== target.accountId || consoleConfig.account_id !== target.accountId
    || accounts.routes?.[0]?.pattern !== new URL(target.accountsOrigin).hostname
    || consoleConfig.routes?.[0]?.pattern !== new URL(target.consoleOrigin).hostname
    || !db?.database_id || db.database_id === "41be6d7b-26fb-4701-a3fb-fdf3454e14f9" || db.database_name === target.databaseName || accounts.name === target.workerName
    || ["mainbrella-web", "mainbrella-api"].includes(accounts.name)
    || ["mainbrella-web", "mainbrella-api"].includes(consoleConfig.name) || db.database_name === "delta") {
    throw new Error("Install target does not match a dedicated Canopy instance.");
  }
  return db.database_id;
}

// Persist creation intent, but reuse only a recorded UUID or explicitly
// reviewed recovery. A matching name alone cannot prove resource ownership.
export async function ensureDatabase({ target, state, list, create, persist, recoverDatabaseId }) {
  const databases = await list();
  const found = databases.find(db => db.name === target.databaseName);
  if (state.databaseId) {
    if (!found || found.uuid !== state.databaseId) throw new Error("Recorded Voice database does not match the target account.");
    return found.uuid;
  }
  if (found && (!state.creatingDatabase || recoverDatabaseId !== found.uuid)) throw new Error("A database already uses the dedicated name without a recorded UUID. Refusing to adopt it. Review Cloudflare creation evidence, then explicitly pass --recover-database UUID with the original private state.");
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
  hashes["workspace-lock"] = createHash("sha256").update(await readFile(join(root,"package-lock.json"))).digest("hex");
  const fingerprint = createHash("sha256").update(JSON.stringify(hashes)).digest("hex");
  const revision = await run("git", ["rev-parse", "HEAD"], root, true);
  const dirty = Boolean(await run("git", ["status", "--porcelain", "--untracked-files=all"], root, true));
  return { version: `0.1.0+${fingerprint.slice(0,16)}`, revision, dirty, fingerprint, hashes };
}

export async function claimInstallation(query, { target, state, source, lease, now = Date.now() }) {
  // One statement owns both the initial identity and the lease. A losing checkout
  // cannot lease the winner's row, even after a timeout or stale initial read.
  const rows = await query(`INSERT INTO product_installations
    (product,installation_id,account_id,worker_name,origin,version,source_revision,state,lease_token,lease_expires,updated_at,owner_user_id,source_repository,base_path)
    VALUES('voice',?,?,?,?,?,?,'installing',?,?,?,?, 'mainbrella/canopy',?)
    ON CONFLICT(product) DO UPDATE SET lease_token=excluded.lease_token,lease_expires=excluded.lease_expires
    WHERE product_installations.installation_id=excluded.installation_id
      AND product_installations.account_id=excluded.account_id AND product_installations.worker_name=excluded.worker_name
      AND product_installations.origin=excluded.origin AND product_installations.version=excluded.version AND product_installations.base_path=excluded.base_path
      AND (product_installations.lease_expires IS NULL OR product_installations.lease_expires<=?)
    RETURNING installation_id,state`, [state.installationId,target.accountId,target.workerName,target.origin,source.version,
      `${source.revision}${source.dirty ? `+dirty.${source.fingerprint}` : ''}`,lease,now+120_000,new Date(now).toISOString(),target.operatorUserId ?? null,target.basePath ?? '',now]);
  if (rows.length !== 1 || rows[0].installation_id !== state.installationId) throw new Error('Installation identity/version is owned by another operator or an active lease. Restore the matching private state; retry after expiry.');
  return rows[0];
}

export async function claimMountInstallation(query, { target, state, source, lease, now = Date.now() }) {
  const previous = state.mount;
  if (!previous || previous.version !== source.version || JSON.stringify(previous.to) !== JSON.stringify(target)) throw new Error('Mount recovery source/target mismatch.');
  const rows = await query(`UPDATE product_installations SET origin=?,base_path=?,version=?,source_revision=?,
    state=CASE WHEN origin=? AND version=? AND state='installed' THEN 'installed' ELSE 'installing' END,
    lease_token=?,lease_expires=?,updated_at=?
    WHERE product='voice' AND installation_id=? AND account_id=? AND worker_name=? AND database_id=?
      AND ((origin=? AND version=? AND base_path='') OR (origin=? AND version=? AND base_path=?))
      AND (lease_expires IS NULL OR lease_expires<=?) RETURNING installation_id,state`,
    [target.origin,target.basePath,source.version,`${source.revision}${source.dirty ? `+dirty.${source.fingerprint}` : ''}`,
      target.origin,source.version,lease,now+120_000,new Date(now).toISOString(),state.installationId,target.accountId,target.workerName,state.databaseId,
      previous.from.origin,previous.previousVersion,target.origin,source.version,target.basePath,now]);
  if (rows.length !== 1) throw new Error('Mount identity/version is owned by another operator or an active lease. Restore the matching private state.');
  return rows[0];
}

export async function waitForVoiceReady({ target, state, source, fetcher = fetch, signal,
  timeoutMs = 300_000, intervalMs = 5000, now = Date.now, sleep = delay, log = console.log }) {
  const url = `${target.origin}${target.basePath ?? ''}/_canopy/ready`;
  const deadline = now() + timeoutMs;
  let lastFailure, nextNotice = 0;
  while (now() < deadline) {
    signal?.throwIfAborted();
    const remaining = deadline - now();
    if (remaining <= 0) break;
    const timeout = AbortSignal.timeout(Math.min(15_000, remaining));
    let response;
    try {
      response = await fetcher(url, { headers: { authorization: `Bearer ${state.secret}` }, redirect: "error",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    } catch (error) {
      signal?.throwIfAborted();
      const code = error.name === "TimeoutError" ? error.name : error.cause?.code ?? error.code ?? error.name;
      if (!["ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EHOSTUNREACH",
        "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "TimeoutError"].includes(code)) throw error;
      lastFailure = code;
    }
    signal?.throwIfAborted();
    if (response) {
      if ([502, 503, 504].includes(response.status) || target.basePath && response.status === 404) {
        lastFailure = `HTTP ${response.status}`;
        await response.body?.cancel();
      } else {
        let ready;
        try { ready = await response.json(); }
        catch { throw new Error(`Voice runtime readiness did not match the installation (invalid response, HTTP ${response.status}).`); }
        if (!response.ok || !ready.ready || ready.installationId !== state.installationId || ready.version !== source.version) {
          throw new Error("Voice runtime readiness did not match the installation.");
        }
        return ready;
      }
    }
    if (now() >= nextNotice) {
      log(`Waiting for Voice at ${target.origin} (${lastFailure}); DNS and routing may still be propagating.`);
      nextNotice = now() + 30_000;
    }
    const waitMs = deadline - now();
    if (waitMs > 0) await sleep(Math.min(intervalMs, waitMs), undefined, { signal });
  }
  throw new Error(`Voice readiness at ${url} timed out (${lastFailure}). Check DNS and HTTPS for ${target.origin}, then rerun the same installer with its preserved .cache/voice-installs state.`);
}

export async function main(args = process.argv.slice(2), dependencies = {}) {
  // Injection is for the local provisioning-state tests; CLI always uses the
  // credentialed transports. No runtime imports or state live in siblings.
  const run = dependencies.run ?? ((cmd,args,cwd=root,capture=false,env={}) => command(cmd,args,{cwd,capture,env,signal:activeSignal}));
  const productDirectory = dependencies.productDirectory ?? product;
  const fetcher = dependencies.fetcher ?? fetch;
  const { values } = parseArgs({ args, options:{config:{type:"string"},plan:{type:"boolean"},mount:{type:"boolean"},"recover-database":{type:"string"}} });
  if (!values.config || values["recover-database"] && !/^[a-f0-9-]{36}$/.test(values["recover-database"])) throw new Error("Use --config config/voice.json [--plan] [--recover-database UUID].");
  const originalTarget = JSON.parse(await readFile(repositoryPath(values.config), "utf8"));
  const stateKey = originalTarget.stateKey ?? createHash("sha256").update(`${originalTarget.accountId}:${originalTarget.origin}`).digest("hex").slice(0,16);
  if (values.mount && originalTarget.basePath) throw new Error('Voice is already configured for mounting. Rerun without --mount.');
  const target = values.mount ? { ...originalTarget, origin:originalTarget.consoleOrigin,basePath:'/installed/voice',stateKey,legacyOrigin:originalTarget.origin } : originalTarget;
  const accountsPath = repositoryPath(target.accountsConfig);
  const consolePath = repositoryPath(target.consoleConfig);
  const accounts = JSON.parse(await readFile(accountsPath, "utf8"));
  const consoleConfig = JSON.parse(await readFile(consolePath, "utf8"));
  const accountsDb = validateTarget(target, accounts, consoleConfig);
  const source = dependencies.source ?? await sourceIdentity();
  console.log(JSON.stringify({ target, source: { version: source.version, revision: source.revision, dirty: source.dirty } },null,2));
  if (values.plan) return;
  if (!target.operatorUserId || accounts.vars?.OPERATOR_USER_ID !== target.operatorUserId || accounts.vars?.VOICE_BILLING_MODE !== "owner_funded") throw new Error("Pin the existing operator user ID and owner_funded policy in both target and accounts config before installation.");
  const directory = dependencies.privateDirectory ?? join(cache,"voice-installs",stateKey);
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
      if (error.code === "ESRCH") { await unlink(lockPath); return main(args, dependencies); }
      throw error;
    }
    throw new Error("This installation is already running. No resources were changed.");
  }
  let api, query, state, lease, heartbeat;
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  activeSignal = controller.signal;
  const stateFile = join(directory,"private.json");
  const persist = () => privateJSON(stateFile,state);
  try {
    api = dependencies.api ?? await cloudflare();
    const accountPath = `/accounts/${target.accountId}`;
    await api(accountPath);
    const coreDatabase = await api(`${accountPath}/d1/database/${accountsDb}`);
    if (coreDatabase.name !== accounts.d1_databases.find(binding=>binding.binding==='DB').database_name) throw new Error('Core database identity does not match its dedicated configuration.');
    await run(process.execPath,[cli,"d1","migrations","apply","DB","--remote","--config",accountsPath],dirname(accountsPath));
    query = dependencies.query ?? d1Query(api, target.accountId, accountsDb);
    if (!(await query("SELECT id FROM users WHERE id=?", [target.operatorUserId])).length) throw new Error("The pinned operator account does not exist.");
    const existing = (await query("SELECT * FROM product_installations WHERE product='voice'"))[0];
    try { state = JSON.parse(await readFile(stateFile,"utf8")); }
    catch(error) { if(error.code!=="ENOENT")throw error; }
    if (existing && !state) throw new Error("An installation already exists. Restore its private operator state before retrying; do not recreate resources.");
    state ??= { installationId:randomUUID(),secret:randomBytes(32).toString("hex"),target,creatingDatabase:false };
    if (existing && existing.installation_id!==state.installationId) throw new Error("Installation ownership does not match this target.");
    if (values.mount) {
      if (!existing || !state.databaseId) throw new Error('Mount requires an existing recorded Voice installation and database.');
      if (state.mount) {
        if (JSON.stringify(state.mount.from)!==JSON.stringify(originalTarget) || JSON.stringify(state.mount.to)!==JSON.stringify(target) || state.mount.version!==source.version) throw new Error('Restore the same mount target and source before retrying.');
      } else {
        if (JSON.stringify(state.target)!==JSON.stringify(originalTarget) || existing.origin!==originalTarget.origin || existing.base_path!=='') throw new Error('Existing installation does not match the requested move.');
        const inventory=JSON.parse(await readFile(join(directory,'inventory.json'),'utf8'));
        if (inventory.source.version!==existing.version || inventory.installationId!==state.installationId) throw new Error('Restore verified previous-version inventory before moving Voice.');
        await privateJSON(join(directory,'before-mount.json'),{inventory,accounts,consoleConfig});
        state.mount={from:originalTarget,to:target,previousVersion:existing.version,version:source.version};
        state.target=target;
      }
      const voiceQuery=dependencies.voiceQuery ?? d1Query(api,target.accountId,state.databaseId);
      if ((await voiceQuery("SELECT count(*) AS n FROM voice_calls WHERE status='active'"))[0]?.n) throw new Error('End active Voice calls before moving the installation.');
    }
    if (JSON.stringify(state.target)!==JSON.stringify(target)) throw new Error("Installation ownership does not match this target.");
    if (existing && existing.version !== source.version && !values.mount) throw new Error("Voice is already installed at a different version. Automatic upgrades are outside this installer.");
    await persist();
    lease = randomUUID();
    let claimed;
    try { claimed = await (values.mount ? claimMountInstallation : claimInstallation)(query, { target, state, source, lease }); }
    catch (error) { lease = null; throw error; }
    const guard = async () => {
      if (controller.signal.aborted) throw new Error('Installation lease was lost.');
      const renewed = await query("UPDATE product_installations SET lease_expires=? WHERE product='voice' AND installation_id=? AND lease_token=? AND lease_expires>? RETURNING installation_id", [Date.now()+120_000,state.installationId,lease,Date.now()]);
      if (renewed.length !== 1) { controller.abort(); throw new Error('Installation lease was lost.'); }
    };
    let renewing = false;
    heartbeat = setInterval(async () => {
      if (renewing) return; renewing = true;
      try { await guard(); } catch { controller.abort(); } finally { renewing = false; }
    }, 20_000);
    heartbeat.unref();
    if (claimed.state === "installed") {
      await waitForVoiceReady({ target, state, source, fetcher, signal: controller.signal });
      if (values.mount) await writeFile(repositoryPath(values.config),`${JSON.stringify(target,null,2)}\n`);
      await query("UPDATE product_install_requests SET state='complete',updated_at=? WHERE product='voice'", [new Date().toISOString()]);
      console.log("Voice is already installed and verified; no deployments were created."); return;
    }
    const workers = await api(`${accountPath}/workers/scripts`);
    const domains = await api(`${accountPath}/workers/domains`);
    const publicDomain = target.basePath ? target.legacyOrigin : target.origin;
    if (publicDomain && domains.some(domain=>domain.hostname===new URL(publicDomain).hostname && domain.service!==target.workerName)) throw new Error("The Voice hostname is already owned by another Worker.");
    if (workers.some(worker=>worker.id===target.workerName)) {
      const settings = await api(`${accountPath}/workers/scripts/${target.workerName}/settings`);
      if (!settings.bindings.some(binding=>binding.name==='CANOPY_INSTALLATION_ID' && binding.text===state.installationId)) throw new Error('The existing Worker is not owned by this installation.');
      if (values.mount && settings.bindings.some(binding=>/^(TWILIO_|TELNYX_|VOICE_CARRIER_)/.test(binding.name))) throw new Error('Review configured carrier callbacks before moving Voice. This move does not reconfigure providers.');
    }
    await guard();
    await query("UPDATE product_installations SET state='installing',updated_at=? WHERE product='voice' AND installation_id=? AND lease_token=?", [new Date().toISOString(),state.installationId,lease]);
    await query("UPDATE product_install_requests SET state='running',updated_at=? WHERE product='voice'", [new Date().toISOString()]);
    const databaseId = await ensureDatabase({target,state,persist,recoverDatabaseId:values["recover-database"],list:()=>listDatabases(api,target.accountId),create:async()=>{await guard();return api(`${accountPath}/d1/database`,"POST",{name:target.databaseName});}});
    await query("UPDATE product_installations SET database_id=? WHERE product='voice' AND lease_token=?",[databaseId,lease]);
    const voiceConfig = JSON.parse(await readFile(join(productDirectory,"wrangler.jsonc"),"utf8"));
    Object.assign(voiceConfig,{name:target.workerName,account_id:target.accountId,workers_dev:false,routes:publicDomain?[{pattern:new URL(publicDomain).hostname,custom_domain:true}]:[],secrets:{required:["CANOPY_AUTH_SECRET"]}});
    voiceConfig.d1_databases[0].database_name=target.databaseName;
    voiceConfig.d1_databases[0].database_id=databaseId;
    Object.assign(voiceConfig.vars,{VOICE_ENABLED:"true",VOICE_PUBLIC_ORIGIN:target.origin,VOICE_AUTH_MODE:"canopy",CANOPY_ACCOUNTS_ORIGIN:target.accountsOrigin,
      VOICE_BASE_PATH:target.basePath ?? '',VOICE_LEGACY_ORIGIN:target.legacyOrigin ?? '',
      CANOPY_CONSOLE_ORIGIN:target.consoleOrigin,CANOPY_INSTALLATION_ID:state.installationId,CANOPY_SOURCE_VERSION:source.version,
      VOICE_INSTANCE_DAILY_CALL_LIMIT:String(target.dailyCallLimit ?? 20),VOICE_INSTANCE_CONCURRENT_CALL_LIMIT:String(target.concurrentCallLimit ?? 2),
      ...(target.carrierAgentId && target.carrierUserId ? {VOICE_CARRIER_AGENT_ID:target.carrierAgentId,VOICE_CARRIER_USER_ID:target.carrierUserId} : {})});
    if (target.basePath) {
      voiceConfig.assets.run_worker_first = true;
      for (const config of [accounts,consoleConfig]) {
        config.services=[...(config.services ?? []).filter(binding=>binding.binding!=='VOICE'),{binding:'VOICE',service:target.workerName}];
      }
      consoleConfig.main='worker/index.ts';
      consoleConfig.assets ??= {};
      Object.assign(consoleConfig.assets,{binding:'ASSETS',run_worker_first:['/installed/voice','/installed/voice/*']});
      await writeFile(accountsPath,`${JSON.stringify(accounts,null,2)}\n`);
      await writeFile(consolePath,`${JSON.stringify(consoleConfig,null,2)}\n`);
    }
    const voicePath = join(productDirectory,"wrangler.install.jsonc");
    await writeFile(voicePath,`${JSON.stringify(voiceConfig,null,2)}\n`);
    const voiceSecrets=join(directory,"voice-secrets.json"), accountSecrets=join(directory,"accounts-secrets.json");
    await writeFile(voiceSecrets,JSON.stringify({CANOPY_AUTH_SECRET:state.secret}),{mode:0o600});
    await writeFile(accountSecrets,JSON.stringify({VOICE_AUTH_SECRET:state.secret}),{mode:0o600});
    await run("npm",["run","build:client","--workspace","@canopy/voice"],root,false,{VOICE_BASE_PATH:target.basePath ?? ''});
    await guard();
    await run(process.execPath,[cli,"d1","migrations","apply","DB","--remote","--config",voicePath],productDirectory);
    await guard();
    await run(process.execPath,[cli,"deploy","--config",voicePath,"--secrets-file",voiceSecrets],productDirectory);
    if (target.basePath) {
      await (dependencies.buildConsole ?? buildConsole)(target, controller.signal);
      await guard();
      await run(process.execPath,[cli,"deploy","--config",consolePath],dirname(consolePath));
    }
    const ready = await waitForVoiceReady({ target, state, source, fetcher, signal: controller.signal });
    await guard();
    await run(process.execPath,[cli,"deploy","--config",accountsPath,"--secrets-file",accountSecrets],dirname(accountsPath));
    const settings=await api(`${accountPath}/workers/scripts/${target.workerName}/settings`);
    const namespaceId=settings.bindings.find(binding=>binding.name==="RECEPTIONIST_CALL")?.namespace_id;
    if(!namespaceId)throw new Error("The deployed Voice namespace was not found.");
    if (!target.basePath) {
      await (dependencies.buildConsole ?? buildConsole)(target, controller.signal);
      await guard();
      await run(process.execPath,[cli,"deploy","--config",consolePath],dirname(consolePath));
    }
    const deployedVersions = {};
    for (const worker of [target.workerName,accounts.name,consoleConfig.name]) {
      const deployments = await api(`${accountPath}/workers/scripts/${worker}/deployments`);
      const versions = deployments.deployments?.[0]?.versions;
      if (!versions?.length) throw new Error(`No deployed version evidence for ${worker}.`);
      deployedVersions[worker] = versions;
    }
    const resources=[{kind:'worker',name:target.workerName},{kind:'d1',id:databaseId},{kind:'durable_object',id:namespaceId,className:'ReceptionistCall'}];
    const inventory={time:new Date().toISOString(),target,installationId:state.installationId,databaseId,namespaceId,source,deployedVersions,resources};
    await privateJSON(join(directory,"inventory.json"),inventory);
    if (values.mount) await writeFile(repositoryPath(values.config),`${JSON.stringify(target,null,2)}\n`);
    await guard();
    await query("UPDATE product_installations SET state='installed',namespace_id=?,resources_json=?,verification_json=?,updated_at=? WHERE product='voice' AND installation_id=? AND lease_token=?",[namespaceId,JSON.stringify(resources),JSON.stringify({ready,deployedVersions,verifiedAt:new Date().toISOString()}),new Date().toISOString(),state.installationId,lease]);
    await query("UPDATE product_install_requests SET state='complete',updated_at=? WHERE product='voice'",[new Date().toISOString()]);
    console.log(`Voice installed for this Canopy instance: ${target.consoleOrigin}/#/products/voice\nInventory: ${relative(root,join(directory,"inventory.json"))}`);
  } catch(error) {
    if (query && lease) {
      const failed = await query("UPDATE product_installations SET state='failed',updated_at=? WHERE product='voice' AND lease_token=? AND state!='installed' RETURNING product",[new Date().toISOString(),lease]).catch(()=>[]);
      if (failed.length) await query("UPDATE product_install_requests SET state='failed',updated_at=? WHERE product='voice'",[new Date().toISOString()]).catch(()=>{});
    }
    throw error;
  } finally {
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
    clearInterval(heartbeat); activeSignal = undefined;
    if (query && lease) await query("UPDATE product_installations SET lease_token=NULL,lease_expires=NULL WHERE product='voice' AND lease_token=?",[lease]).catch(()=>{});
    await unlink(lockPath).catch(()=>{});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error=>{console.error(error.message);process.exitCode=1;});
