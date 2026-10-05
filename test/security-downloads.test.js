// Independent regression audit. All credentials and files are synthetic.
// Network use is limited to ephemeral loopback HTTP fixtures; no provider network access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir, symlink, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDownloadManager, safeFileName } from '../src/downloads.js';

const bytes = text => new TextEncoder().encode(text);
async function withManager(fn, options = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'driveone-independent-'));
  const directory = path.join(base, 'downloads');
  const manager = await createDownloadManager({ directory, ...options });
  try { return await fn({ manager, directory, base }); }
  finally { await manager.close(); await rm(base, { recursive: true, force: true }); }
}
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
const ordinaryRun = text => async () => ({ response: new Response(text, { headers: { 'content-length': String(bytes(text).length) } }) });

test('untrusted names are single bounded safe path components', () => {
  for (const input of ['../../escape.txt', '/etc/passwd', '..\\..\\escape.txt', 'C:\\Windows\\bad', '.', '..', '', 'CON', 'com1.txt', 'NUL.txt', 'file. ', 'a\0b', 'x\ny', '界'.repeat(200) + '.txt']) {
    const name = safeFileName(input);
    assert.ok(name && name !== '.' && name !== '..');
    assert.equal(path.basename(name), name);
    assert.ok(!/[<>:"/\\|?*\x00-\x1f\x7f]/.test(name), name);
    assert.ok(!/[. ]$/.test(name), name);
    assert.ok(Buffer.byteLength(name) <= 180, name);
    assert.ok(!/^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i.test(name), name);
  }
});

test('existing files and final symlinks are not overwritten', async t => withManager(async ({ manager, directory, base }) => {
  await writeFile(path.join(directory, 'report.txt'), 'original');
  const target = path.join(base, 'outside.txt');
  await writeFile(target, 'outside');
  try { await symlink(target, path.join(directory, 'linked.txt'), 'file'); }
  catch (error) { if (process.platform === 'win32' && error.code === 'EPERM') { t.skip('This Windows account cannot create file symlinks'); return; } throw error; }
  manager.add({ owner: 'alice', provider: 'demo', name: 'report.txt', run: ordinaryRun('new') });
  manager.add({ owner: 'alice', provider: 'demo', name: 'linked.txt', run: ordinaryRun('replacement') });
  await manager.idle();
  assert.equal(await readFile(path.join(directory, 'report.txt'), 'utf8'), 'original');
  assert.equal(await readFile(target, 'utf8'), 'outside');
  assert.equal(await readFile(path.join(directory, 'report (1).txt'), 'utf8'), 'new');
  assert.equal(await readFile(path.join(directory, 'linked (1).txt'), 'utf8'), 'replacement');
  assert.ok(manager.list('alice').every(t => t.status === 'complete'));
}));

test('simultaneous same-name downloads each commit exactly once', async () => withManager(async ({ manager, directory }) => {
  for (let i = 0; i < 8; i++) manager.add({ owner: 'alice', provider: 'demo', name: '../same.txt', run: ordinaryRun(String(i)) });
  await manager.idle();
  const files = await readdir(directory);
  assert.equal(files.length, 8);
  assert.equal(new Set(await Promise.all(files.map(f => readFile(path.join(directory, f), 'utf8')))).size, 8);
  assert.ok(!files.some(f => f.endsWith('.part')));
}));

test('owner boundaries and cancellation remove partial data', async () => withManager(async ({ manager, directory }) => {
  const pulling = deferred();
  const blocked = deferred();
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(bytes('partial')); },
    async pull() { pulling.resolve(); await blocked.promise; },
    cancel() { cancelled = true; blocked.resolve(); },
  });
  const task = manager.add({ owner: 'alice', provider: 'demo', name: 'partial.txt', run: async () => ({ response: new Response(stream) }) });
  await pulling.promise;
  assert.deepEqual(manager.list('bob'), []);
  assert.throws(() => manager.cancel('bob', task.id), /不存在/);
  manager.cancelOwner('alice', 'demo');
  await manager.idle();
  assert.equal(manager.list('alice')[0].status, 'cancelled');
  assert.equal(cancelled, true);
  assert.deepEqual(await readdir(directory), []);
}));

test('incomplete and excessive streams never commit', async () => withManager(async ({ manager, directory }) => {
  manager.add({ owner: 'alice', provider: 'demo', name: 'short.txt', run: async () => ({ response: new Response('short', { headers: { 'content-length': '8' } }) }) });
  manager.add({ owner: 'alice', provider: 'demo', name: 'large.txt', run: ordinaryRun('12345678901') });
  await manager.idle();
  assert.ok(manager.list('alice').every(t => t.status === 'error'));
  assert.deepEqual(await readdir(directory), []);
}, { maxBytes: 10 }));

