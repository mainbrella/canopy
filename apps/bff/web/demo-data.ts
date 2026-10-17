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

export const liveBoardConfig: PublicBoardConfig = {
  apiOrigin: 'https://api.mainbrella.com',
  projectId: '90da3093-84b6-4cd7-a39a-a8afc39403b8',
  publicKey: 'bff_pk_1f9bb9fd543d6a5476ad7ce210577c2479d290a5cdc06282de9eb884d57005c4',
  table: 'messages',
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function fetchPublicMessages(
  config: PublicBoardConfig = liveBoardConfig,
  fetcher: FetchLike = fetch,
  timeoutMs = 10_000,
): Promise<Message[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${config.apiOrigin.replace(/\/$/, '')}/bff/data/${encodeURIComponent(config.projectId)}/tables/${encodeURIComponent(config.table)}?select=*`;

  try {
    let response: Response;
    try {
      response = await fetcher(url, {
        headers: { apikey: config.publicKey },
        credentials: 'omit',
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new Error('The request took too long. Check your connection and try again.');
      throw new Error('Could not reach the message board. Check your connection and try again.');
    }

    if (!response.ok) {
      if (response.status === 403) throw new Error('This public demo is unavailable right now. Try again later.');
      if (response.status === 404) throw new Error('The message board could not be found. Try again later.');
      if (response.status >= 500) throw new Error('The message board is temporarily unavailable. Try again.');
      throw new Error('Could not load the message board. Try again.');
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error('The message board returned an unreadable response. Try again.');
    }
    if (!isRecord(payload) || !Array.isArray(payload.data) || !payload.data.every(isMessage)) {
      throw new Error('The message board returned data in an unexpected format. Try again later.');
    }
    return payload.data;
  } finally {
    clearTimeout(timeout);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMessage(value: unknown): value is Message {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.user_id === 'string'
    && typeof value.body === 'string'
    && typeof value.created_at === 'string'
    && Number.isFinite(Date.parse(value.created_at));
}
