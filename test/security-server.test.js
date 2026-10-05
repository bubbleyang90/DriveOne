// Independent regression audit. All credentials and files are synthetic.
// Network use is limited to ephemeral loopback HTTP fixtures; no provider network access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../src/server.js';
import { ProviderError } from '../src/providers.js';

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const syntheticTokens = () => ({ accessToken: 'SYNTHETIC_ACCESS_SENTINEL', refreshToken: 'SYNTHETIC_REFRESH_SENTINEL', expiresAt: Date.now() + 3600000 });
async function withApp(fn, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'driveone-server-audit-'));
  const auth = [];
  let exchanges = 0;
  let currentTime = Date.now();
  const oauthImpl = {
    getOAuthConfig(provider, env, redirectUri) { return { provider, redirectUri, available: true }; },
    createAuthorization(provider, cfg, values) { auth.push({ provider, cfg, ...values }); return `https://authorization.example.test/?state=${values.state}`; },
    async exchangeCode(provider, cfg, params) { exchanges++; return options.exchangeCode ? options.exchangeCode(provider, cfg, params) : syntheticTokens(); },
    async refreshToken() { return syntheticTokens(); },
  };
  const file = { id: 'file-1', name: 'synthetic.txt', kind: 'file', downloadable: true, size: 4 };
  const providerFactory = options.providerFactory || (() => ({
    async list() { return { items: [file], nextCursor: null }; },
    async search() { return { items: [file], nextCursor: null }; },
    async stat() { return file; },
    async download() { return { response: new Response('test'), fileName: file.name }; },
  }));
  const app = await createApp({ port: 0, env: {}, downloadDir: root, oauthImpl, providerFactory, fetchImpl: async () => { throw new Error('NO_LIVE_NETWORK_AUTHORIZED'); }, now: () => currentTime });
  await app.listen();
  async function request(route, { method = 'GET', cookie, csrf, headers = {}, body, raw } = {}) {
    const url = new URL(route, app.origin);
    assert.equal(url.origin, app.origin);
    const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
    const hdr = { ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { Origin: app.origin, 'X-CSRF-Token': csrf } : {}), ...(payload !== undefined ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers };
    return new Promise((resolve, reject) => {
      const req = http.request(url, { method, headers: hdr }, res => {
        const parts = [];
        res.on('data', part => parts.push(part));
        res.on('end', () => { const text = Buffer.concat(parts).toString(); let data; try { data = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, text, data }); });
      });
      req.on('error', reject);
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }
  async function session() {
    const response = await request('/api/session');
    assert.equal(response.status, 200);
    return { cookie: response.headers['set-cookie'][0].split(';')[0], csrf: response.data.csrf, initial: response };
  }
  const start = async (s, provider = 'onedrive') => {
    const response = await request('/api/auth/start', { method: 'POST', ...s, body: { provider } });
    assert.equal(response.status, 200, response.text);
    return auth.at(-1);
  };
  const callback = (s, record, suffix = '&code=SYNTHETIC_CODE') => request(`/oauth/callback/${record.provider}?state=${record.state}${suffix}`, { cookie: s.cookie });
  try { await fn({ app, root, request, session, start, callback, auth, exchanges: () => exchanges, setTime: t => { currentTime = t; }, now: () => currentTime }); }
  finally { await app.close(); await rm(root, { recursive: true, force: true }); }
}

