import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { root, cache, repositoryPath, validOrigin, privateJSON, readJSON, cloudflare, listDatabases, cli, run, buildConsole } from './operator.mjs';
import { ensureDatabase } from './install-voice.mjs';

export function validateCore(target) {
  const name = /^[a-z][a-z0-9-]{2,44}$/;
  if (!/^[a-f0-9]{32}$/.test(target.accountId) || !name.test(target.prefix)
    || !validOrigin(target.accountsOrigin) || !validOrigin(target.consoleOrigin) || target.accountsOrigin === target.consoleOrigin
    || !Array.isArray(target.products) || target.products.some(product => !['voice','cut'].includes(product))
    || target.allowVoiceInstallation !== undefined && typeof target.allowVoiceInstallation !== 'boolean'
    || target.products.includes('voice') && (!validOrigin(target.voiceOrigin) || [target.accountsOrigin,target.consoleOrigin].includes(target.voiceOrigin))
    || target.appflareOrigin && !validOrigin(target.appflareOrigin)
    || !/^\d+$/.test(target.emailRateNamespace) || !/^\d+$/.test(target.googleRateNamespace) || target.emailRateNamespace === target.googleRateNamespace
    || target.voiceOrigin && !validOrigin(target.voiceOrigin)
    || [target.accountsOrigin,target.consoleOrigin,...(target.voiceOrigin?[target.voiceOrigin]:[])].some(origin => ['mainbrella.com','www.mainbrella.com','api.mainbrella.com','stg.mainbrella.com','api-stg.mainbrella.com','voice-stg.mainbrella.com'].includes(new URL(origin).hostname))
    || ['mainbrella','canopy-accounts-stg','canopy-console-stg'].includes(target.prefix)) throw new Error('Use a dedicated own-account target, explicit products and distinct rate-limit namespaces. Mainbrella staging uses its guarded commands.');
  return target;
}

