import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';

const fixtureOAuth = overrides => ({
  getOAuthConfig: (provider, env, redirectUri) => ({ provider, available: Boolean(env.TEST_CONFIGURED), redirectUri }),
  createAuthorization: (provider, config, { state, verifier }) => `https://example.invalid/auth?state=${state}&code_challenge=${verifier}`,
  exchangeCode: async () => ({ accessToken: 'SYNTHETIC_TOKEN', refreshToken: 'SYNTHETIC_REFRESH', expiresAt: Date.now() + 3600_000 }),
  refreshToken: async () => ({ accessToken: 'REFRESHED_SYNTHETIC', refreshToken: 'SYNTHETIC_REFRESH', expiresAt: Date.now() + 3600_000 }),
  ...overrides,
});
async function setup(t, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'driveone-server-'));
  const app = await createApp({ port: 0, downloadDir: dir, env: {}, oauthImpl: fixtureOAuth(), ...options });
  await app.listen();
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  const response = await fetch(app.origin + '/api/session');
  const session = await response.json();
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const api = async (route, body, extra = {}) => {
    const result = await fetch(app.origin + route, { method: body === undefined ? 'GET' : 'POST', headers: { cookie, ...(body === undefined ? {} : { origin: app.origin, 'content-type': 'application/json', 'x-csrf-token': session.csrf }), ...extra.headers }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    return { status: result.status, data: result.headers.get('content-type')?.includes('json') ? await result.json() : null, response: result };
  };
  return { app, dir, session, cookie, api };
}
async function connect(api, provider = 'onedrive') {
  const start = await api('/api/auth/start', { provider });
  assert.equal(start.status, 200);
  const state = new URL(start.data.url).searchParams.get('state');
  return { state, result: await api(`/oauth/callback/${provider}?state=${state}&code=synthetic`) };
}

test('bootstrap defaults live with all accounts disconnected and secrets absent', async t => {
  const { session, api } = await setup(t);
  assert.equal(session.mode, 'live'); assert.equal(session.providers.length, 6);
  assert.ok(session.providers.every(p => !p.connected));
  assert.equal((await api('/api/files?provider=onedrive')).status, 401);
  assert.equal((await api('/api/auth/start', { provider: 'baidu' })).status, 409);
  assert.equal((await api('/api/auth/start', { provider: 'onedrive' })).status, 409);
});

test('Host, Origin, fetch metadata, CSRF, methods and duplicate queries are guarded', async t => {
  const { app, api } = await setup(t);
  assert.equal((await api('/api/mode', { mode: 'demo' }, { headers: { origin: 'https://evil.invalid' } })).status, 403);
  assert.equal((await api('/api/mode', { mode: 'demo' }, { headers: { 'x-csrf-token': 'invalid' } })).status, 403);
  assert.equal((await api('/api/session', undefined, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await api('/api/files?provider=onedrive&provider=dropbox')).status, 400);
  const status = await new Promise((resolve, reject) => {
    const req = http.get(app.origin + '/api/session', { headers: { host: 'evil.invalid' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject);
  });
  assert.equal(status, 403);
  assert.equal((await fetch(app.origin + '/api/session', { method: 'DELETE' })).status, 401);
});

test('JSON body size and wrong content type are rejected', async t => {
  const { api } = await setup(t);
  assert.equal((await api('/api/mode', { mode: 'demo' }, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await api('/api/mode', { mode: 'x'.repeat(17_000) })).status, 413);
});

test('demo lists, paginates, searches and writes only synthetic downloads', async t => {
  const { app, api, dir } = await setup(t);
  assert.equal((await api('/api/mode', { mode: 'demo' })).status, 200);
  const first = await api('/api/files?provider=baidu&folderId=root');
  assert.equal(first.status, 200); assert.equal(first.data.items.length, 15); assert.ok(first.data.nextCursor);
  const next = await api('/api/files?provider=baidu&cursor=' + encodeURIComponent(first.data.nextCursor));
  assert.ok(next.data.items.length > 0);
  assert.ok(!next.data.items.some(f => first.data.items.some(g => f.id === g.id)));
  const search = await api('/api/search?provider=alipan&query=' + encodeURIComponent('项目'));
  assert.ok(search.data.items.some(f => f.id === 'roadmap'));
  assert.equal((await api('/api/auth/start', { provider: 'onedrive' })).status, 409);
  const task = await api('/api/downloads', { provider: 'quark', fileId: 'readme' });
  assert.equal(task.status, 202); await app.downloads.idle();
  assert.equal((await api('/api/downloads')).data.tasks[0].status, 'complete');
  assert.equal((await readdir(dir)).length, 1);
  assert.equal((await api('/api/downloads', { provider: 'quark', fileId: 'work' })).status, 409);
});

test('OAuth state is cookie-bound, one-use, and denial consumes it', async t => {
  const { app, api } = await setup(t, { env: { TEST_CONFIGURED: '1' } });
  const { state, result } = await connect(api);
  assert.equal(result.status, 303); assert.equal(result.response.headers.get('location'), '/?auth=connected');
  assert.equal((await api('/oauth/callback/onedrive?state=' + state + '&code=replay')).status, 400);
  assert.equal((await api('/api/session')).data.providers.find(p => p.id === 'onedrive').connected, true);
  assert.ok(!JSON.stringify((await api('/api/session')).data).includes('SYNTHETIC'));
  await api('/api/disconnect', { provider: 'onedrive' });
  const started = await api('/api/auth/start', { provider: 'onedrive' });
  const nextState = new URL(started.data.url).searchParams.get('state');
  const foreign = await fetch(`${app.origin}/oauth/callback/onedrive?state=${nextState}&code=other`, { redirect: 'manual' });
  assert.equal(foreign.status, 401);
  assert.equal((await api(`/oauth/callback/onedrive?state=${nextState}&error=access_denied`)).status, 303);
  assert.equal((await api(`/oauth/callback/onedrive?state=${nextState}&code=retry`)).status, 400);
});

test('disconnect while OAuth exchange is pending cannot resurrect account', async t => {
  let release; let entered;
  const ready = new Promise(r => { entered = r; });
  const pending = new Promise(r => { release = r; });
  const { api } = await setup(t, { env: { TEST_CONFIGURED: '1' }, oauthImpl: fixtureOAuth({ exchangeCode: async () => { entered(); await pending; return { accessToken: 'SYNTHETIC', expiresAt: Date.now() + 3600_000 }; } }) });
  const started = await api('/api/auth/start', { provider: 'onedrive' });
  const state = new URL(started.data.url).searchParams.get('state');
  const callback = api(`/oauth/callback/onedrive?state=${state}&code=x`);
  await ready;
  assert.equal((await api('/api/session')).data.providers.find(p => p.id === 'onedrive').connected, false);
  await api('/api/disconnect', { provider: 'onedrive' }); release();
  assert.equal((await callback).response.headers.get('location'), '/?auth=error');
  assert.equal((await api('/api/session')).data.providers.find(p => p.id === 'onedrive').connected, false);
});

test('refresh failure drops account without leaking errors', async t => {
  const { api } = await setup(t, { env: { TEST_CONFIGURED: '1' }, oauthImpl: fixtureOAuth({
    exchangeCode: async () => ({ accessToken: 'SYNTHETIC', refreshToken: 'SYNTHETIC', expiresAt: 1 }),
    refreshToken: async () => { throw new Error('VERY_PRIVATE_TOKEN'); },
  }) });
  await connect(api);
  const listing = await api('/api/files?provider=onedrive');
  assert.equal(listing.status, 401); assert.equal(listing.data.error.code, 'RECONNECT_REQUIRED');
  assert.ok(!JSON.stringify(listing.data).includes('VERY_PRIVATE_TOKEN'));
  assert.equal((await api('/api/session')).data.providers.find(p => p.id === 'onedrive').connected, false);
});

test('provider listing aborted by navigation and mode switch cannot expose stale success', async t => {
  let release; let entered;
  const ready = new Promise(r => { entered = r; }); const pending = new Promise(r => { release = r; });
  const { api } = await setup(t, { env: { TEST_CONFIGURED: '1' }, providerFactory: () => ({ list: async () => { entered(); await pending; return { items: [{ id: 'private' }], nextCursor: null }; } }) });
  await connect(api);
  const listing = api('/api/files?provider=onedrive'); await ready;
  await api('/api/mode', { mode: 'demo' }); release();
  const result = await listing; assert.equal(result.status, 409); assert.ok(!JSON.stringify(result.data).includes('private'));
});

test('expiry removes in-memory accounts and invalidates session', async t => {
  let clock = Date.now();
  const { api } = await setup(t, { now: () => clock });
  clock += 9 * 60 * 60 * 1000;
  assert.equal((await api('/api/downloads')).status, 401);
});

test('mode switch during OAuth exchange prevents late account connection', async t => {
  let release; let entered; const ready = new Promise(r => { entered = r; }); const pending = new Promise(r => { release = r; });
  const { api } = await setup(t, { env: { TEST_CONFIGURED: '1' }, oauthImpl: fixtureOAuth({ exchangeCode: async () => { entered(); await pending; return { accessToken: 'SYNTHETIC', expiresAt: Date.now() + 3600_000 }; } }) });
  const started = await api('/api/auth/start', { provider: 'onedrive' });
  const state = new URL(started.data.url).searchParams.get('state');
  const callback = api(`/oauth/callback/onedrive?state=${state}&code=x`); await ready;
  await api('/api/mode', { mode: 'demo' }); release();
  assert.equal((await callback).response.headers.get('location'), '/?auth=error');
  assert.equal((await api('/api/session')).data.providers.find(p => p.id === 'onedrive').connected, false);
});

test('disconnect aborts active download and cleans its temporary file', async t => {
  let entered; const ready = new Promise(r => { entered = r; });
  const { app, api, dir } = await setup(t, { env: { TEST_CONFIGURED: '1' }, providerFactory: () => ({
    stat: async () => ({ id: 'fixture', name: 'fixture.txt', kind: 'file', downloadable: true }),
    download: async () => ({ response: new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2])); entered(); } })) }),
  }) });
  await connect(api);
  assert.equal((await api('/api/downloads', { provider: 'onedrive', fileId: 'fixture' })).status, 202);
  await ready; await api('/api/disconnect', { provider: 'onedrive' }); await app.downloads.idle();
  assert.equal((await api('/api/downloads')).data.tasks[0].status, 'cancelled');
  assert.deepEqual(await readdir(dir), []);
});

