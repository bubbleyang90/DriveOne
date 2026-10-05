import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const roots = ['src', 'public', 'scripts', 'test'];
let count = 0;
for (const root of roots) {
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(m?js)$/.test(entry.name)) continue;
    const file = path.join(entry.parentPath ?? entry.path, entry.name);
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
    count++;
  }
}
const html = await readFile('public/index.html', 'utf8');
if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html) || /\bon[a-z]+=/i.test(html)) {
  throw new Error('Inline scripts or event handlers are not permitted');
}
console.log(`Syntax and CSP checks passed (${count} JavaScript files)`);
