import { z } from 'zod';
import { cookieSecurity, errors, jsonResponse, register, requestBody, type LegacyHandler, type OpenAPIApi } from '../../backend/worker/app/openapi-shared';
import { functionInput, invokeInput, migrationInput, projectInput, projectPatch, queryInput } from './contracts';

const project = z.object({ id: z.string().uuid(), name: z.string(), state: z.enum(['pending', 'ready', 'error']), suspended: z.boolean(), created_at: z.string() });
const row = z.record(z.string(), z.unknown());
const result = z.object({ success: z.boolean(), results: z.array(row), meta: row.optional() });
const fn = z.object({ name: z.string(), version: z.number().int(), checksum: z.string(), database_access: z.enum(['none', 'read', 'write']), created_at: z.string() });
const params = z.object({ projectId: z.string().uuid() });
const functionParams = params.extend({ functionName: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/) });

export function registerBffRoutes(api: OpenAPIApi, handler: LegacyHandler) {
  const common = { tags: ['BFF'], security: cookieSecurity,
    description: 'BFF v0.0.1 owner-only management API. Requires a Mainbrella session cookie and an allowed Origin. Project data lives in a dedicated D1 database. No public/client credentials or end-user row policies are available in this release.' };
  const failure = errors(400, 401, 403, 404, 405, 408, 409, 413, 415, 422, 429, 502, 503);
  const route = (method: 'get' | 'post' | 'patch' | 'put', path: string, operationId: string, summary: string,
    request: object | undefined, response: z.ZodType, created = false) => register(api, method, path, {
      ...common, operationId, summary, ...(request ? { request } : {}),
      responses: { [created ? 201 : 200]: jsonResponse(response), ...(created && path === '/bff/projects' ? { 200: jsonResponse(response, 'Existing project returned on a name-based retry.') } : {}), ...failure },
    }, handler);
  route('get', '/bff/config', 'getBffConfig', 'Read BFF availability and execution limits', undefined,
    z.object({ version: z.string(), available: z.boolean(), functionsAvailable: z.boolean(), limits: z.record(z.string(), z.number()) }));
  route('get', '/bff/projects', 'listBffProjects', 'List your BFF projects', undefined, z.object({ projects: z.array(project) }));
  route('post', '/bff/projects', 'createBffProject', 'Create an empty BFF project; provision its database separately', requestBody(projectInput), z.object({ project }), true);
  const base = '/bff/projects/{projectId}';
  route('get', base, 'getBffProject', 'Read your BFF project', { params }, z.object({ project }));
  route('patch', base, 'pauseBffProject', 'Pause or resume database and function operations', { params, ...requestBody(projectPatch) }, z.object({ project }));
  route('post', `${base}/provision`, 'provisionBffDatabase', 'Provision or recover the project D1 database', { params }, z.object({ project }));
  route('get', `${base}/schema`, 'getBffSchema', 'Inspect up to 50 tables, columns, and actual row counts', { params },
    z.object({ tables: z.array(z.object({ name: z.string(), sql: z.string().nullable(), count: z.number(), columns: z.array(z.object({ name: z.string(), type: z.string(), notnull: z.number(), dflt_value: z.unknown(), pk: z.number() })) })), truncated: z.boolean() }));
  route('post', `${base}/query`, 'queryBffDatabase', 'Execute one SELECT, INSERT, UPDATE, or DELETE statement', { params, ...requestBody(queryInput) }, z.object({ result }));
  route('get', `${base}/migrations`, 'listBffMigrations', 'List up to 100 applied schema migrations', { params },
    z.object({ migrations: z.array(z.object({ sequence: z.number(), name: z.string(), checksum: z.string(), sql: z.string(), applied_at: z.string() })) }));
  route('post', `${base}/migrations`, 'applyBffMigration', 'Atomically apply the next migration with checksum-verified retries', { params, ...requestBody(migrationInput) }, z.object({ applied: z.boolean(), checksum: z.string() }));
  route('get', `${base}/functions`, 'listBffFunctions', 'List the latest saved function versions', { params }, z.object({ functions: z.array(fn) }));
  route('get', `${base}/functions/{functionName}`, 'getBffFunction', 'Read function source and version history', { params: functionParams },
    z.object({ function: fn.extend({ project_id: z.string(), source: z.string() }), versions: z.array(fn) }));
  route('put', `${base}/functions/{functionName}`, 'saveBffFunction', 'Save an immutable JavaScript function version', { params: functionParams, ...requestBody(functionInput) },
    z.object({ name: z.string(), version: z.number(), checksum: z.string() }), true);
  // z.json() validates recursively at runtime. The document uses an unconstrained
  // JSON value because this OpenAPI generator cannot expand recursive unions.
  route('post', `${base}/functions/{functionName}/invoke`, 'invokeBffFunction', 'Invoke an isolated function with denied network access and explicit database capability', { params: functionParams, ...requestBody(invokeInput.omit({ input: true }).extend({ input: z.unknown() })) },
    z.object({ id: z.string(), version: z.number(), ok: z.boolean(), value: z.unknown().optional(), error: z.string().optional() }));
  route('get', `${base}/executions`, 'listBffExecutions', 'List up to 100 invocation records; inputs and results are not stored', { params },
    z.object({ executions: z.array(z.object({ id: z.string(), function_name: z.string(), version: z.number(), status: z.enum(['running', 'success', 'error', 'timeout']), error: z.string().nullable(), duration_ms: z.number().nullable(), created_at: z.string() })) }));
  route('get', `${base}/usage`, 'getBffUsage', 'Read today’s enforced database and invocation budgets in UTC', { params }, z.object({ day: z.string(), queries: z.number(), invocations: z.number() }));
}
