// Keep bookmarked dashboard workspaces usable after moving Build to its own app.
export function legacyBuildURL(search: string, hash = ''): string | null {
  const params = new URLSearchParams(search);
  if (params.get('view') !== 'build') return null;
  params.delete('view');
  const query = params.toString();
  return `/build/${query ? `?${query}` : ''}${hash}`;
}
