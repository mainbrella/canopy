import { randomToken } from '../../backend/worker/app/auth-core';
import { apiKeyInput, BffError, checksum, LIMITS, parse, type ApiKey, type ApiKeyRecord, type Project } from './contracts';
import { body, readyProject } from './http';

export function publicApiKey(row: ApiKeyRecord): ApiKey {
  return { id: row.id, name: row.name, prefix: row.prefix, created_at: row.created_at,
    origins: JSON.parse(row.origins), tables: JSON.parse(row.tables), functions: JSON.parse(row.functions) };
}

export async function manageApiKeys(request: Request, env: Env, project: Project, keyId?: string) {
  if (keyId) {
    if (request.method !== 'DELETE') throw new BffError('method_not_allowed', 405);
    const result = await env.DB.prepare('DELETE FROM bff_api_keys WHERE id=? AND project_id=?').bind(keyId, project.id).run();
    if (!result.meta.changes) throw new BffError('not_found', 404);
    return { data: { revoked: true }, status: 200 };
  }
  if (request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT id,name,prefix,origins,tables,functions,created_at FROM bff_api_keys WHERE project_id=? ORDER BY created_at,id').bind(project.id).all<ApiKeyRecord>();
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
  const token = `bff_pk_${randomToken()}`;
  const key: ApiKey = { ...input, id: crypto.randomUUID(), prefix: token.slice(0, 15), created_at: new Date().toISOString() };
  const inserted = await env.DB.prepare(`INSERT INTO bff_api_keys(id,project_id,name,token_hash,prefix,origins,tables,functions,created_at)
    SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM bff_api_keys WHERE project_id=?) < ?`)
    .bind(key.id, project.id, key.name, await checksum(token), key.prefix, JSON.stringify(key.origins), JSON.stringify(key.tables), JSON.stringify(key.functions), key.created_at, project.id, LIMITS.apiKeys).run();
  if (!inserted.meta.changes) throw new BffError('api_key_limit', 429);
  return { data: { key, token }, status: 201 };
}
