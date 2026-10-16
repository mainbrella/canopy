import type { HighlighterCore, ThemedToken } from 'shiki/types';

// Explicit imports keep unused grammars and themes out of the browser bundle.
const languageLoaders = {
  javascript: () => import('@shikijs/langs/javascript'),
  typescript: () => import('@shikijs/langs/typescript'),
  jsx: () => import('@shikijs/langs/jsx'),
  tsx: () => import('@shikijs/langs/tsx'),
  html: () => import('@shikijs/langs/html'),
  css: () => import('@shikijs/langs/css'),
  scss: () => import('@shikijs/langs/scss'),
  sass: () => import('@shikijs/langs/sass'),
  less: () => import('@shikijs/langs/less'),
  vue: () => import('@shikijs/langs/vue'),
  svelte: () => import('@shikijs/langs/svelte'),
  astro: () => import('@shikijs/langs/astro'),
  json: () => import('@shikijs/langs/json'),
  jsonc: () => import('@shikijs/langs/jsonc'),
  json5: () => import('@shikijs/langs/json5'),
  yaml: () => import('@shikijs/langs/yaml'),
  toml: () => import('@shikijs/langs/toml'),
  ini: () => import('@shikijs/langs/ini'),
  dotenv: () => import('@shikijs/langs/dotenv'),
  xml: () => import('@shikijs/langs/xml'),
  markdown: () => import('@shikijs/langs/markdown'),
  mdx: () => import('@shikijs/langs/mdx'),
  python: () => import('@shikijs/langs/python'),
  go: () => import('@shikijs/langs/go'),
  rust: () => import('@shikijs/langs/rust'),
  java: () => import('@shikijs/langs/java'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  ruby: () => import('@shikijs/langs/ruby'),
  php: () => import('@shikijs/langs/php'),
  swift: () => import('@shikijs/langs/swift'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  dart: () => import('@shikijs/langs/dart'),
  scala: () => import('@shikijs/langs/scala'),
  lua: () => import('@shikijs/langs/lua'),
  perl: () => import('@shikijs/langs/perl'),
  r: () => import('@shikijs/langs/r'),
  elixir: () => import('@shikijs/langs/elixir'),
  sql: () => import('@shikijs/langs/sql'),
  graphql: () => import('@shikijs/langs/graphql'),
  shellscript: () => import('@shikijs/langs/shellscript'),
  powershell: () => import('@shikijs/langs/powershell'),
  dockerfile: () => import('@shikijs/langs/dockerfile'),
  make: () => import('@shikijs/langs/make'),
  cmake: () => import('@shikijs/langs/cmake'),
  diff: () => import('@shikijs/langs/diff'),
};
type CodeLanguage = keyof typeof languageLoaders;
const extensions: Record<string, CodeLanguage> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', sass: 'sass', less: 'less',
  vue: 'vue', svelte: 'svelte', astro: 'astro',
  json: 'json', jsonc: 'jsonc', json5: 'json5', yaml: 'yaml', yml: 'yaml',
  toml: 'toml', ini: 'ini', xml: 'xml', md: 'markdown', markdown: 'markdown', mdx: 'mdx',
  py: 'python', pyi: 'python', go: 'go', rs: 'rust', java: 'java',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hxx: 'cpp', hh: 'cpp',
  cs: 'csharp', rb: 'ruby', php: 'php', phtml: 'php', swift: 'swift',
  kt: 'kotlin', kts: 'kotlin', dart: 'dart', scala: 'scala', lua: 'lua',
  pl: 'perl', pm: 'perl', r: 'r', ex: 'elixir', exs: 'elixir',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
  sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript',
  ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
  dockerfile: 'dockerfile', mk: 'make', cmake: 'cmake', diff: 'diff', patch: 'diff',
};

export function buildCodeLanguage(path: string, text = ''): CodeLanguage | null {
  const name = path.split('/').at(-1)!.toLowerCase();
  if (/^(?:dockerfile|containerfile)(?:\.|$)/.test(name)) return 'dockerfile';
  if (['makefile', 'gnumakefile'].includes(name)) return 'make';
  if (name === 'cmakelists.txt') return 'cmake';
  if (/^\.env(?:\.|$)/.test(name)) return 'dotenv';
  if (['cargo.lock', 'poetry.lock'].includes(name)) return 'toml';
  if (/^(?:tsconfig|jsconfig)(?:\..+)?\.json$/.test(name) || ['.babelrc', '.eslintrc'].includes(name)) return 'jsonc';
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  if (Object.hasOwn(extensions, extension)) return extensions[extension];
  const shebang = text.split(/[\r\n]/, 1)[0];
  if (shebang.startsWith('#!')) {
    if (/\bpython[\d.]*\b/.test(shebang)) return 'python';
    if (/\b(?:node|deno|bun)\b/.test(shebang)) return 'javascript';
    if (/\bruby\b/.test(shebang)) return 'ruby';
    if (/\bperl\b/.test(shebang)) return 'perl';
    if (/\bpwsh\b/.test(shebang)) return 'powershell';
    if (/\b(?:sh|bash|dash|ksh|zsh)\b/.test(shebang)) return 'shellscript';
  }
  return null;
}

let highlighterPromise: Promise<HighlighterCore> | undefined;
function getHighlighter() {
  return highlighterPromise ??= Promise.all([
    import('shiki/core'), import('shiki/engine/javascript'), import('@shikijs/themes/github-dark-default'),
  ]).then(([{ createHighlighterCore }, { createJavaScriptRegexEngine }, theme]) => createHighlighterCore({
    langs: [], themes: [theme], engine: createJavaScriptRegexEngine(),
  })).catch(error => { highlighterPromise = undefined; throw error; });
}

export async function buildCodeTokens(path: string, text: string, isCurrent = () => true): Promise<ThemedToken[][] | null> {
  // Bound regex work and the number of DOM nodes for generated/minified files.
  if (!text || text.length > 100_000 || !isCurrent()) return null;
  const lines = text.split(/\r?\n/);
  if (lines.length > 2_000 || lines.some(line => line.length > 2_000)) return null;
  const language = buildCodeLanguage(path, text);
  if (!language) return null;
  try {
    const highlighter = await getHighlighter();
    if (!isCurrent()) return null;
    await highlighter.loadLanguage(languageLoaders[language]);
    if (!isCurrent()) return null;
    return highlighter.codeToTokensBase(text, { lang: language, theme: 'github-dark-default' });
  } catch {
    // Reading and copying the file still work if a grammar cannot load.
    return null;
  }
}

export function buildCodeFragment(text: string, tokens: ThemedToken[][]): DocumentFragment {
  const fontStyles = { italic: 1, bold: 2, underline: 4, strikethrough: 8 };
  const fragment = document.createDocumentFragment(), newlines = text.match(/\r?\n/g) ?? [];
  tokens.forEach((line, index) => {
    if (index) fragment.append(newlines[index - 1]);
    for (const token of line) {
      const span = document.createElement('span'); span.textContent = token.content;
      if (token.color) span.style.color = token.color;
      if (token.fontStyle) {
        if (token.fontStyle & fontStyles.italic) span.style.fontStyle = 'italic';
        if (token.fontStyle & fontStyles.bold) span.style.fontWeight = 'bold';
        const decorations = [];
        if (token.fontStyle & fontStyles.underline) decorations.push('underline');
        if (token.fontStyle & fontStyles.strikethrough) decorations.push('line-through');
        if (decorations.length) span.style.textDecoration = decorations.join(' ');
      }
      fragment.append(span);
    }
  });
  return fragment;
}
