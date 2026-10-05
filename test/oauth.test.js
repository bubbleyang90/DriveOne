import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getOAuthConfig, createAuthorization, exchangeCode, refreshToken } from '../src/oauth.js';
const env = { ONEDRIVE_CLIENT_ID: '11111111-2222-3333-4444-555555555555', GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com', DROPBOX_CLIENT_ID: 'test_app_key' };
const redirectUri = 'http://127.0.0.1:4173/auth/callback';
const verifier = 'x'.repeat(64); const state = 'random-test-state-1234567890';
const cfg = provider => getOAuthConfig(provider, env, redirectUri);
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
const codeError = code => error => error.code === code && typeof error.status === 'number';
function mock(response) { const calls = []; return { calls, fetchImpl: async (url, options) => { calls.push({ url, options }); return response; } }; }

test('configuration is unavailable without own IDs, pending providers never get OAuth endpoints', () => {
  for (const provider of ['onedrive', 'googledrive', 'dropbox']) {
    const missing = getOAuthConfig(provider, {}, redirectUri); assert.equal(missing.available, false);
    assert.throws(() => createAuthorization(provider, missing, { state, verifier }), codeError('oauth_not_configured'));
    assert.equal(cfg(provider).available, true); assert.equal(Object.isFrozen(cfg(provider)), true);
  }
  for (const provider of ['baidu', 'alipan', 'quark']) { const x = getOAuthConfig(provider, {}, redirectUri); assert.equal(x.available, false); assert.equal(x.tokenUrl, undefined); }
});
test('OAuth configuration validates client IDs, tenants, and loopback callback URLs', () => {
  for (const redirect of ['https://evil.example/callback', 'http://127.0.0.1.evil.example:4173/callback', 'http://127.0.0.1:4173/callback?next=evil', 'http://user:pass@localhost:4173/', 'http://localhost/', 'http://localhost:4173/#fragment', 'javascript:alert(1)']) assert.throws(() => getOAuthConfig('dropbox', env, redirect), codeError('invalid_oauth_config'));
  assert.equal(getOAuthConfig('dropbox', env, 'http://[::1]:4173/callback').available, true);
  assert.throws(() => getOAuthConfig('onedrive', { ...env, ONEDRIVE_TENANT: 'evil.example/../../' }, redirectUri), codeError('invalid_oauth_config'));
  assert.throws(() => getOAuthConfig('googledrive', { GOOGLE_CLIENT_ID: 'borrowed?!' }, redirectUri), codeError('invalid_oauth_config'));
});
test('authorization URLs have S256 PKCE and only read scopes plus offline access', () => {
  for (const provider of ['onedrive', 'googledrive', 'dropbox']) {
    const url = new URL(createAuthorization(provider, cfg(provider), { state, verifier }));
    assert.equal(url.searchParams.get('response_type'), 'code'); assert.equal(url.searchParams.get('state'), state);
    assert.equal(url.searchParams.get('redirect_uri'), redirectUri); assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(verifier).digest('base64url'));
    assert.equal(url.searchParams.has('client_secret'), false); assert.equal(url.searchParams.has('code_verifier'), false);
    assert.doesNotMatch(url.searchParams.get('scope'), /write|\.all/i);
  }
  assert.equal(new URL(createAuthorization('googledrive', cfg('googledrive'), { state, verifier })).searchParams.get('access_type'), 'offline');
  assert.equal(new URL(createAuthorization('dropbox', cfg('dropbox'), { state, verifier })).searchParams.get('token_access_type'), 'offline');
});
test('weak PKCE/state and forged endpoints are rejected before code exchange', async () => {
  assert.throws(() => createAuthorization('dropbox', cfg('dropbox'), { state, verifier: 'short' }), codeError('invalid_pkce'));
  assert.throws(() => createAuthorization('dropbox', cfg('dropbox'), { state: 'short', verifier }), codeError('invalid_oauth_state'));
  const forged = { ...cfg('dropbox'), tokenUrl: 'https://evil.example/token' };
  await assert.rejects(exchangeCode('dropbox', forged, { code: 'code', verifier, fetchImpl: () => assert.fail('must not fetch') }), codeError('invalid_oauth_config'));
});
test('code exchange posts verifier to exact provider token endpoints and normalizes token response', async () => {
  for (const provider of ['onedrive', 'googledrive', 'dropbox']) {
    const m = mock(json({ access_token: 'fake-access', refresh_token: 'fake-refresh', token_type: 'Bearer', expires_in: 3600 }));
    const before = Date.now(); const result = await exchangeCode(provider, cfg(provider), { code: 'fake-code', verifier, ...m });
    assert.equal(result.accessToken, 'fake-access'); assert.equal(result.refreshToken, 'fake-refresh'); assert.ok(result.expiresAt >= before + 3600000);
    assert.equal(m.calls[0].url, cfg(provider).tokenUrl); assert.equal(m.calls[0].options.redirect, 'manual'); assert.equal(m.calls[0].options.credentials, 'omit');
    const body = new URLSearchParams(m.calls[0].options.body); assert.equal(body.get('grant_type'), 'authorization_code'); assert.equal(body.get('code_verifier'), verifier); assert.equal(body.get('redirect_uri'), redirectUri);
  }
});
test('Google optional env secret is sent only in token body, never authorization URL', async () => {
  const config = getOAuthConfig('googledrive', { ...env, GOOGLE_CLIENT_SECRET: 'fake-desktop-secret' }, redirectUri);
  assert.doesNotMatch(createAuthorization('googledrive', config, { state, verifier }), /fake-desktop-secret/);
  const m = mock(json({ access_token: 'fake', expires_in: 3600 }));
  await exchangeCode('googledrive', config, { code: 'code', verifier, ...m });
  assert.equal(new URLSearchParams(m.calls[0].options.body).get('client_secret'), 'fake-desktop-secret');
});
test('refresh retains prior refresh token when omitted and accepts rotation', async () => {
  for (const provider of ['onedrive', 'googledrive', 'dropbox']) {
    const m = mock(json({ access_token: 'new-access', expires_in: 1800 }));
    const result = await refreshToken(provider, cfg(provider), { refreshToken: 'old-refresh', ...m });
    assert.equal(result.refreshToken, 'old-refresh'); const body = new URLSearchParams(m.calls[0].options.body);
    assert.equal(body.get('grant_type'), 'refresh_token'); assert.equal(body.get('refresh_token'), 'old-refresh'); assert.equal(body.has('code_verifier'), false);
  }
  const rotated = mock(json({ access_token: 'new', refresh_token: 'rotated', expires_in: 1800 }));
  assert.equal((await refreshToken('onedrive', cfg('onedrive'), { refreshToken: 'old', ...rotated })).refreshToken, 'rotated');
});
test('token endpoint errors and redirect bodies cannot leak secrets or redirect credentials', async () => {
  for (const response of [json({ error: 'LEAK', error_description: 'LEAK private tokens' }, 400), new Response(null, { status: 307, headers: { location: 'https://evil.example/' } })]) {
    const m = mock(response);
    await assert.rejects(exchangeCode('dropbox', cfg('dropbox'), { code: 'LEAK', verifier, ...m }), error => { assert.ok(['oauth_exchange_failed', 'unsafe_oauth_redirect'].includes(error.code)); assert.doesNotMatch(error.message, /LEAK/); assert.doesNotMatch(JSON.stringify(error), /LEAK/); return true; });
    assert.equal(m.calls.length, 1);
  }
});
test('malformed tokens, unsupported token types, and invalid expiry fail safely', async () => {
  for (const value of [{ access_token: '', expires_in: 3600 }, { access_token: 'ok', expires_in: 0 }, { access_token: 'ok', expires_in: 'infinite' }, { access_token: 'ok', expires_in: 3600, token_type: 'DPoP' }, { access_token: 'unsafe\n', expires_in: 3600 }, { access_token: 'ok', refresh_token: false, expires_in: 3600 }]) {
    await assert.rejects(exchangeCode('dropbox', cfg('dropbox'), { code: 'code', verifier, ...mock(json(value)) }), codeError('invalid_oauth_response'));
  }
});
test('network and abort errors do not include raw request details', async () => {
  await assert.rejects(exchangeCode('dropbox', cfg('dropbox'), { code: 'code', verifier, fetchImpl: async () => { throw new Error('LEAK fake-code'); } }), error => { assert.equal(error.code, 'oauth_network_error'); assert.doesNotMatch(error.stack, /LEAK/); return true; });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(exchangeCode('dropbox', cfg('dropbox'), { code: 'code', verifier, signal: controller.signal, fetchImpl: async () => { throw new DOMException('LEAK', 'AbortError'); } }), codeError('request_cancelled'));
});

test('OAuth redirect and error bodies are cancelled before safe errors escape', async () => {
  for (const status of [302, 307, 400, 429, 500]) {
    let cancelled = false;
    const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status, headers: status < 400 ? { location: 'https://evil.example/' } : {} });
    const m = mock(response);
    await assert.rejects(exchangeCode('dropbox', cfg('dropbox'), { code: 'code', verifier, ...m }));
    assert.equal(cancelled, true, `body cancelled on status ${status}`); assert.equal(m.calls.length, 1);
  }
});

test('prototype property names are unavailable provider configs', () => {
  for (const provider of ['__proto__', 'constructor', 'toString']) assert.equal(getOAuthConfig(provider, {}, redirectUri).available, false);
});
