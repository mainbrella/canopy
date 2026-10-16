import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, readJSON, repositoryPath, cloudflare, d1Query, run } from './operator.mjs';
import { validateTarget } from './install-voice.mjs';

export async function processVoiceRequest(query, operatorUserId, install) {
  const request=(await query(`SELECT r.request_id,r.updated_at FROM product_install_requests r
    LEFT JOIN product_installations i ON i.product=r.product
    WHERE r.product='voice' AND r.requested_by=? AND (r.state='pending'
      OR r.state='running' AND (i.lease_expires IS NULL OR i.lease_expires<=?))`,[operatorUserId,Date.now()]))[0];
  if(!request)return false;
  try { await install(); }
  catch(error) {
    // A different active runner retains its request and lease. Never publish a
    // failure over that owner, or overwrite a newer request/retry.
    await query(`UPDATE product_install_requests SET state='failed',updated_at=?
      WHERE request_id=? AND updated_at=? AND NOT EXISTS(SELECT 1 FROM product_installations WHERE product='voice' AND lease_expires>?)`,
      [new Date().toISOString(),request.request_id,request.updated_at,Date.now()]);
    throw error;
  }
  return true;
}
export async function main(args=process.argv.slice(2)) {
  const {values}=parseArgs({args,options:{config:{type:'string'},watch:{type:'boolean'}}});
  if(!values.config)throw new Error('Use --config VOICE_TARGET [--watch]. This runs approved installation requests with local operator credentials.');
  const targetPath=repositoryPath(values.config);const target=await readJSON(targetPath);
  const accounts=await readJSON(repositoryPath(target.accountsConfig));const consoleConfig=await readJSON(repositoryPath(target.consoleConfig));
  const db=validateTarget(target,accounts,consoleConfig);
  if(!target.operatorUserId||accounts.vars?.OPERATOR_USER_ID!==target.operatorUserId||accounts.vars?.VOICE_BILLING_MODE!=='owner_funded')throw new Error('Pin the same owner and owner_funded policy in the target and core config.');
  const api=await cloudflare();const query=d1Query(api,target.accountId,db);
  const controller=new AbortController();const stop=()=>controller.abort();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  console.log(`Operator runner for ${target.consoleOrigin}. ${values.watch?'Waiting for Voice requests; Ctrl-C stops.':'Checking once.'}`);
  try{
    do{
      try{
        await processVoiceRequest(query,target.operatorUserId,()=>run(process.execPath,[join(root,'scripts/install-voice.mjs'),'--config',targetPath],{signal:controller.signal}));
      }catch(error){
        if(controller.signal.aborted)break;
        console.error(error.message);
        if(!values.watch)throw error;
      }
      if(values.watch&&!controller.signal.aborted)await new Promise(resolve=>{
        const done=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',done);resolve();};
        const timer=setTimeout(done,5000);controller.signal.addEventListener('abort',done,{once:true});
      });
    }while(values.watch&&!controller.signal.aborted);
  }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
