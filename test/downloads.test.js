import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDownloadManager, safeFileName } from '../src/downloads.js';
async function setup(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'driveone-test-'));
  const manager = await createDownloadManager({ directory, ...options });
  t.after(async () => { await manager.close(); await rm(directory, { recursive: true, force: true }); });
  return { manager, directory };
}
const run = async () => ({ response: new Response('synthetic', { headers: { 'content-length': '9' } }) });

test('safe filenames handle traversal, Windows reserved names and multibyte limits', () => {
  for (const input of ['../bad', '..\\bad', 'CON.txt', 'PRN', 'LPT1.txt', 'COM¹.txt', 'LPT².log', 'NUL', '<a>:"x|?*. ', '', '.', '\u0000']) {
    const name = safeFileName(input);
    assert.ok(name.length > 0); assert.ok(!/[<>:"/\\|?*\x00-\x1f]/.test(name));
    assert.ok(!/[. ]$/.test(name)); assert.ok(!/^(CON|NUL|PRN|LPT1|COM¹|LPT²)(\.|$)/i.test(name));
  }
  assert.ok(Buffer.byteLength(safeFileName('项目'.repeat(200) + '.txt')) <= 180);
});

test('concurrent downloads never overwrite existing names', async t => {
  const { manager, directory } = await setup(t);
  await writeFile(path.join(directory, 'hello.txt'), 'existing');
  manager.add({ owner: 'a', provider: 'demo', name: 'hello.txt', run });
  manager.add({ owner: 'a', provider: 'demo', name: 'hello.txt', run });
  await manager.idle();
  assert.deepEqual(manager.list('a').map(t => t.status), ['complete', 'complete']);
  assert.equal(await readFile(path.join(directory, 'hello.txt'), 'utf8'), 'existing');
  assert.equal(await readFile(path.join(directory, 'hello (1).txt'), 'utf8'), 'synthetic');
  assert.equal(await readFile(path.join(directory, 'hello (2).txt'), 'utf8'), 'synthetic');
  assert.ok(!(await readdir(directory)).some(n => n.endsWith('.part')));
});

test('size limit and truncated responses leave no partial files', async t => {
  const { manager, directory } = await setup(t, { maxBytes: 12 });
  manager.add({ owner: 'a', provider: 'demo', name: 'large.txt', run: async () => ({ response: new Response('x', { headers: { 'content-length': '100' } }) }) });
  manager.add({ owner: 'a', provider: 'demo', name: 'short.txt', run: async () => ({ response: new Response('x', { headers: { 'content-length': '12' } }) }) });
  manager.add({ owner: 'a', provider: 'demo', name: 'unbounded.txt', run: async () => ({ response: new Response('x'.repeat(20)) }) });
  await manager.idle();
  assert.ok(manager.list('a').every(t => t.status === 'error'));
  assert.deepEqual(await readdir(directory), []);
});

test('cancel aborts active streams and queued tasks, isolated by owner', async t => {
  const { manager, directory } = await setup(t, { concurrency: 1 });
  let entered; const ready = new Promise(resolve => { entered = resolve; });
  const first = manager.add({ owner: 'a', provider: 'demo', name: 'slow.txt', run: async () => ({ response: new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); entered(); } })) }) });
  const second = manager.add({ owner: 'a', provider: 'demo', name: 'queued.txt', run });
  await ready;
  assert.throws(() => manager.cancel('b', first.id), { code: 'NOT_FOUND' });
  manager.cancel('a', second.id); manager.cancel('a', first.id);
  await manager.idle();
  assert.deepEqual(manager.list('a').map(t => t.status), ['cancelled', 'cancelled']);
  assert.deepEqual(manager.list('b'), []);
  assert.deepEqual(await readdir(directory), []);
});

test('provider errors never leak underlying URL or bearer secrets', async t => {
  const { manager } = await setup(t);
  manager.add({ owner: 'a', provider: 'demo', name: 'x.txt', run: async () => { throw new Error('https://secret.example?access_token=DO_NOT_LOG'); } });
  await manager.idle();
  assert.equal(manager.list('a')[0].status, 'error');
  assert.ok(!JSON.stringify(manager.list('a')).includes('DO_NOT_LOG'));
});

test('download directory symlink is rejected', async t => {
  const { directory } = await setup(t);
  const linkPath = directory + '-link';
  t.after(() => rm(linkPath, { force: true, recursive: true }));
  try { await symlink(directory, linkPath, 'junction'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('This Windows account cannot create symlinks'); return; } throw error; }
  await assert.rejects(createDownloadManager({ directory: linkPath }), /symlink/);
});

test('oversize response body is cancelled even before reading', async t => {
  const { manager } = await setup(t, { maxBytes: 2 });
  let cancelled = false;
  manager.add({ owner: 'a', provider: 'demo', name: 'too-large.txt', run: async () => ({ response: new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-length': '3' } }) }) });
  await manager.idle(); assert.equal(cancelled, true);
});

test('encoded Content-Length is not mistaken for decoded stream length', async t => {
  const { manager, directory } = await setup(t);
  manager.add({ owner: 'a', provider: 'demo', name: 'decoded.txt', run: async () => ({ response: new Response('decoded bytes', { headers: { 'content-encoding': 'gzip', 'content-length': '25' } }) }) });
  await manager.idle();
  assert.equal(manager.list('a')[0].status, 'complete');
  assert.equal(manager.list('a')[0].totalBytes, null);
  assert.equal(await readFile(path.join(directory, 'decoded.txt'), 'utf8'), 'decoded bytes');
});
