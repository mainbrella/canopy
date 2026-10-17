import { RpcTarget } from 'cloudflare:workers';
import { BffError, filterInput, LIMITS, parse, type Project } from './contracts';
import { ProjectDatabase } from './database';
import { identifier } from './sql';

// This object crosses the isolate boundary via RPC. Its private fields, parent
// environment, credentials and database ID do not. No raw SQL method is exposed.
export class DatabaseCapability extends RpcTarget {
  #remaining = LIMITS.databaseCalls as number;
  #closed = false;
  #expires = Date.now() + LIMITS.wallMs;
  #env: Env;
  #project: Project;
  #access: 'read' | 'write';
  constructor(env: Env, project: Project, access: 'read' | 'write') {
    super(); this.#env = env; this.#project = project; this.#access = access;
  }
  // Only the parent owns this setter; exposing close can only revoke access.
  close() { this.#closed = true; }

  async #query(sql: string, params: (string | number | null)[], write = false) {
    if (this.#closed || Date.now() >= this.#expires) throw new BffError('execution_expired');
    if (this.#remaining-- <= 0) throw new BffError('database_call_limit');
    if (write && this.#access !== 'write') throw new BffError('database_write_denied');
    const project = await this.#env.DB.prepare('SELECT suspended,blocked,state FROM bff_projects WHERE id=?').bind(this.#project.id).first<Project>();
    if (!project || project.blocked || project.suspended || project.state !== 'ready' || this.#env.BFF_ENABLED !== 'true') throw new BffError('project_unavailable');
    if (this.#closed || Date.now() >= this.#expires) throw new BffError('execution_expired');
    const [result] = await new ProjectDatabase(this.#env, this.#project).query([{ sql, params }]);
    const output = JSON.stringify(result);
    if (new TextEncoder().encode(output).length > LIMITS.outputBytes) throw new BffError('database_result_too_large');
    return result;
  }

  #values(value: unknown) {
    if (new TextEncoder().encode(JSON.stringify(value)).length > LIMITS.inputBytes) throw new BffError('database_input_too_large');
    return Object.entries(parse(filterInput, value)).map(([key, item]) => [identifier(key), item] as const);
  }
  #where(value: unknown, required = false) {
    const entries = this.#values(value);
    if (required && !entries.length) throw new BffError('filter_required');
    return { sql: entries.length ? ` WHERE ${entries.map(([key]) => `${key} IS ?`).join(' AND ')}` : '', params: entries.map(([, item]) => item) };
  }
  async select(table: string, where: unknown = {}, limit = 100) {
    const filter = this.#where(where);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new BffError('invalid_limit');
    return this.#query(`SELECT * FROM ${identifier(table)}${filter.sql} LIMIT ?`, [...filter.params, limit]);
  }
  async insert(table: string, row: unknown) {
    const entries = this.#values(row);
    if (!entries.length) throw new BffError('row_required');
    return this.#query(`INSERT INTO ${identifier(table)} (${entries.map(([key]) => key).join(',')}) VALUES (${entries.map(() => '?').join(',')}) RETURNING *`, entries.map(([, item]) => item), true);
  }
  async update(table: string, where: unknown, row: unknown) {
    const filter = this.#where(where, true), entries = this.#values(row);
    if (!entries.length) throw new BffError('row_required');
    return this.#query(`UPDATE ${identifier(table)} SET ${entries.map(([key]) => `${key}=?`).join(',')}${filter.sql} RETURNING *`, [...entries.map(([, item]) => item), ...filter.params], true);
  }
  async remove(table: string, where: unknown) {
    const filter = this.#where(where, true);
    return this.#query(`DELETE FROM ${identifier(table)}${filter.sql}`, filter.params, true);
  }
}
