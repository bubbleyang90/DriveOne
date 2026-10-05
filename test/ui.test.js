import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { formatBytes, formatDate, sortItems, fileKind, isSafeProviderUrl, normalizeRoute } from '../public/app.js';
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

test('UI assets use external modules/styles, unique IDs, and no unsafe rendering', () => {
  assert.match(html, /lang="zh-CN"/); assert.match(html, /<script type="module" src="\/app\.js"><\/script>/);
  assert.doesNotMatch(html, /\s(?:on\w+|style)=/i); assert.doesNotMatch(html, /<style\b|<script(?![^>]*\bsrc=)/i);
  assert.doesNotMatch(js, /\.innerHTML\s*=|insertAdjacentHTML|document\.write|\beval\s*\(/); assert.doesNotMatch(css, /@import|url\(\s*['"]?https?:/);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(x => x[1]); assert.equal(new Set(ids).size, ids.length);
  for (const match of js.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(match[1]), `HTML contains #${match[1]}`);
});
test('formatting handles missing metadata honestly', () => {
  for (const value of [null, undefined, -1, NaN]) assert.equal(formatBytes(value), '—');
  assert.equal(formatBytes(0), '0 B'); assert.equal(formatBytes(1024), '1.0 KB'); assert.equal(formatBytes(1024 ** 3), '1.0 GB');
  assert.equal(formatDate(null), '—'); assert.equal(formatDate('bad'), '—'); assert.match(formatDate('2026-01-01T08:00:00Z'), /2026/);
});
test('local sorting is folder-first, numeric-aware, and non-mutating', () => {
  const source = [{ id: '10', name: 'Note 10', kind: 'file', size: 10 }, { id: '2', name: 'Note 2', kind: 'file', size: 2 }, { id: 'f', name: 'Z folder', kind: 'folder', size: null }];
  assert.deepEqual(sortItems(source).map(x => x.id), ['f', '2', '10']); assert.deepEqual(sortItems(source, 'size').map(x => x.id), ['f', '10', '2']); assert.deepEqual(source.map(x => x.id), ['10', '2', 'f']);
});
test('file icons do not interpret names as HTML', () => {
  assert.equal(fileKind({ kind: 'folder', name: 'x.pdf' }), 'folder'); assert.equal(fileKind({ name: 'x.PDF' }), 'pdf'); assert.equal(fileKind({ name: 'x', mimeType: 'image/png' }), 'image'); assert.equal(fileKind({ name: '<img src=x onerror=alert(1)>' }), 'file');
});
test('OAuth navigation permits only known provider-owned HTTPS hosts', () => {
  assert.equal(isSafeProviderUrl('https://accounts.google.com/o/oauth2/v2/auth', 'googledrive', true), true);
  assert.equal(isSafeProviderUrl('https://login.microsoftonline.com/common/oauth2/v2.0/authorize', 'onedrive', true), true);
  for (const value of ['javascript:alert(1)', 'https://evil.test/', 'https://accounts.google.com.evil.test/', 'http://accounts.google.com/', 'https://user@accounts.google.com/', 'https://accounts.google.com:444/']) assert.equal(isSafeProviderUrl(value, 'googledrive', true), false);
  assert.equal(isSafeProviderUrl('https://www.dropbox.com/developers/apps', 'dropbox'), true); assert.equal(isSafeProviderUrl('https://accounts.google.com/', 'onedrive', true), false);
});
test('history routes validate provider and preserve matching breadcrumbs', () => {
  assert.equal(normalizeRoute('?provider=evil&folder=root').provider, null);
  const path = [{ id: 'root', name: '全部文件' }, { id: 'a', name: '文件夹' }];
  assert.deepEqual(normalizeRoute('?provider=onedrive&folder=a&q=%20hello%20', { driveone: true, path }), { provider: 'onedrive', path, query: 'hello' });
  assert.equal(normalizeRoute('?provider=onedrive&folder=b', { driveone: true, path }).path.at(-1).name, '当前文件夹'); assert.equal(normalizeRoute('?q=' + 'a'.repeat(250)).query.length, 200);
});

// Dependency-free DOM harness for cancellation and ordering; not real-browser or visual QA.
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.className = ''; this._text = ''; this.value = ''; this.disabled = false; this.hidden = false; this.open = false; this.isConnected = true; this.dataset = {}; this.classList = { toggle: (name, on) => { const classes = new Set(this.className.split(' ').filter(Boolean)); if (on) classes.add(name); else classes.delete(name); this.className = [...classes].join(' '); } }; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent || '').join(''); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this._text = ''; this.children = nodes; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  async emit(type, extra = {}) { for (const fn of this.listeners[type] || []) await fn({ target: this, currentTarget: this, preventDefault() {}, ...extra }); }
  showModal() { this.open = true; }
  close() { if (this.open) { this.open = false; this.emit('close'); } }
  getBoundingClientRect() { return { left: 0, right: 400, top: 0, bottom: 800 }; }
}
const walk = node => [node, ...node.children.flatMap(child => child instanceof Element ? walk(child) : [])];
const flush = async () => { for (let i = 0; i < 7; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const response = data => ({ ok: true, status: 200, json: async () => data });
async function mount({ mode = 'live', intercept } = {}) {
  const ids = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(x => [x[1], new Element(x[1].endsWith('-dialog') ? 'dialog' : 'div')]));
  const doc = { hidden: false, getElementById: id => ids.get(id), createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag), addEventListener() {}, querySelectorAll: selector => selector === 'dialog' ? [...ids.values()].filter(e => e.tagName === 'dialog') : selector === 'dialog[open]' ? [...ids.values()].filter(e => e.tagName === 'dialog' && e.open) : [] };
  const assigned = []; let currentURL = new URL('http://127.0.0.1:4318/'); const location = { get href() { return currentURL.href; }, get origin() { return currentURL.origin; }, get search() { return currentURL.search; }, assign: url => assigned.push(url) };
  const history = { state: null, replaceState(s, _, url) { this.state = s; currentURL = new URL(url); }, pushState(s, _, url) { this.state = s; currentURL = new URL(url); } };
  const session = { csrf: 'test-csrf', mode, downloadsDirectory: 'C:\\Downloads\\DriveOne', providers: ['baidu', 'alipan', 'quark', 'onedrive', 'googledrive', 'dropbox'].map((id, i) => ({ id, name: id, status: i < 3 ? 'approval_pending' : 'available', configured: i >= 3, connected: false })) };
  const calls = []; const window = new Element('window'); window.confirm = () => true;
  const fetch = async (path, options = {}) => { calls.push({ path, options }); const special = intercept?.(path, options); if (special) return special; if (path === '/api/session') return response(structuredClone(session)); if (path === '/api/mode') { session.mode = JSON.parse(options.body).mode; return response(session); } if (path === '/api/downloads') return response({ tasks: [] }); if (path.startsWith('/api/files') || path.startsWith('/api/search')) return response({ items: [{ id: 'folder', name: '测试文件夹', kind: 'folder' }, { id: 'file', name: '示例.txt', kind: 'file', downloadable: true }], nextCursor: null }); if (path.startsWith('/api/file?')) return response({ id: 'file', name: '示例.txt', kind: 'file', downloadable: true }); throw new Error(`Unexpected API ${path}`); };
  const context = { document: doc, window, location, history, fetch, URL, URLSearchParams, AbortController, Intl, console, setTimeout: () => 1, clearTimeout() {} };
  vm.runInNewContext(js.replaceAll('export function ', 'function '), context); await flush();
  return { ids, calls, session, assigned, window, history, location, byText: (root, text) => walk(ids.get(root)).find(e => e.tagName === 'button' && e.textContent === text), byLabel: (root, label) => walk(ids.get(root)).find(e => e.attrs['aria-label'] === label) };
}
test('live mode shows disconnected honestly; demo browses without OAuth', async () => {
  const ui = await mount(); assert.match(ui.ids.get('file-region').textContent, /连接onedrive/); assert.equal(ui.calls.some(x => x.path.startsWith('/api/files')), false);
  await ui.ids.get('mode-button').emit('click'); await flush(); assert.match(ui.ids.get('connection-summary').textContent, /当前仅显示合成内容/); assert.match(ui.ids.get('file-region').textContent, /示例.txt/); assert.equal(ui.calls.some(x => x.path === '/api/auth/start'), false);
  const post = ui.calls.find(x => x.path === '/api/mode'); assert.equal(post.options.headers['X-CSRF-Token'], 'test-csrf'); assert.equal(post.options.credentials, 'same-origin');
  await ui.byLabel('provider-cards', 'baidu，演示文件，查看文件').emit('click'); await flush(); assert.match(ui.calls.at(-1).path, /provider=baidu/);
});
test('newer provider navigation wins even when aborted requests resolve late', async () => {
  const old = deferred(); let first = true; const ui = await mount({ mode: 'demo', intercept: path => { if (path.startsWith('/api/files') && first) { first = false; return old.promise; } } });
  await ui.byLabel('provider-cards', 'dropbox，演示文件，查看文件').emit('click'); await flush(); assert.equal(ui.calls.find(x => x.path.startsWith('/api/files')).options.signal.aborted, true);
  old.resolve(response({ items: [{ id: 'stale', name: 'STALE OLD FILE', kind: 'file' }], nextCursor: null })); await flush(); assert.doesNotMatch(ui.ids.get('file-region').textContent, /STALE OLD FILE/); assert.equal(ui.ids.get('current-provider-label').textContent, 'dropbox');
});
test('closing metadata cancels request and ignores late responses', async () => {
  const pending = deferred(); const ui = await mount({ mode: 'demo', intercept: path => path.startsWith('/api/file?') ? pending.promise : null });
  ui.byLabel('file-region', '查看文件详情：示例.txt').emit('click'); await flush(); assert.equal(ui.ids.get('metadata-dialog').open, true); ui.ids.get('metadata-dialog').close(); assert.equal(ui.calls.find(x => x.path.startsWith('/api/file?')).options.signal.aborted, true);
  pending.resolve(response({ id: 'file', name: 'LATE PRIVATE METADATA', kind: 'file', downloadable: true })); await flush(); assert.equal(ui.ids.get('metadata-dialog').open, false); assert.doesNotMatch(ui.ids.get('metadata-content').textContent, /LATE PRIVATE METADATA/);
});
test('closing settings aborts OAuth and prevents late authorization navigation', async () => {
  const pending = deferred(); const ui = await mount({ intercept: path => path === '/api/auth/start' ? pending.promise : null }); await ui.ids.get('settings-button').emit('click'); ui.byText('settings-providers', '连接账号').emit('click'); await flush(); ui.ids.get('settings-dialog').close(); assert.equal(ui.calls.find(x => x.path === '/api/auth/start').options.signal.aborted, true);
  pending.resolve(response({ url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize' })); await flush(); assert.deepEqual(ui.assigned, []);
});
test('filename search uses provider-global scope and Back restores folder state', async () => {
  const ui = await mount({ mode: 'demo' }); const input = ui.ids.get('search-input'); input.value = '<img src=x onerror=alert(1)>'; await ui.ids.get('search-form').emit('submit'); await flush(); const call = ui.calls.find(x => x.path.startsWith('/api/search')); assert.ok(call); assert.equal(new URL(call.path, ui.location.origin).searchParams.get('query'), input.value); assert.doesNotMatch(call.path, /folderId=/); assert.match(ui.ids.get('results-summary').textContent, /<img src=x onerror=alert\(1\)>/);
  ui.history.replaceState({ driveone: true, path: [{ id: 'root', name: '全部文件' }] }, '', 'http://127.0.0.1:4318/?provider=dropbox'); await ui.window.emit('popstate'); await flush(); assert.equal(ui.ids.get('search-input').value, ''); assert.equal(ui.ids.get('current-provider-label').textContent, 'dropbox');
});
test('empty filtered page with cursor remains pageable and never claims no results', async () => {
  const ui = await mount({ mode: 'demo', intercept: path => path.startsWith('/api/files') ? response({ items: [], nextCursor: 'next-page' }) : null });
  assert.match(ui.ids.get('file-region').textContent, /仍有下一页/); assert.equal(ui.ids.get('pagination').hidden, false); assert.equal(ui.ids.get('load-more-button').disabled, false);
});