export async function main(args = process.argv.slice(2)) {
  const { values }=parseArgs({args,options:{config:{type:'string'},plan:{type:'boolean'},deploy:{type:'boolean'},'recover-database':{type:'string'}}});
  if(!values.config||values.plan&&values.deploy)throw new Error('Use --config config/operator.json [--plan | --deploy] [--recover-database UUID]. Without --deploy, only local configuration is generated.');
  const target = validateCore(await readJSON(repositoryPath(values.config)));
  const directory = join(cache, 'core-installs', `${target.accountId}-${target.prefix}`);
  const stateFile = join(directory,'private.json');
  let state;
  try { state = await readJSON(stateFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const identity = { accountId:target.accountId,prefix:target.prefix,accountsOrigin:target.accountsOrigin,consoleOrigin:target.consoleOrigin };
  if (state && JSON.stringify(state.target) !== JSON.stringify(identity)) throw new Error('Private core state belongs to another target.');
  state ??= { installationId:randomUUID(), target:identity };
  const names = { accounts:`${target.prefix}-accounts`, console:`${target.prefix}-console`, database:`${target.prefix}-accounts` };
  console.log(JSON.stringify({target,resources:names,productsInstalled:[],notice:'Core only. Voice and Cut are installed separately.'},null,2));
  if (values.plan) return;
  await mkdir(directory,{recursive:true,mode:0o700});
  const persist = () => privateJSON(stateFile,state);
  let api;
  if (values.deploy) {
    api = await cloudflare();
    const accountPath = `/accounts/${target.accountId}`;
    const workers = await api(`${accountPath}/workers/scripts`);
    for (const name of [names.accounts,names.console]) {
      if (!workers.some(worker=>worker.id===name)) continue;
      const settings=await api(`${accountPath}/workers/scripts/${name}/settings`);
      if (!settings.bindings.some(binding=>binding.name==='CANOPY_INSTANCE_ID'&&binding.text===state.installationId)) throw new Error(`Worker ${name} does not belong to this core installation. Refusing to overwrite it.`);
    }
    const domains = await api(`${accountPath}/workers/domains`);
    for (const [origin,name] of [[target.accountsOrigin,names.accounts],[target.consoleOrigin,names.console]]) {
      if (domains.some(domain=>domain.hostname===new URL(origin).hostname && domain.service!==name)) throw new Error('A core hostname is owned by another Worker.');
    }
    await persist();
    await ensureDatabase({ target:{databaseName:names.database}, state, persist, recoverDatabaseId:values['recover-database'],
      list:()=>listDatabases(api,target.accountId), create:()=>api(`${accountPath}/d1/database`,'POST',{name:names.database}) });
  }
  const accountsPath = join(root,'platform/accounts',`wrangler.${target.prefix}.operator.jsonc`);
  const consolePath = join(root,'platform/console',`wrangler.${target.prefix}.operator.jsonc`);
  const accounts = JSON.parse(await readFile(join(root,'platform/accounts/wrangler.jsonc'),'utf8'));
  Object.assign(accounts,{name:names.accounts,account_id:target.accountId,routes:[{pattern:new URL(target.accountsOrigin).hostname,custom_domain:true}]});
  accounts.vars = { AUTH_ORIGINS:target.consoleOrigin, LOCAL_DEVELOPMENT:'false', CANOPY_INSTANCE_ID:state.installationId, OPERATOR_USER_ID:target.operatorUserId ?? '',
    VOICE_BILLING_MODE:'owner_funded', VOICE_INSTALL_ENABLED:target.allowVoiceInstallation===true?'true':'false', ...(target.appflareOrigin?{APPFLARE_ORIGIN:target.appflareOrigin}:{}) };
  Object.assign(accounts.d1_databases[0],{database_name:names.database,database_id:state.databaseId ?? 'CREATE_WITH_SETUP_CORE_DEPLOY'});
  accounts.ratelimits[0].namespace_id=target.emailRateNamespace;accounts.ratelimits[1].namespace_id=target.googleRateNamespace;
  const consoleConfig={name:names.console,account_id:target.accountId,compatibility_date:'2026-09-18',workers_dev:false,preview_urls:false,send_metrics:false,
    vars:{CANOPY_INSTANCE_ID:state.installationId},
    assets:{directory:'./dist',html_handling:'auto-trailing-slash',not_found_handling:'404-page'},routes:[{pattern:new URL(target.consoleOrigin).hostname,custom_domain:true}]};
  await writeFile(accountsPath,`${JSON.stringify(accounts,null,2)}\n`);
  await writeFile(consolePath,`${JSON.stringify(consoleConfig,null,2)}\n`);
  const voiceTarget={accountId:target.accountId,accountsConfig:accountsPath.slice(root.length),consoleConfig:consolePath.slice(root.length),
    accountsOrigin:target.accountsOrigin,consoleOrigin:target.consoleOrigin,workerName:`${target.prefix}-voice`,databaseName:`${target.prefix}-voice`,origin:target.voiceOrigin,
    operatorUserId:target.operatorUserId,products:target.products,name:target.name,dailyCallLimit:20,concurrentCallLimit:2};
  await privateJSON(join(directory,'voice.json'),voiceTarget);
  await persist();
  if (values.deploy) {
    await run(process.execPath,[cli,'d1','migrations','apply','DB','--remote','--config',accountsPath],{cwd:dirname(accountsPath)});
    state.deployedWorkers ??= [];
    for (const [name,path] of [[names.accounts,accountsPath],[names.console,consolePath]]) {
      if (name===names.console) await buildConsole(target);
      // Record each confirmed deployment. A retry verifies the instance marker
      // before recovering a Worker whose deployment response was lost.
      await run(process.execPath,[cli,'deploy','--config',path],{cwd:dirname(path)});
      if (!state.deployedWorkers.includes(name)) state.deployedWorkers.push(name);
      await persist();
    }
    await privateJSON(join(directory,'inventory.json'),{time:new Date().toISOString(),identity,names,databaseId:state.databaseId,productsInstalled:[]});
  }
  console.log(`Core configs: ${accountsPath}, ${consolePath}\nVoice target: ${join(directory,'voice.json')}\nCreate the owner account, copy its Account ID into operatorUserId, and rerun setup before installing products.`);
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
