import { authCorsHeaders, authJson, currentUser } from '../../backend/worker/app/auth-core';
import { apiKeyUser } from '../../backend/worker/app/api-keys';
import { BffError, checksum, functionInput, invokeInput, LIMITS, migrationInput, nameInput, parse, projectInput, projectPatch, queryInput, VERSION, type FunctionVersion, type Project } from './contracts';
import { ProjectDatabase } from './database';
import { manageApiKeys } from './api-keys';
import { handleDataRequest } from './data-routes';
import { body, enabled, readyProject } from './http';
import { invokeFunction } from './invocation';
import { statements } from './sql';

const publicProject = ({ id, name, state, suspended, blocked, created_at }: Project) => ({ id, name, state, suspended: !!(suspended || blocked), created_at });
const functionColumns = 'name,version,checksum,database_access,created_at';

async function provision(env: Env, project: Project) {
  if (project.blocked) throw new BffError('project_blocked', 403);
  if (project.suspended) throw new BffError('project_paused', 403);
  if (project.state === 'ready') return publicProject(project);
  const lease = crypto.randomUUID(), now = Date.now();
  const acquired = await env.DB.prepare('UPDATE bff_projects SET provision_lease=?,provision_until=? WHERE id=? AND provision_until < ?')
    .bind(lease, now + 60_000, project.id, now).run();
  if (!acquired.meta.changes) throw new BffError('provision_in_progress', 409);
  try {
    await new ProjectDatabase(env, project).provision();
    await env.DB.prepare("UPDATE bff_projects SET state='ready',provision_lease=NULL,provision_until=0 WHERE id=? AND provision_lease=?").bind(project.id, lease).run();
    return publicProject({ ...project, state: 'ready' });
  } catch (error) {
    await env.DB.prepare("UPDATE bff_projects SET state='error',provision_lease=NULL,provision_until=0 WHERE id=? AND provision_lease=?").bind(project.id, lease).run();
    throw error;
  }
}

async function migrate(db: ProjectDatabase, input: ReturnType<typeof migrationInput.parse>) {
  const sql = statements(input.sql, true);
  const hash = await checksum(input.sql);
  const existing = async () => (await db.query([{ sql: 'SELECT * FROM _bff_migrations WHERE sequence=? OR name=?', params: [input.sequence, input.name] }]))[0].results;
  const check = (rows: Record<string, unknown>[]) => {
    if (!rows.length) return false;
    if (rows.length !== 1 || rows[0].sequence !== input.sequence || rows[0].name !== input.name || rows[0].checksum !== hash) throw new BffError('migration_conflict', 409);
    return true;
  };
  if (check(await existing())) return { applied: false, checksum: hash };
  try {
    // CHECK(sequence > 0) aborts the *whole batch* on a stale/out-of-order
    // sequence. The ledger insert and all DDL/backfills share one D1 transaction.
    await db.query([
      { sql: `INSERT INTO _bff_migrations (sequence,name,checksum,sql,applied_at)
        SELECT CASE WHEN COALESCE(MAX(sequence),0)+1=? THEN ? ELSE 0 END,?,?,?,? FROM _bff_migrations`,
        params: [input.sequence, input.sequence, input.name, hash, input.sql, new Date().toISOString()] },
      ...sql.map(statement => ({ sql: statement })),
    ]);
  } catch (error) {
    if (check(await existing())) return { applied: false, checksum: hash };
    const [latest] = await db.query([{ sql: 'SELECT COALESCE(MAX(sequence),0) AS sequence FROM _bff_migrations' }]);
    if (input.sequence !== Number(latest.results[0].sequence) + 1) throw new BffError('migration_out_of_order', 409);
    throw error;
  }
  return { applied: true, checksum: hash };
}

