export type BuildFunding = { brief?: string; returnTo: string };

const briefPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const storagePrefix = 'mainbrella-build-onboarding:v1:';

export function readBuildFunding(value: unknown, origin: string): BuildFunding | null {
  if (!value || typeof value !== 'object') return null;
  const { brief, returnTo } = value as Record<string, unknown>;
  if (brief !== undefined && (typeof brief !== 'string' || !briefPattern.test(brief))) return null;
  if (typeof returnTo !== 'string' || !returnTo.startsWith('/') || returnTo.startsWith('//')) return null;
  try {
    const destination = new URL(returnTo, origin);
    if (destination.origin !== origin || destination.pathname !== '/build/' || destination.hash
      || destination.search !== (brief ? `?brief=${brief}` : '')) return null;
    return { ...(brief ? { brief } : {}), returnTo: destination.pathname + destination.search };
  } catch { return null; }
}

export function buildFundingUrl(brief: string | null, origin: string): string {
  if (brief !== null && !briefPattern.test(brief)) throw new Error('invalid_brief');
  const url = new URL('/pricing/usage/', origin);
  url.searchParams.set('flow', 'build');
  if (brief) url.searchParams.set('brief', brief);
  url.searchParams.set('returnTo', `/build/${brief ? `?brief=${brief}` : ''}`);
  return url.pathname + url.search;
}

export function buildLoginUrl(brief: string | null, origin: string): string {
  return `/login/?${new URLSearchParams({ returnTo: buildFundingUrl(brief, origin) })}`;
}

export function saveBuildPrompt(storage: Pick<Storage, 'setItem'>, brief: string, prompt: string): void {
  const text = prompt.trim();
  if (!briefPattern.test(brief) || !text || text.length > 6000) throw new Error('invalid_prompt');
  storage.setItem(storagePrefix + brief, text);
}

export function readBuildPrompt(storage: Pick<Storage, 'getItem'>, brief: string | null): string | null {
  if (!brief || !briefPattern.test(brief)) return null;
  try {
    const text = storage.getItem(storagePrefix + brief);
    return text && text.trim() && text.length <= 6000 ? text : null;
  } catch { return null; }
}

export function removeBuildPrompt(storage: Pick<Storage, 'removeItem'>, brief: string): void {
  try { storage.removeItem(storagePrefix + brief); } catch { /* The Builder brief is already preserved. */ }
}
