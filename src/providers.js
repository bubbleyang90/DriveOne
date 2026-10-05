/** Official, read-only provider adapters. All network calls use fixed API origins. */
export const PROVIDERS = Object.freeze([
  { id: 'onedrive', name: 'OneDrive', short: 'OD', color: '#1685ee', status: 'available', reason: '需要配置你自己的 Microsoft 应用，并由你完成账号授权。', setupUrl: 'https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app' },
  { id: 'googledrive', name: 'Google Drive', short: 'GD', color: '#34a853', status: 'available', reason: '需要配置你自己的 Google 桌面 OAuth 客户端，并由你完成账号授权。', setupUrl: 'https://developers.google.com/identity/protocols/oauth2/native-app' },
  { id: 'dropbox', name: 'Dropbox', short: 'DB', color: '#0061ff', status: 'available', reason: '需要配置你自己的 Dropbox 应用和只读权限，并由你完成账号授权。', setupUrl: 'https://www.dropbox.com/developers/apps' },
  { id: 'baidu', name: '百度网盘', short: '百', color: '#2979ff', status: 'approval_pending', reason: '等待核实官方开发者接入条件、应用审核与授权流程，暂不开放连接。', setupUrl: 'https://yun.baidu.com/open/platform' },
  { id: 'alipan', name: '阿里云盘', short: '阿', color: '#7857f2', status: 'approval_pending', reason: '等待核实官方开发者接入条件、应用审核与授权流程，暂不开放连接。', setupUrl: 'https://www.alipan.com/developer' },
  { id: 'quark', name: '夸克网盘', short: '夸', color: '#20a4f3', status: 'approval_pending', reason: '已有官方网盘 Skill；本应用的授权方式与可用接口仍待核实，暂不开放连接。', setupUrl: 'https://www.quark.cn/documents/help/quark-drive-skill' },
].map(Object.freeze));

