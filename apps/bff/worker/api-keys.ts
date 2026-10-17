import { newApiKey } from '../../backend/worker/app/api-keys';
import { apiKeyInput, BffError, LIMITS, parse, type ApiKey, type ApiKeyRecord, type Project } from './contracts';
import { body, readyProject } from './http';

export function publicApiKey(row: ApiKeyRecord): ApiKey {
  return { id: row.id, name: row.name, prefix: row.prefix, created_at: row.created_at,
    origins: JSON.parse(row.origins), tables: JSON.parse(row.tables), functions: JSON.parse(row.functions) };
}

export async function manageApiKeys(request: Request, env: Env, project: Project, keyId?: string) {
  if (keyId) {
    if (request.method !== 'DELETE') throw new BffError('method_not_allowed', 405);
    const result = await env.DB.prepare('DELETE FROM api_keys WHERE id=? AND user_id=? AND id IN (SELECT api_key_id FROM bff_api_key_grants WHERE project_id=?)').bind(keyId, project.user_id, project.id).run();
    if (!result.meta.changes) throw new BffError('not_found', 404);
    return { data: { revoked: true }, status: 200 };
  }
  if (request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT k.id,k.name,k.prefix,g.origins,g.tables,g.functions,k.created_at FROM api_keys k JOIN bff_api_key_grants g ON g.api_key_id=k.id WHERE g.project_id=? AND k.user_id=? ORDER BY k.created_at,k.id').bind(project.id, project.user_id).all<ApiKeyRecord>();
    return { data: { keys: rows.results.map(publicApiKey) }, status: 200 };
  }
  if (request.method !== 'POST') throw new BffError('method_not_allowed', 405);
  readyProject(env, project);
  const input = parse(apiKeyInput, await body(request));
  const functions = Object.entries(input.functions);
  if (functions.length) {
    const versions = await env.DB.batch(functions.map(([name, version]) => env.DB.prepare('SELECT version FROM bff_function_versions WHERE project_id=? AND name=? AND version=?').bind(project.id, name, version)));
    if (versions.some(result => !result.results.length)) throw new BffError('function_version_not_found', 404);
  }
  const shared = await newApiKey(input.name, 'bff');
  const { token } = shared;
  const key: ApiKey = { ...input, id: shared.key.id, prefix: shared.key.prefix, created_at: shared.key.created_at };
  const [inserted] = await env.DB.batch([
    env.DB.prepare(`INSERT INTO api_keys(id,user_id,name,token_hash,prefix,created_at)
      SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM bff_api_key_grants WHERE project_id=?) < ?`)
      .bind(key.id, project.user_id, key.name, shared.tokenHash, key.prefix, key.created_at, project.id, LIMITS.apiKeys),
    env.DB.prepare(`INSERT INTO bff_api_key_grants(api_key_id,project_id,origins,tables,functions)
      SELECT id,?,?,?,? FROM api_keys WHERE id=?`)
      .bind(project.id, JSON.stringify(key.origins), JSON.stringify(key.tables), JSON.stringify(key.functions), key.id),
  ]);
  if (!inserted.meta.changes) throw new BffError('api_key_limit', 429);
  return { data: { key, token }, status: 201 };
}