test('disconnect during refresh cannot restore tokens', async t => {
  let entered; let release; const ready = new Promise(r => { entered = r; }); const pending = new Promise(r => { release = r; });
  const { api } = await setup(t, { env: { TEST_CONFIGURED: '1' }, oauthImpl: fixtureOAuth({
    exchangeCode: async () => ({ accessToken: 'SYNTHETIC', refreshToken: 'SYNTHETIC', expiresAt: 1 }),
    refreshToken: async () => { entered(); await pending; return { accessToken: 'LATE_TOKEN', refreshToken: 'SYNTHETIC', expiresAt: Date.now() + 3600_000 }; },
  }) });
  await connect(api);
  const request = api('/api/files?provider=onedrive'); await ready;
  await api('/api/disconnect', { provider: 'onedrive' }); release();
  assert.equal((await request).status, 401);
  assert.equal((await api('/api/session')).data.providers.find(p => p.id === 'onedrive').connected, false);
});

test('concurrent metadata requests share one token refresh', async t => {
  let refreshes = 0;
  const { api } = await setup(t, { env: { TEST_CONFIGURED: '1' }, oauthImpl: fixtureOAuth({
    exchangeCode: async () => ({ accessToken: 'SYNTHETIC', refreshToken: 'SYNTHETIC', expiresAt: 1 }),
    refreshToken: async () => { refreshes++; await new Promise(r => setTimeout(r, 25)); return { accessToken: 'NEW_SYNTHETIC', refreshToken: 'SYNTHETIC', expiresAt: Date.now() + 3600_000 }; },
  }), providerFactory: () => ({ list: async () => ({ items: [], nextCursor: null }) }) });
  await connect(api);
  const result = await Promise.all([api('/api/files?provider=onedrive'), api('/api/files?provider=onedrive')]);
  assert.ok(result.every(r => r.status === 200)); assert.equal(refreshes, 1);
});

