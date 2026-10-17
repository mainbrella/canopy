import { authJson } from '../../backend/worker/app/auth-core';
import { publicApiKey } from './api-keys';
import { BffError, checksum, clientInvokeInput, LIMITS, parse, type ApiKeyRecord, type FunctionVersion, type Project, type SqlQuery } from './contracts';
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
        const keys = await env.DB.prepare('SELECT origins FROM bff_api_keys WHERE project_id=?').bind(projectId).all<{ origins: string }>();
        if (!keys.results.some(key => (JSON.parse(key.origins) as string[]).includes(origin))) throw new BffError('origin_not_allowed', 403);
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
    const bearer = authorization ? /^Bearer (bff_pk_[a-f0-9]{64})$/i.exec(authorization)?.[1] : undefined;
    const apiKey = request.headers.get('apikey');
    if ((authorization && !bearer) || (bearer && apiKey && bearer !== apiKey)) throw new BffError('unauthorized', 401);
    const token = bearer || apiKey;
    if (!token || !/^bff_pk_[a-f0-9]{64}$/.test(token)) throw new BffError('unauthorized', 401);
    const record = await env.DB.prepare('SELECT id,name,prefix,origins,tables,functions,created_at FROM bff_api_keys WHERE project_id=? AND token_hash=?').bind(projectId, await checksum(token)).first<ApiKeyRecord>();
    if (!record) throw new BffError('unauthorized', 401);
    const key = publicApiKey(record);
    if (origin && !key.origins.includes(origin)) throw new BffError('origin_not_allowed', 403);
    if (origin) cors['access-control-allow-origin'] = origin;
    const project = await env.DB.prepare('SELECT * FROM bff_projects WHERE id=?').bind(projectId).first<Project>();
    if (!project) throw new BffError('not_found', 404);
    readyProject(env, project);
    if (resource === 'functions') {
      if (!Object.hasOwn(key.functions, name)) throw new BffError('permission_denied', 403);
      if (url.search) throw new BffError('invalid_request');
      const input = parse(clientInvokeInput, await body(request, LIMITS.inputBytes));
      const fn = await env.DB.prepare('SELECT * FROM bff_function_versions WHERE project_id=? AND name=? AND version=?').bind(projectId, name, key.functions[name]).first<FunctionVersion>();
      if (!fn) throw new BffError('not_found', 404);
      return reply(await invokeFunction(env, project, fn, input.input));
    }
    const operation = { GET: 'select', POST: 'insert', PATCH: 'update', DELETE: 'delete' }[request.method] as 'select' | 'insert' | 'update' | 'delete';
    if (!Object.hasOwn(key.tables, name) || !key.tables[name].includes(operation)) throw new BffError('permission_denied', 403);
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
