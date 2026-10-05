import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, PROVIDERS } from '../src/providers.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function mock(...responses) {
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url, options }); const next = responses.shift(); if (next instanceof Error) throw next; if (!next) throw Error('Unexpected request'); return typeof next === 'function' ? next(url, options) : next; };
  return { calls, fetchImpl };
}
const graphFile = { id: 'ABC!123', name: 'Report.pdf', size: 42, file: { mimeType: 'application/pdf' }, lastModifiedDateTime: '2026-01-01T00:00:00Z', webUrl: 'https://onedrive.live.com/?id=ABC' };
const googleFile = { id: 'file-1', name: 'Report.pdf', size: '42', mimeType: 'application/pdf', modifiedTime: '2026-01-01T00:00:00Z', capabilities: { canDownload: true } };
const dbxFile = { '.tag': 'file', id: 'id:file1', name: 'Report.pdf', size: 42, is_downloadable: true, server_modified: '2026-01-01T00:00:00Z' };
const errorCode = code => error => { assert.equal(error.code, code); assert.equal(typeof error.status, 'number'); assert.ok(error.message); return true; };

// Tests use fake bearer strings and mocked fetch only. No account or network is accessed.
test('provider registry has six entries; unsupported providers cannot be used', () => {
  assert.equal(PROVIDERS.length, 6);
  assert.deepEqual(PROVIDERS.filter(x => x.status === 'available').map(x => x.id), ['onedrive', 'googledrive', 'dropbox']);
  for (const id of ['baidu', 'alipan', 'quark']) assert.throws(() => createProvider(id, { accessToken: 'fake' }), errorCode('provider_pending'));
  assert.throws(() => createProvider('unknown'), errorCode('unknown_provider'));
  assert.throws(() => createProvider('dropbox'), errorCode('authentication_required'));
});
test('OneDrive normalizes folder/file metadata and paginates official nextLink', async () => {
  const next = 'https://graph.microsoft.com/v1.0/me/drive/root/children?$skiptoken=page2';
  const m = mock(json({ value: [graphFile, { id: 'folder', name: 'Projects', folder: {} }], '@odata.nextLink': next }), json({ value: [] }));
  const p = createProvider('onedrive', { accessToken: 'fake-token', ...m });
  const page = await p.list();
  assert.equal(page.items[0].size, 42); assert.equal(page.items[1].kind, 'folder'); assert.equal(page.items[1].downloadable, false);
  assert.ok(page.nextCursor); assert.equal((await p.list({ cursor: page.nextCursor })).nextCursor, null);
  assert.equal(m.calls[1].url, next);
  for (const call of m.calls) { assert.equal(call.options.redirect, 'manual'); assert.equal(call.options.credentials, 'omit'); assert.equal(call.options.headers.Authorization, 'Bearer fake-token'); }
});
test('OneDrive blocks foreign origins, credentials, ports, paths, and hidden parameters in nextLink', async () => {
  for (const next of ['https://evil.example/v1.0/me/drive/root/children', 'http://graph.microsoft.com/v1.0/me/drive/root/children', 'https://graph.microsoft.com@evil.example/v1.0/me/drive/root/children', 'https://graph.microsoft.com:8443/v1.0/me/drive/root/children', 'https://graph.microsoft.com/v1.0/users', 'https://graph.microsoft.com/v1.0/me/drive/root/children?$expand=permissions', 'https://graph.microsoft.com/v1.0/me/drive/root/children#secret']) {
    const m = mock(json({ value: [], '@odata.nextLink': next }));
    await assert.rejects(createProvider('onedrive', { accessToken: 'fake', ...m }).list(), error => ['invalid_cursor', 'unsafe_url'].includes(error.code));
    assert.equal(m.calls.length, 1);
  }
});
test('malicious cursors and cursor reuse across operation, folder, or provider are rejected before fetch', async () => {
  const m = mock(json({ value: [], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/drive/root/children?$skiptoken=next' }));
  const p = createProvider('onedrive', { accessToken: 'fake', ...m });
  const { nextCursor } = await p.list();
  for (const options of [{ cursor: 'https://evil.example' }, { cursor: '!!!' }, { cursor: nextCursor, folderId: 'different' }]) await assert.rejects(p.list(options), errorCode('invalid_cursor'));
  await assert.rejects(p.search({ query: 'Report', cursor: nextCursor }), errorCode('invalid_cursor'));
  await assert.rejects(createProvider('googledrive', { accessToken: 'fake', ...m }).list({ cursor: nextCursor }), errorCode('invalid_cursor'));
  const forged = JSON.parse(Buffer.from(nextCursor, 'base64url').toString()); forged.token = 'https://evil.example/';
  await assert.rejects(p.list({ cursor: Buffer.from(JSON.stringify(forged)).toString('base64url') }), errorCode('unsafe_url'));
  assert.equal(m.calls.length, 1);
});
test('OneDrive search escapes quotes and special characters without creating URL fragments or query injections', async () => {
  const m = mock(json({ value: [] })); const p = createProvider('onedrive', { accessToken: 'fake', ...m });
  await p.search({ query: "O'Brien/#?& stuff" }); const url = new URL(m.calls[0].url);
  assert.equal(url.origin, 'https://graph.microsoft.com'); assert.equal(url.hash, '');
  assert.match(decodeURIComponent(url.pathname), /search\(q='O''Brien\/#\?& stuff'\)$/);
  assert.equal(url.searchParams.has('stuff'), false);
});
test('OneDrive streams a validated Microsoft redirect without forwarding tokens', async () => {
  const download = 'https://tenant-my.sharepoint.com/personal/user/_layouts/15/download.aspx?authkey=opaque';
  const body = new Response('file-content');
  const m = mock(json(graphFile), new Response(null, { status: 302, headers: { location: download } }), body);
  const p = createProvider('onedrive', { accessToken: 'fake-token', ...m }); const result = await p.download({ fileId: 'ABC!123' });
  assert.equal(result.fileName, 'Report.pdf'); assert.equal(result.response, body); assert.equal(await result.response.text(), 'file-content');
  assert.equal(m.calls[1].options.headers.Authorization, 'Bearer fake-token');
  assert.equal(m.calls[2].options.headers.Authorization, undefined); assert.equal(m.calls[2].options.credentials, 'omit');
  assert.equal(m.calls[2].url, download);
});
test('OneDrive redirect checks reject SSRF and suffix tricks, never requesting unsafe destinations', async () => {
  for (const location of ['https://127.0.0.1/secret', 'https://169.254.169.254/latest', 'https://evil.example/download', 'https://tenant.sharepoint.com.evil.example/file', 'https://user:pass@tenant.sharepoint.com/file', 'https://tenant.sharepoint.com:8443/file', 'http://cluster.files.1drv.com/file', 'https://tenant..sharepoint.com/file', 'https://[::1]/file']) {
    const m = mock(json(graphFile), new Response(null, { status: 302, headers: { location } }));
    await assert.rejects(createProvider('onedrive', { accessToken: 'fake', ...m }).download({ fileId: 'ABC' }), error => ['unsafe_download_url', 'unsafe_url'].includes(error.code));
    assert.equal(m.calls.length, 2);
  }
});
test('OneDrive validates every redirect hop and caps redirect chains', async () => {
  const redirect = location => new Response(null, { status: 302, headers: { location } });
  const m = mock(json(graphFile), redirect('https://cluster.files.1drv.com/file'), redirect('https://evil.example/file'));
  await assert.rejects(createProvider('onedrive', { accessToken: 'fake', ...m }).download({ fileId: 'ABC' }), errorCode('unsafe_download_url'));
  assert.equal(m.calls.length, 3); assert.equal(m.calls[2].options.headers.Authorization, undefined);
  const chain = mock(json(graphFile), ...Array.from({ length: 4 }, () => redirect('https://cluster.files.1drv.com/file')));
  await assert.rejects(createProvider('onedrive', { accessToken: 'fake', ...chain }).download({ fileId: 'ABC' }), errorCode('unsafe_redirect'));
  assert.equal(chain.calls.length, 5);
});
test('Google list uses precise fields and encodes opaque page tokens only as parameters', async () => {
  const token = 'https://evil.example/?token=not-a-url';
  const m = mock(json({ files: [googleFile], nextPageToken: token }), json({ files: [] }));
  const p = createProvider('googledrive', { accessToken: 'fake', ...m });
  const result = await p.list(); assert.equal(result.items[0].size, 42);
  await p.list({ cursor: result.nextCursor }); const url = new URL(m.calls[1].url);
  assert.equal(url.origin, 'https://www.googleapis.com'); assert.equal(url.pathname, '/drive/v3/files'); assert.equal(url.searchParams.get('pageToken'), token);
  assert.equal(url.searchParams.get('q'), "'root' in parents and trashed = false");
});
test('Google search is filename scoped, escapes Drive query literals, and excludes trash', async () => {
  const m = mock(json({ files: [] }));
  await createProvider('googledrive', { accessToken: 'fake', ...m }).search({ query: "a'b\\c" });
  const url = new URL(m.calls[0].url); assert.equal(url.searchParams.get('q'), "name contains 'a\\'b\\\\c' and trashed = false");
});
test('Google Workspace docs require an explicit allowed format and append correct extension', async () => {
  const doc = { ...googleFile, name: 'Notes', mimeType: 'application/vnd.google-apps.document', size: undefined };
  const m = mock(json(doc), json(doc), json(doc), new Response('docx-stream'));
  const p = createProvider('googledrive', { accessToken: 'fake', ...m });
  await assert.rejects(p.download({ fileId: 'file-1' }), errorCode('export_format_required'));
  await assert.rejects(p.download({ fileId: 'file-1', exportFormat: 'application/evil' }), errorCode('invalid_export_format'));
  const result = await p.download({ fileId: 'file-1', exportFormat: 'docx' });
  assert.equal(result.fileName, 'Notes.docx'); assert.equal(await result.response.text(), 'docx-stream');
  const url = new URL(m.calls[3].url); assert.equal(url.pathname, '/drive/v3/files/file-1/export'); assert.equal(url.searchParams.get('mimeType'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
});
test('Google binary media downloads stream; denied downloads and unsupported native files fail closed', async () => {
  const m = mock(json(googleFile), new Response('bytes'));
  const p = createProvider('googledrive', { accessToken: 'fake', ...m });
  assert.equal((await p.download({ fileId: 'file-1' })).fileName, 'Report.pdf');
  assert.equal(new URL(m.calls[1].url).searchParams.get('alt'), 'media');
  for (const value of [{ ...googleFile, capabilities: { canDownload: false } }, { ...googleFile, mimeType: 'application/vnd.google-apps.form' }, { ...googleFile, mimeType: 'application/vnd.google-apps.vid' }, { ...googleFile, mimeType: 'application/vnd.google-apps.folder' }]) {
    const blocked = mock(json(value)); await assert.rejects(createProvider('googledrive', { accessToken: 'fake', ...blocked }).download({ fileId: 'file-1' }), errorCode('download_unavailable')); assert.equal(blocked.calls.length, 1);
  }
});
test('Dropbox list/continue use native cursors and root path; deleted entries are filtered', async () => {
  const m = mock(json({ entries: [dbxFile, { '.tag': 'deleted', name: 'old' }], has_more: true, cursor: 'native-cursor' }), json({ entries: [], has_more: false, cursor: 'done' }));
  const p = createProvider('dropbox', { accessToken: 'fake', ...m });
  const result = await p.list(); assert.equal(result.items.length, 1); assert.equal(JSON.parse(m.calls[0].options.body).path, '');
  await p.list({ cursor: result.nextCursor }); assert.equal(m.calls[1].url, 'https://api.dropboxapi.com/2/files/list_folder/continue'); assert.deepEqual(JSON.parse(m.calls[1].options.body), { cursor: 'native-cursor' });
});
test('Dropbox filename search unwraps metadata and uses search/continue_v2', async () => {
  const m = mock(json({ matches: [{ metadata: { '.tag': 'metadata', metadata: dbxFile } }], has_more: true, cursor: 'search-cursor' }), json({ matches: [], has_more: false }));
  const p = createProvider('dropbox', { accessToken: 'fake', ...m });
  const result = await p.search({ query: 'Report' }); assert.equal(result.items[0].id, 'id:file1');
  assert.equal(JSON.parse(m.calls[0].options.body).options.filename_only, true);
  await p.search({ query: 'Report', cursor: result.nextCursor }); assert.equal(m.calls[1].url, 'https://api.dropboxapi.com/2/files/search/continue_v2');
});
test('Dropbox download encodes Unicode header arguments and uses separate official content endpoint', async () => {
  const m = mock(json({ ...dbxFile, name: '报告.pdf' }), new Response('stream'));
  const result = await createProvider('dropbox', { accessToken: 'fake', ...m }).download({ fileId: '/报告.pdf' });
  assert.equal(result.fileName, '报告.pdf'); assert.equal(m.calls[1].url, 'https://content.dropboxapi.com/2/files/download');
  const arg = m.calls[1].options.headers['Dropbox-API-Arg']; assert.match(arg, /\\u62a5/); assert.equal(JSON.parse(arg).path, '/报告.pdf');
});
test('API errors and network exceptions never expose upstream tokens or data', async () => {
  for (const [status, code] of [[401, 'authentication_required'], [403, 'access_denied'], [404, 'item_unavailable'], [429, 'rate_limited'], [500, 'provider_error']]) {
    const m = mock(json({ access_token: 'LEAK', message: 'LEAK-private-name' }, status));
    await assert.rejects(createProvider('googledrive', { accessToken: 'LEAK', ...m }).list(), error => { assert.equal(error.code, code); assert.doesNotMatch(JSON.stringify(error), /LEAK/); assert.doesNotMatch(error.message, /LEAK/); return true; });
  }
  const m = mock(new Error('LEAK token and private URL'));
  await assert.rejects(createProvider('onedrive', { accessToken: 'fake', ...m }).list(), error => { assert.equal(error.code, 'network_error'); assert.doesNotMatch(error.stack, /LEAK/); return true; });
});
test('ordinary API redirects are never followed and malformed JSON gets safe errors', async () => {
  for (const response of [new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }), new Response('LEAK not JSON')]) {
    const m = mock(response); await assert.rejects(createProvider('googledrive', { accessToken: 'fake', ...m }).list(), error => ['unsafe_redirect', 'invalid_response'].includes(error.code)); assert.equal(m.calls.length, 1);
  }
});
test('invalid IDs, empty search, unknown sorting, and cancelled requests fail safely', async () => {
  const m = mock(); const p = createProvider('googledrive', { accessToken: 'fake', ...m });
  await assert.rejects(p.stat({ fileId: '..' }), errorCode('invalid_input'));
  await assert.rejects(p.search({ query: '   ' }), errorCode('invalid_input'));
  await assert.rejects(p.list({ sort: '$evil' }), errorCode('invalid_sort')); assert.equal(m.calls.length, 0);
  const controller = new AbortController(); controller.abort();
  const aborted = mock(new DOMException('Private request body', 'AbortError'));
  await assert.rejects(createProvider('googledrive', { accessToken: 'fake', ...aborted }).list({ signal: controller.signal }), errorCode('request_cancelled'));
});

test('rejected redirect and API error response bodies are cancelled', async () => {
  for (const status of [302, 307, 401, 403, 429, 500]) {
    let cancelled = false;
    const stream = new ReadableStream({ cancel() { cancelled = true; } });
    const response = new Response(stream, { status, headers: status < 400 ? { location: 'https://evil.example/' } : {} });
    const m = mock(response);
    await assert.rejects(createProvider('googledrive', { accessToken: 'fake', ...m }).list());
    assert.equal(cancelled, true, `body cancelled on status ${status}`);
  }
  let cancelled = false;
  const redirect = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 302, headers: { location: 'https://127.0.0.1/secret' } });
  const m = mock(json(graphFile), redirect);
  await assert.rejects(createProvider('onedrive', { accessToken: 'fake', ...m }).download({ fileId: 'ABC' }), errorCode('unsafe_download_url'));
  assert.equal(cancelled, true); assert.equal(m.calls.length, 2);
});

test('OneDrive filename search excludes content-only matches while retaining empty-page pagination', async () => {
  const next = "https://graph.microsoft.com/v1.0/me/drive/root/search(q='notes')?$skiptoken=page2";
  const m = mock(json({ value: [graphFile], '@odata.nextLink': next }), json({ value: [{ ...graphFile, name: 'Project NOTES.pdf' }] }));
  const p = createProvider('onedrive', { accessToken: 'fake', ...m });
  const first = await p.search({ query: 'notes' }); assert.deepEqual(first.items, []); assert.ok(first.nextCursor);
  const second = await p.search({ query: 'notes', cursor: first.nextCursor }); assert.equal(second.items[0].name, 'Project NOTES.pdf'); assert.equal(second.nextCursor, null);
});
test('OneDrive accepts multiple valid cluster labels only within the exact official CDN suffix', async () => {
  const url = 'https://public.sn.files.1drv.com/opaque-download';
  const m = mock(json(graphFile), new Response(null, { status: 302, headers: { location: url } }), new Response('safe-content'));
  const result = await createProvider('onedrive', { accessToken: 'fake', ...m }).download({ fileId: 'ABC' });
  assert.equal(await result.response.text(), 'safe-content'); assert.equal(m.calls[2].options.headers.Authorization, undefined);
});
test('prototype-named MIME types cannot expose inherited export formats', async () => {
  const m = mock(json({ files: [{ ...googleFile, mimeType: '__proto__' }] }));
  const result = await createProvider('googledrive', { accessToken: 'fake', ...m }).list();
  assert.equal(result.items[0].exportFormats, undefined);
});

test('provider download rejects unsolicited partial content and cancels the body', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 206, headers: { 'Content-Range': 'bytes 0-5/100' } });
  const m = mock(json(googleFile), response);
  await assert.rejects(createProvider('googledrive', { accessToken: 'fake', ...m }).download({ fileId: 'file-1' }), errorCode('incomplete_response'));
  assert.equal(cancelled, true);
});
test('malformed Dropbox list and search rows remain structured provider errors', async () => {
  const m = mock(json({ entries: [null], has_more: false }), json({ matches: [null], has_more: false }));
  const p = createProvider('dropbox', { accessToken: 'fake', ...m });
  await assert.rejects(p.list(), errorCode('invalid_response'));
  await assert.rejects(p.search({ query: 'name' }), errorCode('invalid_response'));
});

