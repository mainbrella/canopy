import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCodeFragment, buildCodeLanguage, buildCodeTokens } from './build-code.ts';

test('source languages use extensions, config filenames and executable shebangs', () => {
  for (const [path, language] of [
    ['src/App.TSX', 'tsx'], ['src/types.d.ts', 'typescript'], ['vite.config.mts', 'typescript'],
    ['server.cjs', 'javascript'], ['app.jsx', 'jsx'], ['src/App.vue', 'vue'], ['app.svelte', 'svelte'],
    ['src/pages/index.astro', 'astro'], ['Dockerfile.production', 'dockerfile'], ['ops/Containerfile', 'dockerfile'],
    ['build/Makefile', 'make'], ['CMakeLists.txt', 'cmake'], ['.env.local', 'dotenv'],
    ['tsconfig.app.json', 'jsonc'], ['jsconfig.json', 'jsonc'], ['Cargo.lock', 'toml'], ['.eslintrc', 'jsonc'],
  ]) assert.equal(buildCodeLanguage(path), language, path);
  assert.equal(buildCodeLanguage('bin/start', '#!/usr/bin/env -S python3 -u\nprint("hello")'), 'python');
  assert.equal(buildCodeLanguage('bin/start', '#!/bin/bash\necho hello'), 'shellscript');
  assert.equal(buildCodeLanguage('bin/start', '#!/usr/bin/env node\nconsole.log("hello")'), 'javascript');
  for (const path of ['README.txt', '.gitignore', 'unknown.custom', 'no-extension', 'file.constructor']) {
    assert.equal(buildCodeLanguage(path, 'ordinary text'), null, path);
  }
});

test('web, backend and configuration grammars produce colored tokens without changing source text', async () => {
  for (const [path, source] of [
    ['main.ts', 'const greeting: string = "hello"; // a comment\n'],
    ['App.tsx', 'export const App = () => <div className="app">Hello</div>;'],
    ['App.jsx', 'export const App = () => <div>Hello</div>;'],
    ['main.py', 'def greet(name):\n\treturn "hello " + name\n'],
    ['main.go', 'package main\nfunc main() { println("hello") }'],
    ['main.rs', 'fn main() { println!("hello"); }'],
    ['main.java', 'class Main { String greeting = "hello"; }'],
    ['main.cpp', '#include <iostream>\nint main() { return 0; }'],
    ['main.rb', 'def greet(name)\n  "hello #{name}"\nend'],
    ['main.php', '<?php echo "hello";'],
    ['main.swift', 'let greeting: String = "hello"'],
    ['index.html', '<script>const greeting = "hello";</script>'],
    ['styles.css', '.app { color: red; }'],
    ['App.vue', '<script setup lang="ts">const n = 1;</script><template><div>{{ n }}</div></template>'],
    ['App.svelte', '<script>let count = 0;</script><button>{count}</button>'],
    ['index.astro', '---\nconst name = "hello";\n---\n<h1>{name}</h1>'],
    ['package.json', '{"name": "hello", "private": true}'],
    ['tsconfig.json', '{\n // a comment\n "compilerOptions": {}\n}'],
    ['config.yaml', 'name: hello\nenabled: true'],
    ['Cargo.toml', '[package]\nname = "hello"'],
    ['README.md', '# Hello\n\nA **bold** word.'],
    ['Dockerfile', 'FROM node:22\nRUN npm install'],
    ['Makefile', 'build:\n\tnpm run build'],
    ['script.sh', '#!/bin/bash\necho "hello"'],
    ['query.sql', 'SELECT name FROM users WHERE active = true;'],
    ['query.graphql', 'query { user(id: "1") { name } }'],
  ]) {
    const tokens = await buildCodeTokens(path, source);
    assert.ok(tokens, path);
    assert.equal(tokens.map(line => line.map(token => token.content).join('')).join('\n'), source, path);
    assert.ok(new Set(tokens.flat().map(token => token.color)).size > 1, path);
  }
});

test('empty, unknown, unusually large and obsolete files keep the plain-text fallback', async () => {
  for (const [path, source] of [
    ['empty.ts', ''], ['notes.txt', 'some notes'], ['large.ts', 'a\n'.repeat(50_001)],
    ['many-lines.ts', '\n'.repeat(2_000)], ['minified.js', 'x'.repeat(2_001)],
  ]) assert.equal(await buildCodeTokens(path, source), null, path);
  assert.equal(await buildCodeTokens('main.ts', 'const x = 1;', () => false), null);
  let checks = 0;
  assert.equal(await buildCodeTokens('main.ts', 'const x = 1;', () => ++checks < 3), null);
  assert.equal(checks, 3, 'navigation during language loading prevents tokenization');
});

test('rendering preserves whitespace and line endings and treats HTML as literal source', async t => {
  const children: Array<{ textContent: string; style: Record<string, string> } | string> = [];
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createDocumentFragment: () => ({ append: (node: typeof children[number]) => children.push(node) }),
    createElement: () => ({ textContent: '', style: {} }),
  } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'document', original); else Reflect.deleteProperty(globalThis, 'document'); });
  const source = '\ufeff<script>alert("source")</script>\r\n\t<div title="&amp;">hello</div>\r\n\r\n';
  const tokens = await buildCodeTokens('index.html', source);
  assert.ok(tokens);
  buildCodeFragment(source, tokens);
  assert.equal(children.map(node => typeof node === 'string' ? node : node.textContent).join(''), source);
  assert.ok(children.some(node => typeof node !== 'string' && node.style.color));
});
