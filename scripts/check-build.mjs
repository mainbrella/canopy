import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function checkBuild(target, directory = target === 'builder' ? 'dist-builder' : 'dist') {
  assert.ok(target === 'site' || target === 'builder', 'Specify site or builder');
  const manifest = JSON.parse(await readFile(resolve(directory, '.vite/manifest.json'), 'utf8'));
  const entries = Object.keys(manifest).filter(key => manifest[key].isEntry);
  if (target === 'builder') {
    assert.deepEqual(entries, ['build/index.html'], 'Builder must have only its own entry point');
    const html = await readFile(resolve(directory, 'build/index.html'), 'utf8');
    for (const [tag] of html.matchAll(/<(?:script|img|link)\b[^>]*>/gi)) {
      if (tag.startsWith('<link') && !/rel="(?:stylesheet|modulepreload|icon)"/.test(tag)) continue;
      const url = tag.match(/(?:src|href)="([^"]+)"/)?.[1];
      assert.ok(url?.startsWith('/build/assets/'), `Builder resource belongs to another deployment: ${url}`);
      await access(resolve(directory, url.slice(1)));
    }
  } else {
    assert.ok(entries.includes('dashboard/index.html'), 'Site must include the dashboard');
    assert.ok(!entries.includes('build/index.html'), 'Site must not publish the builder');
    assert.ok(!Object.keys(manifest).some(key => key.includes('@shikijs/') || key.endsWith('/build-dashboard.ts')),
      'Site must not bundle the builder or its syntax grammars');
  }
  for (const chunk of Object.values(manifest)) {
    for (const file of [chunk.file, ...(chunk.css ?? []), ...(chunk.assets ?? [])]) {
      assert.ok(!file.includes('..') && !file.startsWith('/'), `Invalid asset path: ${file}`);
      assert.ok(target === 'builder' ? file.startsWith('build/assets/') : !file.startsWith('build/'),
        `Asset belongs to another deployment: ${file}`);
      await access(resolve(directory, file));
    }
    for (const key of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) {
      assert.ok(manifest[key], `Missing imported chunk: ${key}`);
    }
  }
  console.log(`Verified ${target}: ${entries.length} entries, ${Object.keys(manifest).length} assets/chunks`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await checkBuild(process.argv[2]);
}