export async function handleBffRequest(request: Request, env: Env): Promise<Response> {
  if (new URL(request.url).pathname.startsWith('/bff/data/')) return handleDataRequest(request, env);
  const cors = authCorsHeaders(request, env);
  if (!cors) return authJson({ error: 'origin_not_allowed' }, 403, {});
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const reply = (data: unknown, status = 200) => authJson(data, status, cors);
  try {
    const authorization = request.headers.get('authorization');
    const token = authorization?.match(/^Bearer (mb_[a-f0-9]{64})$/i)?.[1];
    // An explicit invalid credential never falls back to a session cookie.
    const user = authorization !== null ? (token ? await apiKeyUser(env, token) : null) : await currentUser(env, request);
    if (!user) throw new BffError('unauthorized', 401);
    const url = new URL(request.url), method = request.method;
    if (url.pathname === '/bff/config' && method === 'GET') return reply({ version: VERSION,
      available: env.BFF_ENABLED === 'true' && !!env.BFF_CLOUDFLARE_ACCOUNT_ID && !!env.BFF_CLOUDFLARE_API_TOKEN,
      functionsAvailable: env.BFF_ENABLED === 'true' && !!env.BFF_LOADER, limits: LIMITS });
    if (url.pathname === '/bff/projects') {
      if (method === 'GET') {
        const rows = await env.DB.prepare('SELECT * FROM bff_projects WHERE user_id=? ORDER BY created_at,id').bind(user.id).all<Project>();
        return reply({ projects: rows.results.map(publicProject) });
      }
      if (method !== 'POST') throw new BffError('method_not_allowed', 405);
      enabled(env);
      const input = parse(projectInput, await body(request));
      const previous = await env.DB.prepare('SELECT * FROM bff_projects WHERE user_id=? AND name=?').bind(user.id, input.name).first<Project>();
      if (previous) return reply({ project: publicProject(previous) });
      const id = crypto.randomUUID(), created = new Date().toISOString();
      try {
        const inserted = await env.DB.prepare(`INSERT INTO bff_projects(id,user_id,name,created_at)
          SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM bff_projects WHERE user_id=?) < ?`)
          .bind(id, user.id, input.name, created, user.id, LIMITS.projects).run();
        if (!inserted.meta.changes) throw new BffError('project_limit', 429);
      } catch (error) {
        const duplicate = await env.DB.prepare('SELECT * FROM bff_projects WHERE user_id=? AND name=?').bind(user.id, input.name).first<Project>();
        if (duplicate) return reply({ project: publicProject(duplicate) });
        throw error;
      }
      return reply({ project: { id, name: input.name, state: 'pending', suspended: false, created_at: created } }, 201);
    }
    const match = /^\/bff\/projects\/([a-f0-9-]{36})(?:\/(schema|query|migrations|functions|executions|usage|provision|api-keys)(?:\/([a-zA-Z0-9_-]{1,63})(?:\/(invoke))?)?)?$/.exec(url.pathname);
    if (!match) throw new BffError('not_found', 404);
    const [, projectId, resource, functionName, invocation] = match;
    const project = await env.DB.prepare('SELECT * FROM bff_projects WHERE id=? AND user_id=?').bind(projectId, user.id).first<Project>();
    if (!project) throw new BffError('not_found', 404);
    if (!resource) {
      if (method === 'GET') return reply({ project: publicProject(project) });
      if (method !== 'PATCH') throw new BffError('method_not_allowed', 405);
      if (project.blocked) throw new BffError('project_blocked', 403);
      const input = parse(projectPatch, await body(request));
      await env.DB.prepare('UPDATE bff_projects SET suspended=? WHERE id=? AND user_id=?').bind(Number(input.suspended), projectId, user.id).run();
      return reply({ project: publicProject({ ...project, suspended: Number(input.suspended) }) });
    }
    if ((functionName && resource !== 'functions' && resource !== 'api-keys') || (invocation && resource !== 'functions')) throw new BffError('not_found', 404);
    if (resource === 'api-keys') {
      if (functionName && !/^[a-f0-9-]{36}$/.test(functionName)) throw new BffError('not_found', 404);
      const result = await manageApiKeys(request, env, project, functionName);
      return reply(result.data, result.status);
    }
    if (resource === 'executions' && method === 'GET') {
      const rows = await env.DB.prepare(`SELECT id,function_name,version,
        CASE WHEN status='running' AND expires_at < ? THEN 'timeout' ELSE status END AS status,
        error,duration_ms,created_at FROM bff_executions WHERE project_id=? ORDER BY created_at DESC LIMIT 100`).bind(Date.now(), projectId).all();
      return reply({ executions: rows.results });
    }
    if (resource === 'usage' && method === 'GET') {
      const day = new Date().toISOString().slice(0, 10);
      const usage = await env.DB.prepare('SELECT queries,invocations FROM bff_daily_usage WHERE project_id=? AND day=?').bind(projectId, day).first();
      return reply({ day, queries: 0, invocations: 0, ...usage });
    }
    enabled(env);
    if (resource === 'provision') {
      if (method !== 'POST') throw new BffError('method_not_allowed', 405);
      return reply({ project: await provision(env, project) });
    }
    readyProject(env, project);
    const db = new ProjectDatabase(env, project);
    if (resource === 'schema' && method === 'GET') {
      const [tables] = await db.query([{ sql: `SELECT name,sql FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name NOT GLOB '_bff_*' ORDER BY name LIMIT ${LIMITS.schemaTables + 1}` }]);
      const result = [];
      // Bounded introspection: a project may contain more tables, but never fan
      // out into unbounded provider requests from the dashboard.
      const visible = tables.results.slice(0, LIMITS.schemaTables);
      const details = visible.length ? await db.query(visible.flatMap(row => {
        const name = String(row.name);
        return [
          { sql: 'SELECT name,type,"notnull",dflt_value,pk FROM pragma_table_info(?)', params: [name] },
          { sql: `SELECT COUNT(*) AS count FROM "${name.replaceAll('"', '""')}"` },
        ];
      })) : [];
      for (const [index, row] of visible.entries()) {
        const columns = details[index * 2], count = details[index * 2 + 1];
        const name = String(row.name);
        result.push({ name, sql: row.sql, columns: columns.results, count: count.results[0].count });
      }
      return reply({ tables: result, truncated: tables.results.length > LIMITS.schemaTables });
    }
    if (resource === 'query' && method === 'POST') {
      const input = parse(queryInput, await body(request));
      const sql = statements(input.sql)[0];
      const [result] = await db.query([{ sql, params: input.params }]);
      return reply({ result });
    }
    if (resource === 'migrations') {
      if (method === 'GET') return reply({ migrations: (await db.query([{ sql: 'SELECT * FROM _bff_migrations ORDER BY sequence DESC LIMIT 100' }]))[0].results });
      if (method !== 'POST') throw new BffError('method_not_allowed', 405);
      return reply(await migrate(db, parse(migrationInput, await body(request))));
    }
    if (resource === 'functions') {
      if (!functionName) {
        if (method !== 'GET') throw new BffError('method_not_allowed', 405);
        const rows = await env.DB.prepare(`SELECT ${functionColumns} FROM bff_function_versions f WHERE project_id=?
          AND version=(SELECT MAX(version) FROM bff_function_versions WHERE project_id=f.project_id AND name=f.name) ORDER BY name`).bind(projectId).all();
        return reply({ functions: rows.results });
      }
      parse(nameInput, functionName);
      if (invocation) {
        if (method !== 'POST') throw new BffError('method_not_allowed', 405);
        if (!env.BFF_LOADER) throw new BffError('function_runtime_unavailable', 503);
        const input = parse(invokeInput, await body(request, LIMITS.inputBytes));
        const fn = await env.DB.prepare(`SELECT * FROM bff_function_versions WHERE project_id=? AND name=? ${input.version ? 'AND version=?' : ''} ORDER BY version DESC LIMIT 1`)
          .bind(projectId, functionName, ...(input.version ? [input.version] : [])).first<FunctionVersion>();
        if (!fn) throw new BffError('not_found', 404);
        return reply(await invokeFunction(env, project, fn, input.input));
      }
      if (method === 'GET') {
        const fn = await env.DB.prepare('SELECT * FROM bff_function_versions WHERE project_id=? AND name=? ORDER BY version DESC LIMIT 1').bind(projectId, functionName).first<FunctionVersion>();
        if (!fn) throw new BffError('not_found', 404);
        const versions = await env.DB.prepare(`SELECT ${functionColumns} FROM bff_function_versions WHERE project_id=? AND name=? ORDER BY version DESC`).bind(projectId, functionName).all();
        return reply({ function: fn, versions: versions.results });
      }
      if (method !== 'PUT') throw new BffError('method_not_allowed', 405);
      const input = parse(functionInput, await body(request));
      if (new TextEncoder().encode(input.source).length > LIMITS.sourceBytes) throw new BffError('source_too_large', 413);
      const hash = await checksum(input.source);
      const result = await env.DB.prepare(`INSERT INTO bff_function_versions (project_id,name,version,source,checksum,database_access,created_at)
        SELECT ?,?,COALESCE(MAX(version),0)+1,?,?,?,? FROM bff_function_versions WHERE project_id=? AND name=?
        HAVING COALESCE(MAX(version),0)=? AND (COUNT(*)>0 OR (SELECT COUNT(DISTINCT name) FROM bff_function_versions WHERE project_id=?) < ?)`)
        .bind(projectId, functionName, input.source, hash, input.databaseAccess, new Date().toISOString(), projectId, functionName, input.expectedVersion, projectId, LIMITS.functions).run();
      if (!result.meta.changes) throw new BffError('function_version_conflict', 409);
      return reply({ name: functionName, version: input.expectedVersion + 1, checksum: hash }, 201);
    }
    throw new BffError('method_not_allowed', 405);
  } catch (error) {
    if (error instanceof BffError) return reply({ error: error.code }, error.status);
    console.error('bff_request_failed');
    return reply({ error: 'bff_unavailable' }, 503);
  }
}
