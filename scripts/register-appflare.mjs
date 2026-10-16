import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cache, readJSON, repositoryPath, validOrigin, validateCoreConnection, cloudflare, d1Query, privateJSON } from './operator.mjs';

// One supported adapter: Appflare's catalog Cut install. Appflare owns lifecycle,
// authentication and all its resources. Canopy reads evidence and registers it.
export function cutEvidence({ install, resources, deployments, domains, subdomain, accountId, managerWorker }) {
  if (!install || install.app_slug !== 'cut' || install.status !== 'installed' || install.origin !== 'catalog'
    || install.build_kind !== 'artifact' || install.worker_name === managerWorker || !/^[a-z][a-z0-9-]{2,62}$/.test(install.worker_name)
    || !/^[a-f0-9]{40}$/.test(install.pin_sha || '') || !install.current_version_id
    || !/^[a-f0-9]{64}$/.test(install.artifact_digest || '') || !install.catalog_version) throw new Error('Cut must be an installed catalog artifact with a pinned source and deployed version.');
  if (!deployments?.[0]?.versions?.some(version => version.version_id === install.current_version_id && version.percentage === 100)) throw new Error('Appflare and Cloudflare disagree about the deployed version.');
  if (!resources.some(resource=>resource.kind==='worker' && resource.name===install.worker_name)) throw new Error('The app Worker is missing from Appflare inventory.');
  if (resources.some(resource=>resource.managed_by !== 'appflare')) throw new Error('This adapter supports Appflare-managed resources only.');
  let origin;
  if (install.served_domain) {
    if (!domains.some(domain=>domain.hostname===install.served_domain && domain.service===install.worker_name)) throw new Error('The registered hostname does not belong to this Worker.');
    origin = `https://${install.served_domain}`;
  } else if (install.workers_dev_enabled && /^[a-z0-9-]+$/.test(subdomain || '')) origin = `https://${install.worker_name}.${subdomain}.workers.dev`;
  if (!validOrigin(origin)) throw new Error('Cut has no verified supported origin.');
  const manifest = JSON.parse(install.manifest_json || '{}');
  const repository = manifest.catalog?.repo ?? manifest.repo;
  if (repository !== 'MendyLanda/cut') throw new Error('Unexpected catalog source for Cut.');
  return { installationId:`appflare:${install.id}`, externalInstallId:install.id, product:'cut', accountId, workerName:install.worker_name,
    origin, version:install.catalog_version, sourceRevision:install.pin_sha, sourceRepository:repository,
    capabilities:{identity:false,billing:false,health:'reachability',openPath:'/admin'}, resources,
    verification:{verifiedAt:new Date().toISOString(),workerVersion:install.current_version_id,artifactDigest:install.artifact_digest,managerWorker} };
}
export async function reconcileCut(query, evidence, ownerUserId) {
  const existing = (await query("SELECT installation_id,account_id,worker_name FROM product_installations WHERE product='cut'"))[0];
  if (existing && (existing.installation_id!==evidence.installationId || existing.account_id!==evidence.accountId || existing.worker_name!==evidence.workerName)) throw new Error('A different Cut install is already registered; no resources were adopted.');
  const rows = await query(`INSERT INTO product_installations(product,installation_id,account_id,worker_name,origin,version,source_revision,state,updated_at,
    provisioner,owner_user_id,source_repository,resources_json,capabilities_json,verification_json,external_install_id)
    VALUES('cut',?,?,?,?,?,?,'installed',?,'appflare',?,?,?,?,?,?)
    ON CONFLICT(product) DO UPDATE SET origin=excluded.origin,version=excluded.version,source_revision=excluded.source_revision,
      resources_json=excluded.resources_json,verification_json=excluded.verification_json,updated_at=excluded.updated_at
    WHERE product_installations.installation_id=excluded.installation_id AND product_installations.account_id=excluded.account_id
      AND product_installations.worker_name=excluded.worker_name RETURNING installation_id`,
    [evidence.installationId,evidence.accountId,evidence.workerName,evidence.origin,evidence.version,evidence.sourceRevision,new Date().toISOString(),
      ownerUserId,evidence.sourceRepository,JSON.stringify(evidence.resources),JSON.stringify(evidence.capabilities),JSON.stringify(evidence.verification),evidence.externalInstallId]);
  if (rows.length!==1) throw new Error('Another Cut installation won registration.');
  await query("UPDATE product_install_requests SET state='complete',updated_at=? WHERE product='cut'",[new Date().toISOString()]);
}
export async function main(args=process.argv.slice(2)) {
  if(args[0]!=='--config'||!args[1]||args.slice(2).some(arg=>arg!=='--plan'))throw new Error('Use --config config/appflare.json [--plan].');
  const target=await readJSON(repositoryPath(args[1]));
  const coreTarget=await readJSON(repositoryPath(target.coreTarget));
  const accounts=await readJSON(repositoryPath(coreTarget.accountsConfig));
  const consoleConfig=await readJSON(repositoryPath(coreTarget.consoleConfig));
  const accountsDb=validateCoreConnection(coreTarget,accounts,consoleConfig);
  if(!/^[a-f0-9-]{36}$/.test(target.managerDatabaseId)||target.managerDatabaseId===accountsDb||!/^[a-z][a-z0-9-]{2,62}$/.test(target.managerWorker)||!target.installId
    ||!coreTarget.operatorUserId||accounts.vars?.OPERATOR_USER_ID!==coreTarget.operatorUserId)throw new Error('Explicit Appflare manager, installation and pinned Canopy operator are required.');
  console.log(JSON.stringify({accountId:coreTarget.accountId,manager:target.managerWorker,installId:target.installId,product:'cut',operation:'Read Appflare/Cloudflare evidence; write Canopy registration only.'},null,2));
  if(args.includes('--plan'))return;
  const api=await cloudflare();const accountPath=`/accounts/${coreTarget.accountId}`;
  const coreDatabase=await api(`${accountPath}/d1/database/${accountsDb}`);
  if(coreDatabase.name!==accounts.d1_databases.find(binding=>binding.binding==='DB').database_name)throw new Error('Core database identity does not match its dedicated configuration.');
  const settings=await api(`${accountPath}/workers/scripts/${target.managerWorker}/settings`);
  if(!settings.bindings.some(binding=>binding.type==='d1'&&binding.id===target.managerDatabaseId))throw new Error('The database is not bound to the specified Appflare manager.');
  const readManager=d1Query(api,coreTarget.accountId,target.managerDatabaseId);
  // Deliberately read-only queries against Appflare, no migrations or server-function calls.
  const install=(await readManager('SELECT * FROM installs WHERE id=?',[target.installId]))[0];
  if(!install)throw new Error('Appflare installation not found.');
  const resources=await readManager('SELECT kind,binding,name,cf_id,managed_by FROM resources WHERE install_id=? AND deleted_at IS NULL AND retained_at IS NULL',[target.installId]);
  const deployments=await api(`${accountPath}/workers/scripts/${encodeURIComponent(install.worker_name)}/deployments`);
  const domains=await api(`${accountPath}/workers/domains`);
  const {subdomain}=await api(`${accountPath}/workers/subdomain`);
  const evidence=cutEvidence({install,resources,deployments:deployments.deployments,domains,subdomain,accountId:coreTarget.accountId,managerWorker:target.managerWorker});
  const response=await fetch(`${evidence.origin}/admin`,{redirect:'manual',signal:AbortSignal.timeout(10000)});
  if(response.status<200||response.status>=400)throw new Error('Cut is not reachable at the verified origin.');
  const query=d1Query(api,coreTarget.accountId,accountsDb);
  if(!(await query('SELECT id FROM users WHERE id=?',[coreTarget.operatorUserId])).length)throw new Error('The pinned operator account does not exist.');
  await reconcileCut(query,evidence,coreTarget.operatorUserId);
  await privateJSON(join(cache,'appflare-installs',`${target.installId}.json`),evidence);
  console.log(`Registered Cut: ${evidence.origin}/admin. Appflare retains its lifecycle and admin password.`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
