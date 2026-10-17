import { authCorsHeaders, authJson } from '../../backend/worker/app/auth-core';
import { apiKeyIdentity, recordApiKeyUse } from '../../backend/worker/app/api-keys';
import { publicApiKey } from './api-keys';
import { BffError, clientInvokeInput, LIMITS, parse, type ApiKeyRecord, type FunctionVersion, type Project, type SqlQuery } from './contracts';
import { ProjectDatabase } from './database';
import { body, enabled, readyProject } from './http';
import { invokeFunction } from './invocation';
import { identifier } from './sql';
import { deleteQuery, insertQuery, selectQuery, tableParameters, updateQuery } from './table-queries';

export async function handleDataRequest(request: Request, env: Env): Promise<Response> {
  const cors: Record<string, string> = { vary: 'Origin' };
  const reply = (data: unknown, status = 200) => authJson(data, status, cors);
  try {
    const url = new URL(request.url);
    const match = /^\/bff\/data\/([a-f0-9-]{36})\/(tables|functions)\/([a-zA-Z][a-zA-Z0-9_]{0,62})(\/invoke)?$/.exec(url.pathname);
    if (!match) throw new BffError('not_found', 404);
    const [, projectId, resource, name, invocation] = match;
    if ((resource === 'functions') !== !!invocation) throw new BffError('not_found', 404);
    identifier(name);
    enabled(env);
    const methods = resource === 'tables' ? ['GET', 'POST', 'PATCH', 'DELETE'] : ['POST'];
    const origin = request.headers.get('origin');
    if (request.method === 'OPTIONS') {
      if (origin) {
        // Preflights carry no key. The actual request checks its own key's origins.
        const keys = await env.DB.prepare('SELECT origins FROM bff_api_key_grants WHERE project_id=?').bind(projectId).all<{ origins: string }>();
        if (!authCorsHeaders(request, env) && !keys.results.some(key => (JSON.parse(key.origins) as string[]).includes(origin))) throw new BffError('origin_not_allowed', 403);
        cors['access-control-allow-origin'] = origin;
      }
      const requestedMethod = request.headers.get('access-control-request-method');
      const requestedHeaders = (request.headers.get('access-control-request-headers') || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
      if ((requestedMethod && !methods.includes(requestedMethod)) || requestedHeaders.some(header => !['authorization', 'apikey', 'content-type'].includes(header))) throw new BffError('origin_not_allowed', 403);
      return new Response(null, { status: 204, headers: { ...cors, 'cache-control': 'no-store',
        'access-control-allow-methods': [...methods, 'OPTIONS'].join(', '),
        'access-control-allow-headers': 'authorization, apikey, content-type', 'access-control-max-age': '600' } });
    }
    if (!methods.includes(request.method)) throw new BffError('method_not_allowed', 405);
    const authorization = request.headers.get('authorization');
    const bearer = authorization ? /^Bearer ((?:mb_|bff_pk_)[a-f0-9]{64})$/i.exec(authorization)?.[1] : undefined;
    const apiKey = request.headers.get('apikey');
    if ((authorization && !bearer) || (bearer && apiKey && bearer !== apiKey)) throw new BffError('unauthorized', 401);
    const token = bearer || apiKey;
    if (!token) throw new BffError('unauthorized', 401);
    const identity = await apiKeyIdentity(env, token);
    if (!identity) throw new BffError('unauthorized', 401);
    const scoped = identity.prefix.startsWith('bff_pk_');
    const record = scoped ? await env.DB.prepare('SELECT k.id,k.name,k.prefix,g.origins,g.tables,g.functions,k.created_at FROM api_keys k JOIN bff_api_key_grants g ON g.api_key_id=k.id WHERE g.project_id=? AND k.id=?').bind(projectId, identity.key_id).first<ApiKeyRecord>() : null;
    if (scoped && !record) throw new BffError('unauthorized', 401);
    const key = record ? publicApiKey(record) : null;
    if (origin && (key ? !key.origins.includes(origin) : !authCorsHeaders(request, env))) throw new BffError('origin_not_allowed', 403);
    if (origin) cors['access-control-allow-origin'] = origin;
    const project = await env.DB.prepare('SELECT * FROM bff_projects WHERE id=? AND user_id=?').bind(projectId, identity.id).first<Project>();
    if (!project) throw new BffError('not_found', 404);
    readyProject(env, project);
    await recordApiKeyUse(env, identity.key_id);
    if (resource === 'functions') {
      if (key && !Object.hasOwn(key.functions, name)) throw new BffError('permission_denied', 403);
      if (url.search) throw new BffError('invalid_request');
      const input = parse(clientInvokeInput, await body(request, LIMITS.inputBytes));
      const fn = await env.DB.prepare(`SELECT * FROM bff_function_versions WHERE project_id=? AND name=? ${key ? 'AND version=?' : ''} ORDER BY version DESC LIMIT 1`)
        .bind(projectId, name, ...(key ? [key.functions[name]] : [])).first<FunctionVersion>();
      if (!fn) throw new BffError('not_found', 404);
      return reply(await invokeFunction(env, project, fn, input.input));
    }
    const operation = { GET: 'select', POST: 'insert', PATCH: 'update', DELETE: 'delete' }[request.method] as 'select' | 'insert' | 'update' | 'delete';
    if (key && (!Object.hasOwn(key.tables, name) || !key.tables[name].includes(operation))) throw new BffError('permission_denied', 403);
    const query = tableParameters(url.searchParams, request.method === 'GET');
    let compiled: SqlQuery;
    if (request.method === 'GET') compiled = selectQuery(name, query.filters, query.limit, query.offset, query.select, query.order);
    else if (request.method === 'DELETE') compiled = deleteQuery(name, query.filters);
    else if (request.method === 'POST') {
      if (url.search) throw new BffError('invalid_request');
      compiled = insertQuery(name, await body(request, LIMITS.inputBytes));
    } else compiled = updateQuery(name, query.filters, await body(request, LIMITS.inputBytes));
    const [result] = await new ProjectDatabase(env, project).query([compiled]);
    return reply({ data: result.results, meta: result.meta ?? {} }, request.method === 'POST' ? 201 : 200);
  } catch (error) {
    if (error instanceof BffError) return reply({ error: error.code }, error.status);
    console.error('bff_data_request_failed');
    return reply({ error: 'bff_unavailable' }, 503);
  }
}
