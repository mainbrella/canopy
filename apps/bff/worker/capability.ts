import { RpcTarget } from 'cloudflare:workers';
import { BffError, LIMITS, type Project, type SqlQuery } from './contracts';
import { ProjectDatabase } from './database';
import { deleteQuery, insertQuery, selectQuery, updateQuery } from './table-queries';

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

  async #query(query: SqlQuery, write = false) {
    if (this.#closed || Date.now() >= this.#expires) throw new BffError('execution_expired');
    if (this.#remaining-- <= 0) throw new BffError('database_call_limit');
    if (write && this.#access !== 'write') throw new BffError('database_write_denied');
    const project = await this.#env.DB.prepare('SELECT suspended,blocked,state FROM bff_projects WHERE id=?').bind(this.#project.id).first<Project>();
    if (!project || project.blocked || project.suspended || project.state !== 'ready' || this.#env.BFF_ENABLED !== 'true') throw new BffError('project_unavailable');
    if (this.#closed || Date.now() >= this.#expires) throw new BffError('execution_expired');
    const [result] = await new ProjectDatabase(this.#env, this.#project).query([query]);
    const output = JSON.stringify(result);
    if (new TextEncoder().encode(output).length > LIMITS.outputBytes) throw new BffError('database_result_too_large');
    return result;
  }

  async select(table: string, where: unknown = {}, limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new BffError('invalid_limit');
    return this.#query(selectQuery(table, where, limit));
  }
  async insert(table: string, row: unknown) {
    return this.#query(insertQuery(table, row), true);
  }
  async update(table: string, where: unknown, row: unknown) {
    return this.#query(updateQuery(table, where, row), true);
  }
  async remove(table: string, where: unknown) {
    return this.#query(deleteQuery(table, where), true);
  }
}
