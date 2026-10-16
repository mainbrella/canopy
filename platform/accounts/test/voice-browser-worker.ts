import { handleRequest } from "../src/index.ts";
import { currentUser, authJson } from "../src/auth-core.ts";
import type { Env } from "../src/env.ts";

// Test-only operator and runner. Never imported by the deployed entrypoint.
export default {
  async fetch(request: Request, env: Env) {
    const owner=await env.DB.prepare("SELECT id FROM users WHERE email='operator@installation.test'").first<{id:string}>();
    const configured={ ...env, OPERATOR_USER_ID:owner?.id, VOICE_BILLING_MODE:'owner_funded' as const, VOICE_INSTALL_ENABLED:'true',APPFLARE_ORIGIN:'https://appflare.example',
      EMAIL_AUTH_LIMIT: { async limit() { return { success: true }; } } as Env['EMAIL_AUTH_LIMIT'] };
    const path=new URL(request.url).pathname;
    if(path.startsWith('/__test/')){
      const user=await currentUser(configured,request);
      if(request.method!=='POST'||!owner||user?.id!==owner.id)return authJson({error:'operator_required'},403);
      if(path==='/__test/reset'){
        await env.DB.prepare('DELETE FROM product_installations').run();await env.DB.prepare('DELETE FROM product_install_requests').run();
      }else if(path==='/__test/voice'){
        await env.DB.prepare(`INSERT OR REPLACE INTO product_installations(product,installation_id,account_id,worker_name,origin,version,source_revision,state,updated_at,base_path)
          VALUES('voice','browser-install','test-account','test-worker','http://127.0.0.1:5175','browser-version','test-source','installed',?,'/installed/voice')`).bind(new Date().toISOString()).run();
        await env.DB.prepare("UPDATE product_install_requests SET state='complete' WHERE product='voice'").run();
      }else if(path==='/__test/cut'){
        await env.DB.prepare(`INSERT OR REPLACE INTO product_installations(product,installation_id,account_id,worker_name,origin,version,source_revision,state,updated_at,provisioner,capabilities_json,verification_json)
          VALUES('cut','cut-fixture','test-account','test-cut','http://127.0.0.1:8795','fixture-version','fixture-source','installed',?,'appflare','{"identity":false,"billing":false,"health":"reachability"}','{"fixture":true}')`).bind(new Date().toISOString()).run();
        await env.DB.prepare("UPDATE product_install_requests SET state='complete' WHERE product='cut'").run();
      }else return authJson({error:'not_found'},404);
      return authJson({ok:true},200);
    }
    return handleRequest(request,configured);
  },
};