test('Google document downloads require an allowed explicit export format', async t => {
  const { app, api, dir } = await setup(t, { env: { TEST_CONFIGURED: '1' }, providerFactory: () => ({
    stat: async () => ({ id: 'native', name: 'synthetic.pdf', kind: 'file', downloadable: true, exportFormats: [{ id: 'pdf', extension: '.pdf', mimeType: 'application/pdf' }] }),
    download: async () => ({ response: new Response('not a real PDF; test only') }),
  }) });
  await connect(api, 'googledrive');
  assert.equal((await api('/api/downloads', { provider: 'googledrive', fileId: 'native' })).status, 400);
  assert.equal((await api('/api/downloads', { provider: 'googledrive', fileId: 'native', exportFormat: 'https://evil.invalid' })).status, 400);
  assert.equal((await api('/api/downloads', { provider: 'googledrive', fileId: 'native', exportFormat: 'pdf' })).status, 202);
  await app.downloads.idle(); assert.deepEqual(await readdir(dir), ['synthetic.pdf']);
});

test('OAuth expiry and duplicate callback parameters are rejected', async t => {
  let clock = Date.now(); const { api } = await setup(t, { env: { TEST_CONFIGURED: '1' }, now: () => clock });
  const started = await api('/api/auth/start', { provider: 'onedrive' }); const state = new URL(started.data.url).searchParams.get('state');
  assert.equal((await api(`/oauth/callback/onedrive?state=${state}&state=${state}&code=x`)).status, 400);
  clock += 11 * 60 * 1000;
  assert.equal((await api(`/oauth/callback/onedrive?state=${state}&code=x`)).status, 400);
  assert.equal((await api(`/oauth/callback/onedrive?state=${state}&code=x`)).status, 400);
});

