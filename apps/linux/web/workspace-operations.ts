// Keep a request durable before sending it. A reload must never mint a replacement
// key for an operation whose response might have been lost.
export const WORKSPACE_RECOVERY_MS = 24 * 60 * 60_000 - 5 * 60_000;
export interface WorkspaceOperation {
  version: 1;
  accountId: string;
  apiOrigin: string;
  kind: 'save' | 'restore';
  key: string;
  bodyText: string;
  startedAt: number;
  retryUntil: number;
  resource?: { id: string; createdAt?: string };
}
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);

export function createWorkspaceJournal({ accountId, apiOrigin, storage = () => window.localStorage, now = Date.now, key = () => crypto.randomUUID() }: {
  accountId: string; apiOrigin: string; storage?: () => StorageLike; now?: () => number; key?: () => string;
}) {
  if (!accountId) throw new Error('workspace_account_required');
  const origin = new URL(apiOrigin).origin;
  const storageKey = `mainbrella:workspace-operation:v1:${encodeURIComponent(origin)}:${encodeURIComponent(accountId)}`;
  function read(): WorkspaceOperation | null {
    let raw: string | null;
    try { raw = storage().getItem(storageKey); } catch { throw new Error('workspace_storage_unavailable'); }
    if (raw === null) return null;
    try {
      if (raw.length > 20_000) throw new Error();
      const value = JSON.parse(raw) as WorkspaceOperation;
      if (value.version !== 1 || value.accountId !== accountId || value.apiOrigin !== origin || !uuid(value.key)
        || !['save', 'restore'].includes(value.kind) || typeof value.bodyText !== 'string'
        || !Number.isSafeInteger(value.startedAt) || value.retryUntil !== value.startedAt + WORKSPACE_RECOVERY_MS) throw new Error();
      const body = JSON.parse(value.bodyText);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
      if (value.kind === 'restore' && (!uuid(body.workspaceId) || Object.keys(body).length !== 1)) throw new Error();
      if (value.kind === 'save' && (typeof body.id !== 'string' || !/^(?:small|c[1-9]\d{0,2})$/.test(body.id)
        || typeof body.createdAt !== 'string' || new Date(body.createdAt).toISOString() !== body.createdAt
        || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 80 || typeof body.stop !== 'boolean'
        || Object.keys(body).some(name => !['id', 'createdAt', 'name', 'stop', 'launch'].includes(name)))) throw new Error();
      if (value.resource && (typeof value.resource.id !== 'string' || value.kind === 'save' && !uuid(value.resource.id)
        || value.kind === 'restore' && (typeof value.resource.createdAt !== 'string' || !Number.isFinite(Date.parse(value.resource.createdAt))))) throw new Error();
      return value;
    } catch { throw new Error('workspace_journal_invalid'); }
  }
  function write(value: WorkspaceOperation) {
    const serialized = JSON.stringify(value);
    try {
      storage().setItem(storageKey, serialized);
      if (storage().getItem(storageKey) !== serialized) throw new Error();
    } catch { throw new Error('workspace_storage_unavailable'); }
  }
  return {
    storageKey,
    read,
    // Mutations must run inside exclusive(), including background reconciliation.
    begin(kind: WorkspaceOperation['kind'], body: unknown) {
      if (read()) throw new Error('workspace_request_pending');
      const startedAt = now();
      const value: WorkspaceOperation = { version: 1, accountId, apiOrigin: origin, kind, key: key(), bodyText: JSON.stringify(body), startedAt, retryUntil: startedAt + WORKSPACE_RECOVERY_MS };
      write(value);
      return read()!;
    },
    rememberResource(operation: WorkspaceOperation, resource: NonNullable<WorkspaceOperation['resource']>) {
      const current = read();
      if (current?.key !== operation.key) throw new Error('workspace_request_changed');
      write({ ...current, resource });
    },
    finish(operation: WorkspaceOperation) {
      if (read()?.key !== operation.key) throw new Error('workspace_request_changed');
      try { storage().removeItem(storageKey); } catch { throw new Error('workspace_storage_unavailable'); }
      if (read()) throw new Error('workspace_storage_unavailable');
    },
    retryable(operation: WorkspaceOperation) { return now() >= operation.startedAt && now() < operation.retryUntil; },
    async exclusive<T>(action: () => Promise<T>): Promise<T> {
      if (!globalThis.navigator?.locks) throw new Error('workspace_lock_unavailable');
      return navigator.locks.request(storageKey, action);
    },
  };
}

export type WorkspaceJournal = ReturnType<typeof createWorkspaceJournal>;
