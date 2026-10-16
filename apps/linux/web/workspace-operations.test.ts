import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceJournal, WORKSPACE_RECOVERY_MS } from './workspace-operations.ts';

const body = { id: 'c1', createdAt: '2026-10-12T12:00:00.000Z', name: 'Prepared app', stop: false };
const key = '9de24b0b-7cdb-481b-aec2-fb7ef883f050';
function fixture() {
  const values = new Map<string, string>();
  const storage = () => ({ getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } });
  const options = { accountId: 'owner-a', apiOrigin: 'https://api.test', storage, now: () => 1000, key: () => key };
  return { values, options, journal: createWorkspaceJournal(options) };
}

test('a lost save response retains the exact request and key across reloads', () => {
  const f = fixture();
  const sent = f.journal.begin('save', body);
  const reloaded = createWorkspaceJournal(f.options);
  assert.deepEqual(reloaded.read(), sent);
  assert.equal(reloaded.read()!.bodyText, JSON.stringify(body));
  assert.equal(reloaded.read()!.key, key);
  assert.throws(() => reloaded.begin('save', { ...body, name: 'Duplicate' }), /workspace_request_pending/);
  reloaded.rememberResource(sent, { id: key });
  assert.deepEqual(createWorkspaceJournal(f.options).read()!.resource, { id: key });
});

test('pending restores belong to one account and API origin', () => {
  const f = fixture();
  f.journal.begin('restore', { workspaceId: key });
  assert.equal(createWorkspaceJournal({ ...f.options, accountId: 'owner-b' }).read(), null);
  assert.equal(createWorkspaceJournal({ ...f.options, apiOrigin: 'https://another-api.test' }).read(), null);
  const other = createWorkspaceJournal({ ...f.options, accountId: 'owner-b' });
  f.values.set(other.storageKey, f.values.get(f.journal.storageKey)!);
  assert.throws(() => other.read(), /workspace_journal_invalid/);
});

test('blocked or nonpersistent storage prevents admission before any request exists', () => {
  for (const storage of [() => { throw new Error('blocked'); }, () => ({ getItem: () => null, setItem() {}, removeItem() {} })]) {
    const journal = createWorkspaceJournal({ accountId: 'owner', apiOrigin: 'https://api.test', storage });
    assert.throws(() => journal.begin('save', body), /workspace_storage_unavailable/);
  }
});

test('expired or clock-reversed operations remain visible but cannot replay', () => {
  const f = fixture();
  const operation = f.journal.begin('restore', { workspaceId: key });
  assert.equal(f.journal.retryable(operation), true);
  for (const now of [999, 1000 + WORKSPACE_RECOVERY_MS]) {
    const journal = createWorkspaceJournal({ ...f.options, now: () => now });
    assert.equal(journal.retryable(operation), false);
    assert.equal(journal.read()!.key, operation.key);
  }
});

test('finishing one operation cannot clear a replacement written by another tab', () => {
  const f = fixture();
  const operation = f.journal.begin('save', body);
  assert.throws(() => f.journal.finish({ ...operation, key: 'other-key' }), /workspace_request_changed/);
  assert.equal(f.journal.read()!.key, key);
  f.journal.finish(operation);
  assert.equal(f.journal.read(), null);
});

test('corrupt pending data is not silently discarded to create a duplicate', () => {
  const f = fixture();
  f.values.set(f.journal.storageKey, '{invalid');
  assert.throws(() => f.journal.begin('save', body), /workspace_journal_invalid/);
  assert.equal(f.values.get(f.journal.storageKey), '{invalid');
});


test('two tabs serialize admission and reconciliation through the account-scoped lock', async () => {
  const f = fixture();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let tail = Promise.resolve();
  const requested: string[] = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request(name: string, action: () => Promise<unknown>) {
      requested.push(name);
      const result = tail.then(action);
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  } } });
  try {
    const otherTab = createWorkspaceJournal(f.options);
    const first = f.journal.exclusive(async () => {
      const operation = f.journal.begin('save', body);
      await Promise.resolve(); // Response can arrive after another tab asks to act.
      f.journal.rememberResource(operation, { id: key });
    });
    const second = otherTab.exclusive(async () => otherTab.begin('save', { ...body, name: 'Duplicate' }));
    await first;
    await assert.rejects(second, /workspace_request_pending/);
    await otherTab.exclusive(async () => otherTab.finish(otherTab.read()!));
    assert.equal(f.journal.read(), null);
    assert.deepEqual(requested, Array(3).fill(f.journal.storageKey));
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});