test('host, origin, fetch-site, CSRF and method gates reject hostile requests', async () => withApp(async ({ request, session }) => {
  const s = await session();
  assert.match(s.initial.headers['set-cookie'][0], /HttpOnly; SameSite=Lax/);
  assert.equal((await request('/api/session', { headers: { Host: 'evil.example.test' } })).status, 403);
  assert.equal((await request('/api/session', { headers: { Origin: 'https://evil.example.test' } })).status, 403);
  assert.equal((await request('/api/session', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await request('/api/mode', { method: 'POST', cookie: s.cookie, body: { mode: 'demo' } })).status, 403);
  assert.equal((await request('/api/mode', { method: 'POST', ...s, headers: { 'X-CSRF-Token': 'bad' }, body: { mode: 'demo' } })).status, 403);
  assert.equal((await request('/api/mode', { method: 'POST', ...s, headers: { Origin: 'https://evil.example.test' }, body: { mode: 'demo' } })).status, 403);
  assert.equal((await request('/api/mode', { method: 'PUT', ...s, body: { mode: 'demo' } })).status, 405);
  assert.equal((await request('/api/mode', { method: 'POST', ...s, body: { mode: 'demo' } })).status, 200);
}));

test('OAuth state is provider/session bound and single use with a server-only verifier', async () => withApp(async ({ session, start, callback, request, exchanges }) => {
  const alice = await session(); const bob = await session();
  const auth = await start(alice);
  assert.equal(auth.state.length, 43); assert.equal(auth.verifier.length, 43);
  assert.notEqual(auth.state, auth.verifier);
  assert.equal((await callback(bob, auth)).status, 400);
  assert.equal((await request(`/oauth/callback/dropbox?state=${auth.state}&code=X`, { cookie: alice.cookie })).status, 400);
  assert.equal(exchanges(), 0);
  const result = await callback(alice, auth);
  assert.equal(result.status, 303); assert.equal(result.headers.location, '/?auth=connected');
  assert.equal((await callback(alice, auth)).status, 400);
  assert.equal(exchanges(), 1);
  const state = await request('/api/session', { cookie: alice.cookie });
  assert.ok(state.data.providers.find(p => p.id === 'onedrive').connected);
  const all = JSON.stringify([state, result]);
  assert.ok(!all.includes('SYNTHETIC_ACCESS_SENTINEL'));
  assert.ok(!all.includes('SYNTHETIC_REFRESH_SENTINEL'));
  assert.ok(!all.includes(auth.verifier));
}));

test('OAuth denial, expiry and malformed duplicate callbacks never exchange tokens', async () => withApp(async ({ session, start, callback, request, exchanges, setTime, now }) => {
  const s = await session();
  const first = await start(s);
  assert.equal((await callback(s, first, '&error=access_denied&error_description=SYNTHETIC_SECRET')).headers.location, '/?auth=cancelled');
  assert.equal((await callback(s, first)).status, 400);
  const second = await start(s);
  assert.equal((await callback(s, second, '&code=A&code=B')).status, 400);
  assert.equal((await request(`/oauth/callback/onedrive?state=${second.state}&state=${second.state}&code=A`, { cookie: s.cookie })).status, 400);
  setTime(now() + 600001);
  assert.equal((await callback(s, second)).status, 400);
  assert.equal((await callback(s, second)).status, 400);
  assert.equal(exchanges(), 0);
}));

test('disconnect during OAuth exchange prevents stale account resurrection', async () => {
  const entered = deferred(); const release = deferred();
  await withApp(async ({ session, start, callback, request }) => {
    const s = await session(); const auth = await start(s);
    const pending = callback(s, auth); await entered.promise;
    await request('/api/disconnect', { method: 'POST', ...s, body: { provider: 'onedrive' } });
    release.resolve();
    assert.equal((await pending).headers.location, '/?auth=error');
    const state = await request('/api/session', { cookie: s.cookie });
    assert.equal(state.data.providers.find(p => p.id === 'onedrive').connected, false);
  }, { exchangeCode: async () => { entered.resolve(); await release.promise; return syntheticTokens(); } });
});

test('pending OAuth exchange is not exposed as a connected account', async () => {
  const entered = deferred(); const release = deferred();
  await withApp(async ({ session, start, callback, request }) => {
    const s = await session(); const auth = await start(s);
    const pending = callback(s, auth); await entered.promise;
    const state = await request('/api/session', { cookie: s.cookie });
    const files = await request('/api/files?provider=onedrive', { cookie: s.cookie });
    release.resolve(); await pending;
    assert.equal(state.data.providers.find(p => p.id === 'onedrive').connected, false);
    assert.notEqual(files.status, 500, 'pending authorization should have an intentional recoverable response');
  }, { exchangeCode: async () => { entered.resolve(); await release.promise; return syntheticTokens(); } });
});

test('mode switch invalidates a pending OAuth exchange', async () => {
  const entered = deferred(); const release = deferred();
  await withApp(async ({ session, start, callback, request }) => {
    const s = await session(); const auth = await start(s);
    const pending = callback(s, auth); await entered.promise;
    await request('/api/mode', { method: 'POST', ...s, body: { mode: 'demo' } });
    release.resolve();
    const result = await pending;
    const state = await request('/api/session', { cookie: s.cookie });
    assert.notEqual(result.headers.location, '/?auth=connected');
    assert.equal(state.data.providers.find(p => p.id === 'onedrive').connected, false);
  }, { exchangeCode: async () => { entered.resolve(); await release.promise; return syntheticTokens(); } });
});

test('hostile same-length Unicode state is rejected as a client error', async () => withApp(async ({ session, start, request }) => {
  const s = await session(); await start(s);
  const state = encodeURIComponent('界'.repeat(43));
  const response = await request(`/oauth/callback/onedrive?state=${state}&code=X`, { cookie: s.cookie });
  assert.equal(response.status, 400);
}));

test('provider auth errors preserve safe status and disconnect only that account', async () => withApp(async ({ session, start, callback, request }) => {
  const s = await session(); await callback(s, await start(s));
  const response = await request('/api/files?provider=onedrive', { cookie: s.cookie });
  assert.equal(response.status, 401);
  const state = await request('/api/session', { cookie: s.cookie });
  assert.equal(state.data.providers.find(p => p.id === 'onedrive').connected, false);
}, { providerFactory: () => ({ async list() { throw new ProviderError('authentication_required', 401, 'Reconnect this provider.'); } }) }));

test('demo mode stays explicit and unavailable providers cannot start live OAuth', async () => withApp(async ({ session, request }) => {
  const s = await session();
  for (const provider of ['baidu', 'alipan', 'quark']) assert.equal((await request('/api/auth/start', { method: 'POST', ...s, body: { provider } })).status, 409);
  const response = await request('/api/mode', { method: 'POST', ...s, body: { mode: 'demo' } });
  assert.equal(response.data.mode, 'demo'); assert.ok(response.data.providers.every(p => p.demo && !p.connected));
  const files = await request('/api/files?provider=quark', { cookie: s.cookie });
  assert.equal(files.status, 200);
  assert.equal((await request('/api/auth/start', { method: 'POST', ...s, body: { provider: 'onedrive' } })).status, 409);
}));

test('export filename does not repeat an already matching extension', async () => withApp(async ({ session, start, callback, request, app, root }) => {
  const s = await session(); await callback(s, await start(s, 'googledrive'));
  const result = await request('/api/downloads', { method: 'POST', ...s, body: { provider: 'googledrive', fileId: 'doc', exportFormat: 'pdf' } });
  assert.equal(result.status, 202);
  await app.downloads.idle();
  const files = await readdir(root);
  assert.deepEqual(files, ['report.pdf']);
  assert.equal(await readFile(path.join(root, 'report.pdf'), 'utf8'), 'test');
}, { providerFactory: () => ({
  async stat() { return { id: 'doc', name: 'report.pdf', kind: 'file', downloadable: true, exportFormats: [{ id: 'pdf', extension: '.pdf' }] }; },
  async download() { return { response: new Response('test'), fileName: 'report.pdf' }; },
}) }));
