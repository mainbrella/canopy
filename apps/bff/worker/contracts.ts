import { z } from 'zod';

export const VERSION = '0.0.1';
export const LIMITS = {
  projects: 5, schemaTables: 50, functions: 100, versions: 100, sourceBytes: 32_768,
  inputBytes: 65_536, outputBytes: 65_536, sqlBytes: 32_768,
  migrationStatements: 50, queriesPerDay: 10_000, invocationsPerDay: 1_000,
  concurrentInvocations: 3, databaseCalls: 10, cpuMs: 50, wallMs: 5_000,
} as const;
export const nameInput = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/);
export const scalar = z.union([z.string().max(16_384), z.number().finite(), z.null()]);
export const projectInput = z.object({ name: z.string().trim().min(1).max(80) }).strict();
export const projectPatch = z.object({ suspended: z.boolean() }).strict();
export const queryInput = z.object({ sql: z.string().min(1).max(LIMITS.sqlBytes), params: z.array(scalar).max(100).default([]) }).strict();
export const migrationInput = z.object({
  sequence: z.number().int().min(1), name: nameInput,
  sql: z.string().min(1).max(LIMITS.sqlBytes),
}).strict();
export const functionInput = z.object({
  source: z.string().min(1).max(LIMITS.sourceBytes),
  databaseAccess: z.enum(['none', 'read', 'write']).default('none'),
  expectedVersion: z.number().int().min(0).max(LIMITS.versions - 1),
}).strict();
export const invokeInput = z.object({ input: z.json(), version: z.number().int().min(1).max(LIMITS.versions).optional() }).strict();
export const filterInput = z.record(nameInput, scalar).refine(value => Object.keys(value).length <= 50);

export class BffError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new BffError('invalid_request');
  return result.data;
}
export async function checksum(source: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
export type Project = {
  id: string; user_id: string; name: string; database_id: string | null;
  state: 'pending' | 'ready' | 'error'; suspended: number; blocked: number; created_at: string;
};
export type FunctionVersion = {
  project_id: string; name: string; version: number; source: string; checksum: string;
  database_access: 'none' | 'read' | 'write'; created_at: string;
};
export type SqlQuery = { sql: string; params?: (string | number | null)[] };
export type QueryResult = { success: boolean; results: Record<string, unknown>[]; meta?: Record<string, unknown> };