test('oversized advertised body is cancelled before a reader is acquired', async () => withManager(async ({ manager }) => {
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  const response = new Response(stream, { headers: { 'content-length': '11' } });
  manager.add({ owner: 'alice', provider: 'demo', name: 'large.txt', run: async () => ({ response }) });
  await manager.idle();
  try { assert.equal(cancelled, true, 'early size rejection must release response stream'); }
  finally { if (!stream.locked) await stream.cancel(); }
}, { maxBytes: 10 }));

test('response arriving after cancellation is immediately cancelled', async () => withManager(async ({ manager }) => {
  const entered = deferred();
  const release = deferred();
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  const response = new Response(stream);
  const task = manager.add({ owner: 'alice', provider: 'demo', name: 'stale.txt', run: async () => { entered.resolve(); await release.promise; return { response }; } });
  await entered.promise;
  manager.cancel('alice', task.id);
  release.resolve();
  await manager.idle();
  try { assert.equal(cancelled, true, 'late response must be released after cancellation'); }
  finally { if (!stream.locked) await stream.cancel(); }
}));

test('destination swapped to a symlink before download start is refused', async () => withManager(async ({ manager, directory, base }) => {
  const outside = path.join(base, 'outside');
  await import('node:fs/promises').then(fs => fs.mkdir(outside));
  await rename(directory, path.join(base, 'original'));
  await symlink(outside, directory, 'junction');
  manager.add({ owner: 'alice', provider: 'demo', name: 'safe.txt', run: ordinaryRun('contents') });
  await manager.idle();
  assert.equal(manager.list('alice')[0].status, 'error');
  assert.deepEqual(await readdir(outside), []);
}));

test('task errors do not expose low-level secrets or paths', async () => withManager(async ({ manager }) => {
  manager.add({ owner: 'alice', provider: 'demo', name: 'safe.txt', run: async () => { throw new Error('Bearer SYNTHETIC_SECRET /home/user/private.txt'); } });
  await manager.idle();
  const output = JSON.stringify(manager.list('alice'));
  assert.ok(!output.includes('SYNTHETIC_SECRET'));
  assert.ok(!output.includes('/home/user'));
  assert.ok(!output.includes('controller'));
  assert.ok(!output.includes('owner'));
}));

test('directory swapped while the provider responds is rechecked before writing', async () => withManager(async ({ manager, directory, base }) => {
  const outside = path.join(base, 'outside');
  await import('node:fs/promises').then(fs => fs.mkdir(outside));
  let createdOutside = false;
  manager.add({ owner: 'alice', provider: 'demo', name: 'safe.txt', run: async () => {
    await rename(directory, path.join(base, 'original'));
    await symlink(outside, directory, 'junction');
    const response = new Response('synthetic content');
    const originalGetReader = response.body.getReader.bind(response.body);
    response.body.getReader = () => {
      const reader = originalGetReader();
      const originalRead = reader.read.bind(reader);
      reader.read = async () => { createdOutside ||= (await readdir(outside)).some(f => f.endsWith('.part')); return originalRead(); };
      return reader;
    };
    return { response };
  } });
  await manager.idle();
  assert.equal(manager.list('alice')[0].status, 'error');
  assert.equal(createdOutside, false, 'temporary data was opened in the replacement symlink destination');
  assert.deepEqual(await readdir(outside), []);
}));

test('automatically decoded HTTP bodies use their decoded length', async () => withManager(async ({ manager, directory }) => {
  const http = await import('node:http');
  const { gzipSync } = await import('node:zlib');
  const contents = 'synthetic payload '.repeat(64);
  const compressed = gzipSync(contents);
  const fixture = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip', 'Content-Length': compressed.byteLength });
    res.end(compressed);
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${fixture.address().port}/synthetic`;
    manager.add({ owner: 'alice', provider: 'demo', name: 'compressed.txt', run: async signal => ({ response: await fetch(url, { signal }) }) });
    await manager.idle();
    assert.equal(manager.list('alice')[0].status, 'complete', 'fetch decodes gzip but preserves the compressed Content-Length header');
    assert.equal(await readFile(path.join(directory, 'compressed.txt'), 'utf8'), contents);
  } finally { await new Promise(resolve => { fixture.close(resolve); fixture.closeIdleConnections(); }); }
}));

test('unsolicited partial-content responses cannot be committed as complete files', async () => withManager(async ({ manager, directory }) => {
  manager.add({ owner: 'alice', provider: 'demo', name: 'truncated.txt', run: async () => ({ response: new Response('half', { status: 206, headers: { 'Content-Length': '4', 'Content-Range': 'bytes 0-3/8' } }) }) });
  await manager.idle();
  assert.equal(manager.list('alice')[0].status, 'error');
  assert.deepEqual(await readdir(directory), []);
}));