export class ProviderError extends Error {
  constructor(code, status, message) { super(message); this.name = 'ProviderError'; this.code = code; this.status = status; }
  toJSON() { return { code: this.code, status: this.status, message: this.message }; }
}
const fail = (code, status, message) => { throw new ProviderError(code, status, message); };
const GRAPH = 'https://graph.microsoft.com';
const GOOGLE = 'https://www.googleapis.com';
const DBX = 'https://api.dropboxapi.com';
const DBX_CONTENT = 'https://content.dropboxapi.com';
const GOOGLE_FIELDS = 'id,name,mimeType,size,modifiedTime,webViewLink,capabilities(canDownload)';
const GRAPH_FIELDS = 'id,name,size,file,folder,package,lastModifiedDateTime,webUrl';
const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);
const validString = (value, max = 8192) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
function input(value, label, max = 1024) {
  if (!validString(value, max)) fail('invalid_input', 400, '请求参数缺失或格式无效。');
  return value;
}
function itemId(value) {
  input(value, 'file or folder ID', 2048);
  if (value === '.' || value === '..') fail('invalid_input', 400, '文件或文件夹 ID 无效。');
  return encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
function queryText(query) { return input(query, 'search query', 1000).trim() || fail('invalid_input', 400, '请输入文件名关键词。'); }
function httpsURL(value, origin) {
  let url; try { url = new URL(value); } catch { fail('unsafe_url', 400, '网盘返回的链接格式不受支持，已停止请求。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443') || (origin && url.origin !== origin)) fail('unsafe_url', 400, '网盘返回的链接格式不受支持，已停止请求。');
  return url;
}
function webURL(value) {
  if (!validString(value)) return null;
  try { return httpsURL(value).href; } catch { return null; }
}
function byteSize(value) { const n = value === null || value === undefined ? NaN : Number(value); return Number.isSafeInteger(n) && n >= 0 ? n : null; }
function modified(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null; }
function metadata(value) {
  if (!isRecord(value) || !validString(value.id, 2048) || !validString(value.name, 4096)) fail('invalid_response', 502, '网盘返回的文件信息不完整，请重试。');
  return value;
}
function cursorEncode(provider, operation, context, token) {
  if (token === undefined || token === null || token === '') return null;
  if (!validString(token, 12000)) fail('invalid_response', 502, '网盘返回的分页信息无效，请刷新列表。');
  return Buffer.from(JSON.stringify({ v: 1, provider, operation, context, token })).toString('base64url');
}
function cursorDecode(cursor, provider, operation, context) {
  if (cursor === undefined || cursor === null || cursor === '') return null;
  if (!validString(cursor, 24000) || !/^[A-Za-z0-9_-]+$/.test(cursor)) fail('invalid_cursor', 400, '分页信息无效，请刷新列表。');
  let data; try { data = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { fail('invalid_cursor', 400, '分页信息无效，请刷新列表。'); }
  if (!isRecord(data) || data.v !== 1 || data.provider !== provider || data.operation !== operation || data.context !== context || !validString(data.token, 12000)) fail('invalid_cursor', 400, '分页信息与当前目录或搜索不匹配，请刷新列表。');
  return data.token;
}
function sortKey(sort) {
  const value = sort ?? 'name';
  if (!['name', 'name_desc', 'modified', 'modified_desc', 'size', 'size_desc'].includes(value)) fail('invalid_sort', 400, '暂不支持此排序方式。');
  return value;
}
function upstreamError(status) {
  if (status === 401) return new ProviderError('authentication_required', 401, '账号授权已过期，请重新连接此网盘。');
  if (status === 403) return new ProviderError('access_denied', 403, '网盘拒绝访问此文件或执行此操作，请检查权限。');
  if (status === 404 || status === 409) return new ProviderError('item_unavailable', 404, '此文件或分页信息已失效，请刷新后重试。');
  if (status === 429) return new ProviderError('rate_limited', 429, '网盘请求过于频繁，请稍后重试。');
  return new ProviderError('provider_error', status >= 500 ? 502 : 400, '网盘暂时无法完成请求，请稍后重试。');
}
async function dispose(response) { try { await response.body?.cancel(); } catch { /* no raw errors */ } }
function transport(accessToken, fetchImpl) {
  if (!validString(accessToken, 32768) || /\s/u.test(accessToken)) fail('authentication_required', 401, '请先连接此网盘，再浏览文件。');
  if (typeof fetchImpl !== 'function') fail('invalid_configuration', 500, '网络模块暂不可用。');
  return async (url, { signal, headers = {}, method = 'GET', body, authenticated = true, allowRedirect = false } = {}) => {
    const u = httpsURL(url);
    if (authenticated && ![GRAPH, GOOGLE, DBX, DBX_CONTENT].includes(u.origin)) fail('unsafe_url', 400, '不支持此请求目标，已停止请求。');
    const headerTimeout = new AbortController();
    const requestSignal = signal ? AbortSignal.any([signal, headerTimeout.signal]) : headerTimeout.signal;
    const timer = setTimeout(() => headerTimeout.abort(), 30_000);
    timer.unref?.();
    let response;
    try {
      response = await fetchImpl(u.href, { method, headers: { ...headers, ...(authenticated ? { Authorization: `Bearer ${accessToken}` } : {}) }, body, signal: requestSignal, redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer' });
    } catch (error) {
      if (signal?.aborted) fail('request_cancelled', 499, '请求已取消。');
      if (headerTimeout.signal.aborted) fail('provider_timeout', 504, '网盘响应超时，请稍后重试。');
      if (error?.name === 'AbortError') fail('request_cancelled', 499, '请求已取消。');
      fail('network_error', 502, '暂时无法连接网盘，请检查网络后重试。');
    } finally {
      // Only bound time to response headers. Large file streams keep the caller's
      // cancellation signal but must not inherit a total 30-second download limit.
      clearTimeout(timer);
    }
    if (response.redirected) { await dispose(response); fail('unsafe_redirect', 502, '已拦截网盘返回的意外跳转。'); }
    if (response.status >= 300 && response.status < 400) {
      if (allowRedirect && [301, 302, 303, 307, 308].includes(response.status)) return response;
      await dispose(response); fail('unsafe_redirect', 502, '已拦截网盘返回的意外跳转。');
    }
    if (!response.ok) { await dispose(response); throw upstreamError(response.status); }
    // No adapter sends Range; accepting 206 would silently save an incomplete file.
    if (response.status === 206) { await dispose(response); fail('incomplete_response', 502, '网盘返回了不完整的文件内容，已停止下载。'); }
    return response;
  };
}
async function jsonResponse(response) {
  try { const result = await response.json(); if (isRecord(result)) return result; } catch { /* discard raw body */ }
  fail('invalid_response', 502, '网盘返回的数据格式无效，请稍后重试。');
}
function fileOnly(item) { if (item.kind === 'folder' || !item.downloadable) fail('download_unavailable', 422, '此项目暂不支持通过本应用下载。'); }
function noExport(value) { if (value !== undefined && value !== null && value !== '') fail('invalid_export_format', 400, '此文件不支持选择导出格式。'); }

function graphItem(raw) {
  const x = metadata(raw); const folder = Boolean(x.folder || x.package);
  return { id: x.id, name: x.name, kind: folder ? 'folder' : 'file', size: folder ? null : byteSize(x.size), mimeType: folder ? 'application/vnd.folder' : (x.file?.mimeType || 'application/octet-stream'), modifiedAt: modified(x.lastModifiedDateTime), downloadable: !folder && Boolean(x.file), webUrl: webURL(x.webUrl) };
}
function graphCursorURL(value, expectedPath) {
  const url = httpsURL(value, GRAPH);
  if (url.pathname !== expectedPath) fail('invalid_cursor', 400, '分页链接与当前目录或搜索不匹配。');
  const allowed = new Set(['$select', '$top', '$orderby', '$skiptoken', '$skipToken', '$skip', 'skiptoken', 'skipToken']);
  for (const key of url.searchParams.keys()) if (!allowed.has(key)) fail('invalid_cursor', 400, '分页链接包含不支持的参数。');
  return url.href;
}
function microsoftDownloadURL(value) {
  const url = httpsURL(value);
  // Exact Microsoft-owned DNS suffixes prevent IP/local-host and suffix tricks.
  // Microsoft lists *.files.1drv.com; validate each cluster label (including multi-label CDN names).
  const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  const host = url.hostname;
  const oneDrive = host.endsWith('.files.1drv.com') && host.slice(0, -'.files.1drv.com'.length).split('.').every(x => label.test(x));
  const sharePoint = host.endsWith('.sharepoint.com') && label.test(host.slice(0, -'.sharepoint.com'.length));
  if (host.length > 253 || (!oneDrive && !sharePoint)) fail('unsafe_download_url', 422, 'Microsoft 返回的下载域名尚未列入安全名单，请在 OneDrive 中下载此文件。');
  return url.href;
}
function oneDrive(request) {
  async function page(operation, context, initialURL, cursor, signal) {
    const expected = new URL(initialURL).pathname;
    const token = cursorDecode(cursor, 'onedrive', operation, context);
    const url = token ? graphCursorURL(token, expected) : initialURL;
    const result = await jsonResponse(await request(url, { signal }));
    if (!Array.isArray(result.value)) fail('invalid_response', 502, '网盘返回的文件列表格式无效。');
    const next = result['@odata.nextLink'] ? graphCursorURL(result['@odata.nextLink'], expected) : null;
    return { items: result.value.map(graphItem), nextCursor: cursorEncode('onedrive', operation, context, next) };
  }
  const api = {
    async list({ folderId = 'root', cursor, sort, signal } = {}) {
      const chosenSort = sortKey(sort); const path = folderId === 'root' ? 'root' : `items/${itemId(folderId)}`;
      const url = new URL(`${GRAPH}/v1.0/me/drive/${path}/children`);
      url.searchParams.set('$select', GRAPH_FIELDS); url.searchParams.set('$top', '100');
      url.searchParams.set('$orderby', ({ name: 'name asc', name_desc: 'name desc', modified: 'lastModifiedDateTime asc', modified_desc: 'lastModifiedDateTime desc', size: 'size asc', size_desc: 'size desc' })[chosenSort]);
      return page('list', JSON.stringify([folderId, chosenSort]), url.href, cursor, signal);
    },
    async search({ query, cursor, signal } = {}) {
      const text = queryText(query);
      const escaped = encodeURIComponent(text.replace(/'/g, "''")).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
      const url = new URL(`${GRAPH}/v1.0/me/drive/root/search(q='${escaped}')`);
      url.searchParams.set('$select', GRAPH_FIELDS); url.searchParams.set('$top', '100');
      const result = await page('search', text, url.href, cursor, signal);
      // Graph also matches metadata/content; the explorer promises filename results.
      const filenameQuery = text.normalize('NFKC').toLowerCase();
      result.items = result.items.filter(item => item.name.normalize('NFKC').toLowerCase().includes(filenameQuery));
      return result;
    },
    async stat({ fileId, signal } = {}) {
      const path = fileId === 'root' ? 'root' : `items/${itemId(fileId)}`;
      const url = new URL(`${GRAPH}/v1.0/me/drive/${path}`); url.searchParams.set('$select', GRAPH_FIELDS);
      return graphItem(await jsonResponse(await request(url.href, { signal })));
    },
    async download({ fileId, exportFormat, signal } = {}) {
      noExport(exportFormat); const item = await api.stat({ fileId, signal }); fileOnly(item);
      let response = await request(`${GRAPH}/v1.0/me/drive/items/${itemId(fileId)}/content`, { signal, allowRedirect: true });
      for (let redirects = 0; response.status >= 300 && response.status < 400; redirects++) {
        const location = response.headers.get('location'); await dispose(response);
        if (redirects >= 3) fail('unsafe_redirect', 502, '网盘下载跳转次数过多，已停止请求。');
        const url = microsoftDownloadURL(location);
        response = await request(url, { signal, authenticated: false, allowRedirect: true });
      }
      return { response, fileName: item.name };
    },
  };
  return api;
}

const format = (id, label, extension, mimeType) => Object.freeze({ id, label, extension, mimeType });
const PDF = format('pdf', 'PDF', '.pdf', 'application/pdf');
export const GOOGLE_EXPORT_FORMATS = Object.freeze({
  'application/vnd.google-apps.document': Object.freeze([PDF, format('docx', 'Word 文档 (.docx)', '.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), format('txt', '纯文本', '.txt', 'text/plain')]),
  'application/vnd.google-apps.spreadsheet': Object.freeze([format('xlsx', 'Excel 表格 (.xlsx)', '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), PDF, format('csv', 'CSV（仅第一个工作表）', '.csv', 'text/csv')]),
  'application/vnd.google-apps.presentation': Object.freeze([format('pptx', 'PowerPoint 演示文稿 (.pptx)', '.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'), PDF]),
  'application/vnd.google-apps.drawing': Object.freeze([PDF, format('png', 'PNG 图片', '.png', 'image/png'), format('svg', 'SVG 图片', '.svg', 'image/svg+xml')]),
});
function googleItem(raw) {
  const x = metadata(raw); const folder = x.mimeType === 'application/vnd.google-apps.folder';
  const native = typeof x.mimeType === 'string' && x.mimeType.startsWith('application/vnd.google-apps.');
  const exportFormats = Object.hasOwn(GOOGLE_EXPORT_FORMATS, x.mimeType) ? GOOGLE_EXPORT_FORMATS[x.mimeType] : undefined;
  return { id: x.id, name: x.name, kind: folder ? 'folder' : 'file', size: folder ? null : byteSize(x.size), mimeType: x.mimeType || 'application/octet-stream', modifiedAt: modified(x.modifiedTime), downloadable: !folder && x.capabilities?.canDownload !== false && (!native || Boolean(exportFormats)), webUrl: webURL(x.webViewLink), ...(exportFormats ? { exportFormats: exportFormats.map(x => ({ ...x })) } : {}) };
}
const escapeGoogle = value => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
function googleDrive(request) {
  async function page(operation, context, q, cursor, sort, signal) {
    const token = cursorDecode(cursor, 'googledrive', operation, context);
    const url = new URL(`${GOOGLE}/drive/v3/files`);
    url.searchParams.set('q', q); url.searchParams.set('fields', `nextPageToken,files(${GOOGLE_FIELDS})`);
    url.searchParams.set('pageSize', '100'); url.searchParams.set('spaces', 'drive');
    if (token) url.searchParams.set('pageToken', token);
    if (sort) url.searchParams.set('orderBy', ({ name: 'folder,name_natural', name_desc: 'folder,name_natural desc', modified: 'folder,modifiedTime', modified_desc: 'folder,modifiedTime desc', size: 'folder,quotaBytesUsed', size_desc: 'folder,quotaBytesUsed desc' })[sort]);
    const result = await jsonResponse(await request(url.href, { signal }));
    if (!Array.isArray(result.files)) fail('invalid_response', 502, '网盘返回的文件列表格式无效。');
    return { items: result.files.map(googleItem), nextCursor: cursorEncode('googledrive', operation, context, result.nextPageToken) };
  }
  const api = {
    async list({ folderId = 'root', cursor, sort, signal } = {}) {
      input(folderId, 'folder ID', 2048); const chosenSort = sortKey(sort);
      return page('list', JSON.stringify([folderId, chosenSort]), `'${escapeGoogle(folderId)}' in parents and trashed = false`, cursor, chosenSort, signal);
    },
    async search({ query, cursor, signal } = {}) {
      const text = queryText(query);
      return page('search', text, `name contains '${escapeGoogle(text)}' and trashed = false`, cursor, 'name', signal);
    },
    async stat({ fileId, signal } = {}) {
      const url = new URL(`${GOOGLE}/drive/v3/files/${itemId(fileId)}`); url.searchParams.set('fields', GOOGLE_FIELDS);
      return googleItem(await jsonResponse(await request(url.href, { signal })));
    },
    async download({ fileId, exportFormat, signal } = {}) {
      const item = await api.stat({ fileId, signal }); fileOnly(item);
      let url = new URL(`${GOOGLE}/drive/v3/files/${itemId(fileId)}`); let fileName = item.name;
      if (item.exportFormats) {
        if (!exportFormat) fail('export_format_required', 400, '请先选择此 Google 文档的导出格式。');
        const selected = item.exportFormats.find(x => x.id === exportFormat);
        if (!selected) fail('invalid_export_format', 400, '此文档不支持所选导出格式。');
        url = new URL(`${url.href}/export`); url.searchParams.set('mimeType', selected.mimeType);
        fileName += fileName.toLowerCase().endsWith(selected.extension) ? '' : selected.extension;
      } else { noExport(exportFormat); url.searchParams.set('alt', 'media'); }
      return { response: await request(url.href, { signal }), fileName };
    },
  };
  return api;
}

function dropboxItem(raw) {
  const x = metadata(raw); const folder = x['.tag'] === 'folder';
  if (!folder && x['.tag'] !== 'file') fail('invalid_response', 502, '网盘返回了暂不支持的文件信息。');
  return { id: x.id, name: x.name, kind: folder ? 'folder' : 'file', size: folder ? null : byteSize(x.size), mimeType: folder ? 'application/vnd.folder' : 'application/octet-stream', modifiedAt: modified(x.server_modified || x.client_modified), downloadable: !folder && x.is_downloadable !== false, webUrl: null };
}
function dropboxPath(value, root = false) {
  if (root && value === 'root') return '';
  input(value, 'Dropbox file or folder ID', 2048);
  if (!value.startsWith('id:') && !value.startsWith('/')) fail('invalid_input', 400, '请输入有效的 Dropbox 文件 ID 或完整网盘路径。');
  return value;
}
function dropbox(request) {
  const rpc = async (path, body, signal) => jsonResponse(await request(`${DBX}/2/files/${path}`, { signal, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  const api = {
    async list({ folderId = 'root', cursor, sort, signal } = {}) {
      // Dropbox's list API has no server-side sort. The caller may sort loaded pages.
      const chosenSort = sortKey(sort); const path = dropboxPath(folderId, true); const context = JSON.stringify([folderId, chosenSort]);
      const token = cursorDecode(cursor, 'dropbox', 'list', context);
      const result = token ? await rpc('list_folder/continue', { cursor: token }, signal) : await rpc('list_folder', { path, recursive: false, include_deleted: false, include_non_downloadable_files: true, limit: 100 }, signal);
      if (!Array.isArray(result.entries) || !result.entries.every(isRecord)) fail('invalid_response', 502, '网盘返回的文件列表格式无效。');
      return { items: result.entries.filter(x => x['.tag'] !== 'deleted').map(dropboxItem), nextCursor: result.has_more ? cursorEncode('dropbox', 'list', context, input(result.cursor, 'pagination cursor', 12000)) : null };
    },
    async search({ query, cursor, signal } = {}) {
      const text = queryText(query); const token = cursorDecode(cursor, 'dropbox', 'search', text);
      const result = token ? await rpc('search/continue_v2', { cursor: token }, signal) : await rpc('search_v2', { query: text, options: { filename_only: true, max_results: 100, file_status: 'active' }, match_field_options: { include_highlights: false } }, signal);
      if (!Array.isArray(result.matches)) fail('invalid_response', 502, '网盘返回的搜索结果格式无效。');
      return { items: result.matches.map(x => dropboxItem(x?.metadata?.metadata)), nextCursor: result.has_more ? cursorEncode('dropbox', 'search', text, input(result.cursor, 'pagination cursor', 12000)) : null };
    },
    async stat({ fileId, signal } = {}) { return dropboxItem(await rpc('get_metadata', { path: dropboxPath(fileId), include_deleted: false }, signal)); },
    async download({ fileId, exportFormat, signal } = {}) {
      noExport(exportFormat); const item = await api.stat({ fileId, signal }); fileOnly(item);
      const args = JSON.stringify({ path: dropboxPath(fileId) }).replace(/[\u007f-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
      return { response: await request(`${DBX_CONTENT}/2/files/download`, { signal, method: 'POST', headers: { 'Dropbox-API-Arg': args } }), fileName: item.name };
    },
  };
  return api;
}

export function createProvider(id, { accessToken, fetchImpl = fetch } = {}) {
  const definition = PROVIDERS.find(x => x.id === id);
  if (!definition) fail('unknown_provider', 404, '找不到此网盘服务。');
  if (definition.status !== 'available') fail('provider_pending', 409, definition.reason);
  const request = transport(accessToken, fetchImpl);
  return ({ onedrive: oneDrive, googledrive: googleDrive, dropbox })[id](request);
}