test('provider header timeout is bounded and returns a fixed 504 without automatic retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const p = createProvider('googledrive', { accessToken: 'fake', fetchImpl: async (_url, { signal }) => {
    calls++;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('LEAK-url', 'AbortError')), { once: true }));
  } });
  const pending = p.list();
  const check = assert.rejects(pending, error => { assert.equal(error.code, 'provider_timeout'); assert.equal(error.status, 504); assert.equal(error.message, '网盘响应超时，请稍后重试。'); return true; });
  t.mock.timers.tick(30_000); await check; assert.equal(calls, 1);
});
test('header timeout is cleared after headers while caller cancellation still reaches download body', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController(); let bodySignal; let call = 0;
  const p = createProvider('googledrive', { accessToken: 'fake', fetchImpl: async (_url, { signal }) => {
    call++;
    if (call === 1) return json(googleFile);
    bodySignal = signal;
    return new Response(new ReadableStream({ start(stream) { signal.addEventListener('abort', () => stream.error(new DOMException('cancelled', 'AbortError')), { once: true }); } }));
  } });
  const { response } = await p.download({ fileId: 'file-1', signal: controller.signal });
  t.mock.timers.tick(90_000); assert.equal(bodySignal.aborted, false, 'no total download timeout after response headers');
  const text = response.text(); controller.abort();
  await assert.rejects(text, error => error.name === 'AbortError'); assert.equal(bodySignal.aborted, true);
});
test('caller cancellation takes precedence over header timeout and clears its timer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  const p = createProvider('googledrive', { accessToken: 'fake', fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })) });
  const pending = p.list({ signal: controller.signal });
  const check = assert.rejects(pending, errorCode('request_cancelled'));
  controller.abort(); await check; t.mock.timers.tick(90_000);
});
