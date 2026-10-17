import { BffError, LIMITS, parse, tableNameInput, tablePolicyInput, type DatabasePrincipal, type Project, type TablePolicy } from './contracts';
import { ProjectDatabase } from './database';
import { body, readyProject } from './http';
import { identifier } from './sql';

// The principal is constructed by the trusted gateway, never from function input
// or caller-supplied row filters. Every anonymous database operation uses this gate.
export async function authorizeTable(env: Env, project: Project, principal: DatabasePrincipal, table: string, operation: 'select' | 'insert' | 'update' | 'delete') {
  identifier(table);
  if (principal.role === 'owner') return;
  // Public writes need their own policy model; a legacy key grant cannot enable them.
  if (operation !== 'select') throw new BffError('permission_denied', 403);
  const grant = await env.DB.prepare(`SELECT g.tables,p.select_access
    FROM bff_api_key_grants g JOIN api_keys k ON k.id=g.api_key_id
    LEFT JOIN bff_table_policies p ON p.project_id=g.project_id AND p.table_name=?
    WHERE g.api_key_id=? AND g.project_id=? AND k.user_id=?`)
    .bind(table, principal.keyId, project.id, project.user_id).first<{ tables: string; select_access: string | null }>();
  if (!grant || grant.select_access !== 'public') throw new BffError('permission_denied', 403);
  const tables = JSON.parse(grant.tables) as Record<string, string[]>;
  if (!Object.hasOwn(tables, table) || !tables[table].includes('select')) throw new BffError('permission_denied', 403);
}

export async function managePolicies(request: Request, env: Env, project: Project, table?: string) {
  if (!table) {
    if (request.method !== 'GET') throw new BffError('method_not_allowed', 405);
    const rows = await env.DB.prepare('SELECT table_name AS "table",select_access AS "select",updated_at FROM bff_table_policies WHERE project_id=? ORDER BY table_name')
      .bind(project.id).all<TablePolicy>();
    return { policies: rows.results };
  }
  parse(tableNameInput, table);
  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM bff_table_policies WHERE project_id=? AND table_name=?').bind(project.id, table).run();
    return { revoked: true };
  }
  if (request.method !== 'PUT') throw new BffError('method_not_allowed', 405);
  readyProject(env, project);
  const input = parse(tablePolicyInput, await body(request));
  const [schema] = await new ProjectDatabase(env, project).query([{ sql: "SELECT name FROM sqlite_schema WHERE type='table' AND name=?", params: [table] }]);
  if (!schema.results.length) throw new BffError('table_not_found', 404);
  const policy: TablePolicy = { table, select: input.select, updated_at: new Date().toISOString() };
  const result = await env.DB.prepare(`INSERT INTO bff_table_policies(project_id,table_name,select_access,updated_at)
    SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM bff_table_policies WHERE project_id=? AND table_name=?)
      OR (SELECT COUNT(*) FROM bff_table_policies WHERE project_id=?) < ?
    ON CONFLICT(project_id,table_name) DO UPDATE SET select_access=excluded.select_access,updated_at=excluded.updated_at`)
    .bind(project.id, table, policy.select, policy.updated_at, project.id, table, project.id, LIMITS.tablePolicies).run();
  if (!result.meta.changes) throw new BffError('table_policy_limit', 429);
  return { policy };
}