test('provider-safe error status survives the error boundary', async t => {
  const { api } = await setup(t, { env: { TEST_CONFIGURED: '1' }, providerFactory: () => ({ list: async () => { const error = new Error('Rate limited.'); error.code = 'rate_limited'; error.status = 429; throw error; } }) });
  await connect(api); const response = await api('/api/files?provider=onedrive');
  assert.equal(response.status, 429); assert.equal(response.data.error.code, 'RATE_LIMITED');
});

test('regular polling does not extend the eight-hour absolute session lifetime', async t => {
  let clock = Date.now(); const { api } = await setup(t, { now: () => clock });
  for (let hour = 1; hour < 8; hour++) {
    clock += 60 * 60 * 1000;
    assert.equal((await api('/api/downloads')).status, 200);
  }
  clock += 60 * 60 * 1000;
  assert.equal((await api('/api/downloads')).status, 401);
});

test('static UI is served with strict security headers and source files are not exposed', async t => {
  const { app } = await setup(t);
  for (const route of ['/', '/app.js', '/styles.css']) {
    const response = await fetch(app.origin + route);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.ok((await response.text()).length > 100);
  }
  for (const route of ['/src/oauth.js', '/.env', '/package.json', '/downloads/private.txt']) {
    assert.equal((await fetch(app.origin + route)).status, 404);
  }
});
