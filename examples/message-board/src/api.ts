import { demoConfig, demoUsers, type DemoUser } from './config.ts';

export type Message = {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
};

export type PublicBoardConfig = {
  apiOrigin: string;
  projectId: string;
  publicKey: string;
  table: string;
};

export type DemoSession = {
  session: { id: string; user_id: DemoUser; expires_at: string; created_at: string };
  token: string;
};

export const liveBoardConfig: PublicBoardConfig = demoConfig;

export class DemoApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'DemoApiError';
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function requestJson(url: string, init: RequestInit, fetcher: FetchLike, timeoutMs = 10_000): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetcher(url, {
        ...init,
        credentials: 'omit',
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) throw new DemoApiError('The request took too long. Check your connection and try again.');
      throw new DemoApiError('Could not reach the message board. Check your connection and try again.');
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      if (controller.signal.aborted) throw new DemoApiError('The request took too long. Check your connection and try again.');
      throw new DemoApiError('The message board returned an unreadable response. Try again.', response.status);
    }
    if (!response.ok) {
      const error = isRecord(payload) && typeof payload.error === 'string' && payload.error
        ? payload.error : `The request failed (HTTP ${response.status}).`;
      throw new DemoApiError(error, response.status);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function messagesFrom(payload: unknown): Message[] {
  if (!isRecord(payload) || !Array.isArray(payload.data) || !payload.data.every(isMessage)) {
    throw new DemoApiError('The message board returned data in an unexpected format. Try again later.');
  }
  return payload.data;
}

function tableUrl(config: PublicBoardConfig): string {
  return `${config.apiOrigin.replace(/\/$/, '')}/bff/data/${encodeURIComponent(config.projectId)}/tables/${encodeURIComponent(config.table)}`;
}

export async function fetchPublicMessages(
  config: PublicBoardConfig = liveBoardConfig,
  fetcher: FetchLike = fetch,
  timeoutMs = 10_000,
): Promise<Message[]> {
  try {
    return messagesFrom(await requestJson(`${tableUrl(config)}?select=*`, { headers: { apikey: config.publicKey } }, fetcher, timeoutMs));
  } catch (error) {
    if (error instanceof DemoApiError && error.status === 403) throw new DemoApiError('This public demo is unavailable right now. Try again later.', 403);
    throw error;
  }
}

export function createDemoApi(config: PublicBoardConfig = liveBoardConfig, fetcher: FetchLike = fetch) {
  const sessionUrl = `${config.apiOrigin.replace(/\/$/, '')}/bff/demo/session`;
  const headers = (session?: DemoSession) => ({ apikey: config.publicKey,
    ...(session ? { authorization: `Bearer ${session.token}` } : {}) });

  return {
    async login(userId: DemoUser): Promise<DemoSession> {
      const payload = await requestJson(sessionUrl, { method: 'POST',
        headers: { ...headers(), 'content-type': 'application/json' }, body: JSON.stringify({ userId }) }, fetcher);
      if (!isDemoSession(payload) || payload.session.user_id !== userId || Date.parse(payload.session.expires_at) <= Date.now()) {
        throw new DemoApiError('The demo returned an invalid session. Try logging in again.');
      }
      return payload;
    },
    async logout(session: DemoSession): Promise<void> {
      const payload = await requestJson(sessionUrl, { method: 'DELETE', headers: headers(session) }, fetcher);
      if (!isRecord(payload) || payload.revoked !== true) throw new DemoApiError('The demo did not confirm session revocation.');
    },
    async list(session: DemoSession): Promise<Message[]> {
      return messagesFrom(await requestJson(`${tableUrl(config)}?select=*`, { headers: headers(session) }, fetcher));
    },
    async update(session: DemoSession, message: Message, body: string): Promise<Message | null> {
      const text = body.trim();
      if (!text || text.length > 2000) throw new DemoApiError('Enter a message of 1–2000 characters.');
      if (!message.id) throw new DemoApiError('Choose a message to edit.');
      const payload = await requestJson(`${tableUrl(config)}?id=eq.${encodeURIComponent(message.id)}`, {
        method: 'PATCH', headers: { ...headers(session), 'content-type': 'application/json' },
        // Preserve the original author; an authenticated non-owner receives the
        // backend's ownership-policy error rather than a client-side rejection.
        body: JSON.stringify({ body: text, user_id: message.user_id }),
      }, fetcher);
      const rows = messagesFrom(payload);
      if (rows.length > 1 || rows.some(row => row.id !== message.id)) throw new DemoApiError('The demo returned an unexpected message after saving.');
      return rows[0] ?? null;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDemoSession(value: unknown): value is DemoSession {
  return isRecord(value) && isRecord(value.session)
    && typeof value.token === 'string' && /^bff_us_[a-f0-9]{64}$/.test(value.token)
    && typeof value.session.id === 'string' && !!value.session.id
    && demoUsers.includes(value.session.user_id as DemoUser)
    && typeof value.session.expires_at === 'string' && Number.isFinite(Date.parse(value.session.expires_at))
    && typeof value.session.created_at === 'string' && Number.isFinite(Date.parse(value.session.created_at));
}

function isMessage(value: unknown): value is Message {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.user_id === 'string'
    && typeof value.body === 'string'
    && typeof value.created_at === 'string'
    && Number.isFinite(Date.parse(value.created_at));
}

export type { DemoUser } from './config.ts';
