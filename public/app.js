const PROVIDER_IDS = ['baidu', 'alipan', 'quark', 'onedrive', 'googledrive', 'dropbox'];
const ICONS = {
  layers: ['M12 3 2 8l10 5 10-5-10-5Z', 'm2 12 10 5 10-5', 'm2 16 10 5 10-5'],
  grid: ['M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
  list: ['M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01'],
  download: ['M12 3v12m-5-5 5 5 5-5', 'M5 15v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5'],
  cloud: ['M6 18a4 4 0 1 1 .6-7.95A6 6 0 0 1 18.3 9a4.5 4.5 0 0 1-.8 9H6Z'],
  settings: ['m9.5 3-.6 2.1-1.8 1-2.1-.5-2.5 4.3 1.6 1.6v2L2.5 15 5 19.3l2.1-.5 1.8 1 .6 2.2h5l.6-2.2 1.8-1 2.1.5 2.5-4.3-1.6-1.5v-2l1.6-1.6L19 5.6l-2.1.5-1.8-1L14.5 3h-5Z', 'M15.5 12.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z'],
  shield: ['M12 3 4 6v6c0 4 8 9 8 9s8-5 8-9V6l-8-3Z', 'm8 12 3 3 5-6'],
  lock: ['M6 10h12v11H6z', 'M8 10V7a4 4 0 0 1 8 0v3', 'M12 14v3'],
  folder: ['M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6Z', 'M3 10h18'],
  file: ['M5 3h9l5 5v13H5V3Z', 'M14 3v6h5', 'M8 13h8M8 17h5'],
  image: ['M5 3h9l5 5v13H5V3Z', 'M14 3v6h5', 'm7 18 3-4 2 2 2-3 3 5', 'M9 10h.01'],
  video: ['M5 3h9l5 5v13H5V3Z', 'M14 3v6h5', 'm10 12 5 3-5 3v-6Z'],
  sheet: ['M5 3h9l5 5v13H5V3Z', 'M14 3v6h5', 'M8 12h8v6H8zM12 12v6M8 15h8'],
  code: ['M5 3h9l5 5v13H5V3Z', 'M14 3v6h5', 'm10 13-3 2 3 2m4-4 3 2-3 2'],
  archive: ['M5 3h9l5 5v13H5V3Z', 'M14 3v6h5', 'M10 3v10M10 15h3v3h-3z'],
  search: ['M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z', 'm15 15 6 6'],
  refresh: ['M20 7a9 9 0 0 0-15-1L2 9m0-6v6h6', 'M4 17a9 9 0 0 0 15 1l3-3m0 6v-6h-6'],
  arrowRight: ['M4 12h16m-6-6 6 6-6 6'],
  chevronRight: ['m9 5 7 7-7 7'], chevronDown: ['m5 9 7 7 7-7'],
  close: ['m6 6 12 12M18 6 6 18'],
  info: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z', 'M12 11v6M12 7h.01'],
  check: ['m5 12 4 4L19 6'],
  alert: ['M12 3 2 21h20L12 3Z', 'M12 9v5M12 17h.01'],
  sparkles: ['m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z', 'M20 2v4M18 4h4'],
  flask: ['M9 3h6M10 3v6L4 19a1.3 1.3 0 0 0 1 2h14a1.3 1.3 0 0 0 1-2L14 9V3', 'M7 14h10'],
  external: ['M14 3h7v7m0-7L10 14', 'M10 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6'],
  wifiOff: ['m2 2 20 20', 'M8 8a12 12 0 0 1 14 1M2 9a12 12 0 0 1 2-1', 'M6 13a8 8 0 0 1 8-2M10 17a3 3 0 0 1 4 0', 'M12 21h.01'],
  drive: ['m9 3-7 12 4 7 7-12-4-7Z', 'M9 3h8l7 12h-8L9 3Z', 'M6 22h14l4-7H10'],
  dropbox: ['m7 3 5 3-5 4-5-3 5-4Zm10 0 5 4-5 3-5-4 5-3ZM7 11l5 3-5 4-5-3 5-4Zm10 0 5 4-5 3-5-4 5-3Z', 'm7 19 5 3 5-3'],
};

export function formatBytes(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value)) || Number(value) < 0) return '—';
  const n = Number(value);
  if (n === 0) return '0 B';
  const index = Math.min(Math.floor(Math.log(n) / Math.log(1024)), 4);
  return `${(n / 1024 ** index).toFixed(index === 0 || n / 1024 ** index >= 100 ? 0 : 1)} ${['B', 'KB', 'MB', 'GB', 'TB'][index]}`;
}
export function formatDate(value, detailed = false) {
  if (!value || Number.isNaN(new Date(value).getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', ...(detailed ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}) }).format(new Date(value));
}
export function sortItems(items, sort = 'name') {
  return [...items].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    if (sort === 'size') {
      const delta = (Number(b.size) || 0) - (Number(a.size) || 0);
      if (delta) return delta;
    }
    if (sort === 'modified') {
      const delta = (Date.parse(b.modifiedAt) || 0) - (Date.parse(a.modifiedAt) || 0);
      if (delta) return delta;
    }
    return String(a.name).localeCompare(String(b.name), 'zh-CN', { numeric: true, sensitivity: 'base' });
  });
}
export function fileKind(item) {
  if (item.kind === 'folder') return 'folder';
  const name = String(item.name || '').toLowerCase();
  const mime = String(item.mimeType || '');
  if (mime.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|svg|heic)$/.test(name)) return 'image';
  if (mime.startsWith('video/') || /\.(mp4|mov|mkv|webm)$/.test(name)) return 'video';
  if (name.endsWith('.pdf') || mime === 'application/pdf') return 'pdf';
  if (/spreadsheet/.test(mime) || /\.(xlsx?|csv|ods)$/.test(name)) return 'sheet';
  if (/\.(zip|rar|7z|tar|gz)$/.test(name)) return 'archive';
  if (/\.(js|ts|json|py|css|html|md|txt)$/.test(name)) return 'code';
  return 'file';
}
export function isSafeProviderUrl(value, provider, authorization = false) {
  const hosts = {
    onedrive: authorization ? ['login.microsoftonline.com', 'login.live.com'] : ['portal.azure.com', 'entra.microsoft.com', 'learn.microsoft.com', 'developer.microsoft.com'],
    googledrive: authorization ? ['accounts.google.com'] : ['console.cloud.google.com', 'developers.google.com'],
    dropbox: authorization ? ['www.dropbox.com', 'dropbox.com'] : ['www.dropbox.com', 'dropbox.com', 'developers.dropbox.com'],
    baidu: ['pan.baidu.com', 'openapi.baidu.com', 'yun.baidu.com'], alipan: ['www.alipan.com', 'open.alipan.com', 'www.aliyundrive.com'], quark: ['pan.quark.cn', 'open.quark.cn', 'www.quark.cn'],
  };
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (hosts[provider] || []).includes(url.hostname) && (!url.port || url.port === '443');
  } catch { return false; }
}
export function normalizeRoute(search, historyState = null) {
  const params = new URLSearchParams(search);
  const provider = PROVIDER_IDS.includes(params.get('provider')) ? params.get('provider') : null;
  const folderId = params.get('folder') || 'root';
  const savedPath = historyState?.driveone && Array.isArray(historyState.path) ? historyState.path : [];
  const validPath = savedPath.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string').slice(0, 100);
  const path = validPath.length && validPath[0].id === 'root' && validPath.at(-1).id === folderId ? validPath : [{ id: 'root', name: '全部文件' }, ...(folderId === 'root' ? [] : [{ id: folderId, name: '当前文件夹' }])];
  return { provider, path, query: (params.get('q') || '').trim().slice(0, 200) };
}

if (typeof document !== 'undefined') initialize();

function initialize() {
  const $ = id => document.getElementById(id);
  const state = { session: null, provider: null, path: [{ id: 'root', name: '全部文件' }], query: '', items: [], nextCursor: null, sort: 'name', view: 'list', loading: false, modeBusy: false, listVersion: 0, metadataVersion: 0, sessionVersion: 0, authVersion: 0, downloadVersion: 0, tasks: [], pendingDownloads: new Set(), pendingCancels: new Set() };
  let listController, metadataController, sessionController, authController, searchTimer, pollTimer, toastTimer;
  let stopped = false;
  function el(tag, className, text) { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined && text !== null) n.textContent = String(text); return n; }
  function icon(name) { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(k, v); for (const d of ICONS[name] || ICONS.file) { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); svg.append(p); } return svg; }
  function iconSpan(name, className = '') { const span = el('span', className); span.append(icon(name)); return span; }
  document.querySelectorAll('[data-icon]').forEach(node => node.append(icon(node.dataset.icon)));
  function button(text, className, action, iconName) { const b = el('button', className); b.type = 'button'; if (iconName) b.append(icon(iconName)); if (text) b.append(el('span', '', text)); b.addEventListener('click', action); return b; }
  function actionIcon(label, name, action) { const b = button('', 'icon-button', action, name); b.setAttribute('aria-label', label); b.title = label; return b; }
  function provider() { return state.session?.providers.find(p => p.id === state.provider); }
  function demo() { return state.session?.mode === 'demo'; }
  function browseable(p = provider()) { return Boolean(p && (demo() || (p.status !== 'approval_pending' && p.connected))); }
  function providerMark(p) { const mark = el('span', `provider-mark provider-${p.id}`); mark.setAttribute('aria-hidden', 'true'); if (p.id === 'onedrive') mark.append(icon('cloud')); else if (p.id === 'googledrive') mark.append(icon('drive')); else if (p.id === 'dropbox') mark.append(icon('dropbox')); else mark.textContent = { baidu: '百', alipan: 'A', quark: '夸' }[p.id] || p.short || '?'; return mark; }
  function fileIcon(item) { const kind = fileKind(item); return iconSpan(kind === 'pdf' ? 'file' : kind, `file-kind-icon kind-${kind}`); }
  function statusText(p) { if (demo()) return ['demo', '演示文件']; if (p.status === 'approval_pending') return ['pending', '待官方准入']; if (p.connected) return ['connected', '已连接']; return ['', p.configured ? '等待授权' : '待配置应用']; }
  function showToast(message, error = false) { clearTimeout(toastTimer); const toast = el('div', `toast${error ? ' error' : ''}`); toast.append(iconSpan(error ? 'alert' : 'check'), el('span', '', message)); $('toast-region').replaceChildren(toast); toastTimer = setTimeout(() => $('toast-region').replaceChildren(), error ? 8000 : 4800); }
  function setOffline(offline) { $('offline-banner').hidden = !offline; $('server-dot').classList.toggle('offline', offline); $('server-status').textContent = offline ? '本地服务连接中断' : '本地服务运行中'; }
  async function api(path, { method = 'GET', body, signal } = {}) {
    const headers = { Accept: 'application/json' };
    if (method !== 'GET') { headers['Content-Type'] = 'application/json'; headers['X-CSRF-Token'] = state.session?.csrf || ''; }
    let response;
    try { response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store', signal }); }
    catch (error) { if (error.name === 'AbortError') throw error; setOffline(true); throw new Error('无法连接本地服务，请确认 DriveOne 仍在运行。'); }
    let data; try { data = await response.json(); } catch { throw new Error('本地服务返回了无法识别的数据，请重试。'); }
    if (!response.ok) { const error = new Error(data.error?.message || `请求失败（${response.status}），请重试。`); error.code = data.error?.code; error.status = response.status; throw error; }
    setOffline(false); return data;
  }
  function abortFiles() { clearTimeout(searchTimer); listController?.abort(); state.listVersion++; metadataController?.abort(); state.metadataVersion++; }
  function abortAuth() { authController?.abort(); state.authVersion++; }
  function writeHistory(replace = false) {
    const url = new URL(location.href); url.search = ''; url.hash = ''; if (state.provider) url.searchParams.set('provider', state.provider); if (state.path.at(-1).id !== 'root') url.searchParams.set('folder', state.path.at(-1).id); if (state.query) url.searchParams.set('q', state.query);
    history[replace ? 'replaceState' : 'pushState']({ driveone: true, path: state.path }, '', url);
  }
  function chooseProvider(id, replace = false) { if (state.modeBusy || !state.session?.providers.some(p => p.id === id)) return; if (id === state.provider && state.path.length === 1 && !state.query && !replace) return; abortAuth(); state.provider = id; state.path = [{ id: 'root', name: '全部文件' }]; state.query = ''; $('search-input').value = ''; writeHistory(replace); renderProviders(); loadFiles(); }
  function navigate(path, query = '') { if (state.modeBusy) return; abortAuth(); state.path = path; state.query = query; $('search-input').value = query; writeHistory(); loadFiles(); }
  function renderProviders() {
    if (!state.session) return;
    const cards = [], nav = [];
    for (const p of state.session.providers) {
      const [statusClass, label] = statusText(p);
      const card = button('', `provider-card${p.id === state.provider ? ' selected' : ''}`, () => chooseProvider(p.id)); card.setAttribute('aria-pressed', String(p.id === state.provider)); card.setAttribute('aria-label', `${p.name}，${label}，查看文件`); card.disabled = state.modeBusy;
      const top = el('div', 'provider-card-top'); const title = el('div'); title.append(el('div', 'provider-name', p.name), el('div', 'provider-account', demo() ? '仅供预览 · 虚构内容' : p.connected ? (p.accountLabel || '已授权账号') : p.status === 'approval_pending' ? '需服务商批准后接入' : p.configured ? '使用你的账号安全登录' : '使用你自己的 Client ID')); top.append(providerMark(p), title);
      const bottom = el('div', 'provider-card-bottom'); const hint = el('span', 'provider-card-action', demo() || p.connected ? '浏览文件' : p.status === 'approval_pending' ? '查看说明' : '连接设置'); bottom.append(el('span', `provider-state ${statusClass}`, label), hint); card.append(top, bottom); cards.push(card);
      const navButton = button('', `nav-item provider-nav-item${p.id === state.provider ? ' active' : ''}`, () => chooseProvider(p.id)); navButton.title = p.name; navButton.setAttribute('aria-label', `${p.name}，${label}`); navButton.setAttribute('aria-current', p.id === state.provider ? 'page' : 'false'); navButton.append(providerMark(p), el('span', 'nav-provider-name', p.name), el('span', `provider-nav-dot${!demo() && p.connected ? ' connected' : ''}`)); navButton.disabled = state.modeBusy; nav.push(navButton);
    }
    $('provider-cards').replaceChildren(...cards); $('provider-nav').replaceChildren(...nav);
    const connected = state.session.providers.filter(p => p.connected).length;
    $('connection-summary').textContent = demo() ? '6 个示例网盘 · 当前仅显示合成内容' : `${connected} 个已连接 / ${state.session.providers.length} 个网盘`;
    $('demo-banner').hidden = !demo(); $('mode-button').title = '切换模式会取消当前正在排队或下载的任务'; $('exit-demo-button').title = '退出演示会取消当前正在排队或下载的任务'; $('mode-button').disabled = state.modeBusy; $('mode-button').replaceChildren(icon(demo() ? 'cloud' : 'sparkles'), el('span', '', demo() ? '返回真实网盘' : '体验演示'));
    $('downloads-directory').textContent = state.session.downloadsDirectory || '请查看本地服务配置';
    $('download-help').textContent = demo() ? '演示下载只生成合成样本，任务不会访问真实网盘' : '关闭此面板不会停止下载';
  }
  function renderBreadcrumbs() {
    const crumbs = [];
    state.path.forEach((part, index) => { if (index) crumbs.push(iconSpan('chevronRight', 'crumb-separator')); const b = button(part.name, index === state.path.length - 1 && !state.query ? 'current' : '', () => navigate(state.path.slice(0, index + 1)), index === 0 ? 'cloud' : null); if (index === state.path.length - 1 && !state.query) { b.setAttribute('aria-current', 'page'); b.disabled = true; } crumbs.push(b); });
    if (state.query) crumbs.push(iconSpan('chevronRight', 'crumb-separator'), el('span', 'current', '搜索结果'));
    $('breadcrumbs').replaceChildren(...crumbs); $('current-provider-label').textContent = provider()?.name || '选择网盘';
    const enabled = browseable() && !state.modeBusy; $('refresh-button').disabled = !enabled; $('search-input').disabled = !enabled; $('search-button').disabled = !enabled;
    $('search-input').placeholder = `搜索${provider()?.name || '此网盘'}的文件名`;
  }
  function emptyState(title, description, { type = 'cloud', actions = [], error = false } = {}) {
    const empty = el('div', `empty-state${error ? ' error-state' : ''}${type === 'refresh' ? ' loading-state' : ''}`); empty.append(iconSpan(type, 'empty-illustration'), el('h3', '', title), el('p', '', description)); if (actions.length) { const wrap = el('div', 'empty-actions'); wrap.append(...actions); empty.append(wrap); } return empty;
  }
  function renderUnavailable() {
    const p = provider(); let title = '连接你的第一朵云'; let description = '在设置中配置并授权网盘，或先体验完整的演示工作区。'; let actions = [button('设置连接', 'button button-primary', openSettings, 'settings'), button('体验演示', 'button button-outline', () => changeMode('demo'), 'sparkles')];
    if (p?.status === 'approval_pending') { title = `${p.name} · 官方待官方准入`; description = p.reason || '此服务需要应用资质或服务商审核，当前版本不会使用非官方接口、Cookie 或账号密码连接。'; actions = [button('查看接入说明', 'button button-primary', openSettings, 'info'), button('预览演示文件', 'button button-outline', () => changeMode('demo'), 'sparkles')]; }
    else if (p?.configured) { title = `连接${p.name}，开始浏览`; description = '将前往服务商的官方页面授权。授权完成后，你的文件会显示在这里。'; actions = [button(`连接${p.name}`, 'button button-primary', event => connectProvider(p, event.currentTarget), 'cloud'), button('查看设置', 'button button-outline', openSettings, 'settings')]; }
    else if (p) { title = `还没有连接${p.name}`; description = '先配置你自己的 OAuth 应用 Client ID，再通过官方页面授权；也可以试试无须账号的演示模式。'; }
    $('file-region').replaceChildren(emptyState(title, description, { actions })); $('results-summary').textContent = p?.status === 'approval_pending' ? '服务商审核通过前，暂不支持真实文件访问' : '连接后支持文件夹浏览、文件名搜索和本地下载';
  }
  async function loadFiles({ append = false } = {}) {
    listController?.abort(); listController = new AbortController(); const current = ++state.listVersion; const snapshot = { provider: state.provider, folder: state.path.at(-1).id, query: state.query, cursor: append ? state.nextCursor : null }; state.loading = true;
    if (!append) { state.items = []; state.nextCursor = null; }
    renderBreadcrumbs(); $('pagination').hidden = true; $('file-region').setAttribute('aria-busy', 'true');
    if (!browseable()) { state.loading = false; $('file-region').setAttribute('aria-busy', 'false'); renderUnavailable(); return; }
    if (!append) $('file-region').replaceChildren(emptyState(snapshot.query ? '正在搜索文件名' : '正在读取文件', '正在从所选网盘获取内容', { type: 'refresh' }));
    $('results-summary').textContent = snapshot.query ? `在${provider().name}中搜索“${snapshot.query}”…` : '正在读取当前文件夹…'; $('load-more-button').disabled = true;
    try {
      const params = new URLSearchParams({ provider: snapshot.provider });
      let path; if (snapshot.query) { path = '/api/search'; params.set('query', snapshot.query); } else { path = '/api/files'; params.set('folderId', snapshot.folder); params.set('sort', 'name'); }
      if (snapshot.cursor) params.set('cursor', snapshot.cursor);
      const data = await api(`${path}?${params}`, { signal: listController.signal }); if (current !== state.listVersion) return;
      if (!Array.isArray(data.items)) throw new Error('文件列表格式异常，请刷新重试。');
      const incoming = data.items.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && ['folder', 'file'].includes(item.kind));
      const ids = new Set(state.items.map(item => item.id)); state.items = append ? [...state.items, ...incoming.filter(item => !ids.has(item.id))] : incoming; state.nextCursor = typeof data.nextCursor === 'string' && data.nextCursor ? data.nextCursor : null; state.loading = false; renderFiles();
    } catch (error) { if (error.name === 'AbortError' || current !== state.listVersion) return; state.loading = false; if (append) { renderFiles(); showToast(`加载更多失败：${error.message}`, true); } else { $('file-region').replaceChildren(emptyState('暂时无法读取文件', error.message, { type: 'alert', error: true, actions: [button('重新加载', 'button button-primary', () => loadFiles(), 'refresh')] })); $('results-summary').textContent = '读取失败 · 可刷新重试'; } }
    finally { if (current === state.listVersion) { $('file-region').setAttribute('aria-busy', 'false'); $('load-more-button').disabled = false; } }
  }
  function itemNameButton(item) {
    const b = button('', 'file-name-button', () => item.kind === 'folder' ? navigate(state.query ? [{ id: 'root', name: '全部文件' }, { id: item.id, name: item.name }] : [...state.path, { id: item.id, name: item.name }]) : openMetadata(item));
    b.setAttribute('aria-label', `${item.kind === 'folder' ? '打开文件夹' : '查看文件详情'}：${item.name}`); const name = el('span', 'file-name-text', item.name); b.append(fileIcon(item), name); return b;
  }
  function itemActions(item) {
    const actions = el('div', 'row-actions');
    if (item.kind !== 'folder' && item.downloadable) { const b = actionIcon(`下载 ${item.name}`, 'download', () => item.exportFormats?.length ? openMetadata(item) : enqueueDownload(item, undefined, b)); b.disabled = state.pendingDownloads.has(`${state.provider}:${item.id}:`); actions.append(b); }
    actions.append(actionIcon(`查看 ${item.name} 的详情`, 'info', () => openMetadata(item))); return actions;
  }
  function renderFiles() {
    if (!browseable()) { renderUnavailable(); return; }
    const items = sortItems(state.items, state.sort);
    const summary = el('span', '', state.query ? `“${state.query}” · ${items.length} 项${state.nextCursor ? '已加载' : '结果'} · 搜索整个${provider().name}` : `${items.length} 个项目${state.nextCursor ? '已加载' : ''}`);
    $('results-summary').replaceChildren(summary); if (state.query) $('results-summary').append(button('清除搜索', '', () => navigate(state.path)));
    if (!items.length) $('file-region').replaceChildren(emptyState(state.nextCursor ? '本页暂无文件名匹配' : state.query ? '没有找到匹配的文件' : '这个文件夹还是空的', state.nextCursor ? '仍有下一页，点击下方“加载更多”继续查找。' : state.query ? '试试其他关键词；搜索范围是当前所选网盘。' : '这里暂时没有可显示的文件。', { type: state.query ? 'search' : 'folder' }));
    else if (state.view === 'grid') {
      const grid = el('div', 'files-grid'); for (const item of items) { const card = el('div', 'file-grid-card'); card.append(itemNameButton(item), el('div', 'grid-file-meta', item.kind === 'folder' ? '文件夹' : formatBytes(item.size)), itemActions(item)); grid.append(card); } $('file-region').replaceChildren(grid);
    } else {
      const table = el('table', 'file-table'); const caption = el('caption', 'sr-only', `${provider().name}${state.query ? '搜索结果' : '文件列表'}，文件夹在前，按已加载项目排序`); const head = el('thead'); const hr = el('tr'); for (const text of ['名称', '大小', '修改时间', '操作']) { const th = el('th', '', text); th.scope = 'col'; hr.append(th); } head.append(hr); const tbody = el('tbody'); for (const item of items) { const row = el('tr'); const name = el('td'); name.append(itemNameButton(item)); const actions = el('td'); actions.append(itemActions(item)); row.append(name, el('td', '', item.kind === 'folder' ? '—' : formatBytes(item.size)), el('td', '', formatDate(item.modifiedAt)), actions); tbody.append(row); } table.append(caption, head, tbody); $('file-region').replaceChildren(table);
    }
    $('pagination').hidden = !state.nextCursor; $('pagination-note').textContent = `已加载 ${items.length} 项 · 排序仅作用于已加载项目`; $('file-footer-note').textContent = demo() ? '演示内容 · 虚构文件' : '排序仅作用于已加载项目';
  }
  function openDialog(dialog) { if (!dialog.open) dialog.showModal(); }
  async function openMetadata(item) {
    metadataController?.abort(); metadataController = new AbortController(); const current = ++state.metadataVersion; const selectedProvider = state.provider; const selectedMode = state.session.mode; const dialog = $('metadata-dialog'); openDialog(dialog); $('metadata-content').replaceChildren(emptyState('正在读取详情', item.name, { type: 'refresh' }));
    try { const data = await api(`/api/file?${new URLSearchParams({ provider: selectedProvider, fileId: item.id })}`, { signal: metadataController.signal }); if (current !== state.metadataVersion || !dialog.open || selectedMode !== state.session.mode || selectedProvider !== state.provider) return; const file = data.item || data.file || data; if (!file || typeof file.name !== 'string' || typeof file.id !== 'string') throw new Error('文件详情格式异常，请重试。'); renderMetadata(file, selectedProvider); }
    catch (error) { if (error.name !== 'AbortError' && current === state.metadataVersion && dialog.open) $('metadata-content').replaceChildren(emptyState('暂时无法读取详情', error.message, { type: 'alert', error: true, actions: [button('重试', 'button button-primary', () => openMetadata(item), 'refresh')] })); }
  }
  function renderMetadata(item, selectedProvider) {
    const content = $('metadata-content'); const preview = el('div', 'metadata-preview'); preview.append(fileIcon(item)); const title = el('h3', 'metadata-filename', item.name); const tag = el('p', 'metadata-tag', demo() ? '虚构文件 · 仅供演示' : '来自你的已授权网盘'); const details = el('dl', 'metadata-list');
    for (const [label, value] of [['所在网盘', provider()?.name], ['类型', item.kind === 'folder' ? '文件夹' : item.mimeType || '文件'], ['大小', item.kind === 'folder' ? '—' : formatBytes(item.size)], ['修改时间', formatDate(item.modifiedAt, true)]]) { const row = el('div'); row.append(el('dt', '', label), el('dd', '', value)); details.append(row); }
    content.replaceChildren(preview, title, tag, details);
    if (item.kind === 'folder') { content.append(button('打开文件夹', 'button button-primary metadata-download', () => { $('metadata-dialog').close(); navigate(state.query ? [{ id: 'root', name: '全部文件' }, { id: item.id, name: item.name }] : [...state.path, { id: item.id, name: item.name }]); }, 'folder')); return; }
    const formats = Array.isArray(item.exportFormats) ? item.exportFormats.filter(f => f && typeof f.id === 'string') : []; let formatSelect;
    if (formats.length) { const wrap = el('div', 'metadata-export'); const label = el('label', '', '此云端文档需要选择导出格式'); label.htmlFor = 'export-format'; formatSelect = el('select'); formatSelect.id = 'export-format'; formats.forEach(f => { const option = el('option', '', f.label || f.extension || f.id); option.value = f.id; formatSelect.append(option); }); wrap.append(label, formatSelect); content.append(wrap); }
    if (item.downloadable) { const b = button(demo() ? '下载演示样本' : formats.length ? '导出并下载到本机' : '下载到本机', 'button button-primary metadata-download', () => enqueueDownload(item, formatSelect?.value, b, selectedProvider), 'download'); content.append(b, el('p', 'metadata-note', `保存到运行 DriveOne 的电脑：${state.session.downloadsDirectory || '项目下载目录'}。${demo() ? '内容为合成样本，并非真实网盘文件。' : '下载进度可在下载中心查看。'}`)); }
    else content.append(el('p', 'metadata-note', '此项目暂不支持直接下载，或当前授权不包含下载权限。'));
  }
  async function enqueueDownload(item, exportFormat, sourceButton, selectedProvider = state.provider) {
    if (state.modeBusy) return; const key = `${selectedProvider}:${item.id}:${exportFormat || ''}`; if (state.pendingDownloads.has(key)) return; state.pendingDownloads.add(key); if (sourceButton) sourceButton.disabled = true;
    try { await api('/api/downloads', { method: 'POST', body: { provider: selectedProvider, fileId: item.id, ...(exportFormat ? { exportFormat } : {}) } }); showToast(`${demo() ? '演示样本' : '文件'}已加入下载：${item.name}`); await refreshDownloads(); }
    catch (error) { showToast(`无法开始下载：${error.message}`, true); }
    finally { state.pendingDownloads.delete(key); if (sourceButton?.isConnected) sourceButton.disabled = false; }
  }
  function renderDownloads() {
    const active = state.tasks.filter(t => ['queued', 'running'].includes(t.status)); $('download-count').hidden = !active.length; $('download-count').textContent = String(active.length);
    if (!state.tasks.length) { $('downloads-content').replaceChildren(emptyState('还没有下载任务', '在文件列表点击下载，即可把文件保存到本地目录。', { type: 'download' })); return; }
    const focusedCancel = document.activeElement?.dataset?.cancelTask; let restoreFocus;
    const labels = { queued: '等待下载', running: '正在下载', complete: '下载完成', cancelled: '已取消', error: '下载失败' }; const nodes = [];
    for (const task of [...state.tasks].reverse()) {
      const card = el('article', `download-task status-${task.status}`); const head = el('div', 'download-task-header'); const title = el('div', 'download-task-title'); title.append(el('strong', '', task.name), el('small', '', state.session?.providers.find(p => p.id === task.provider)?.name || task.provider)); head.append(fileIcon({ name: task.name, kind: 'file' }), title);
      if (['queued', 'running'].includes(task.status)) { const cancel = actionIcon(`取消下载 ${task.name}`, 'close', () => cancelDownload(task.id, cancel)); cancel.disabled = state.pendingCancels.has(task.id); cancel.dataset.cancelTask = task.id; if (focusedCancel === task.id) restoreFocus = cancel; head.append(cancel); }
      card.append(head); if (['queued', 'running', 'complete'].includes(task.status)) { const progress = el('progress'); progress.max = Number(task.totalBytes) > 0 ? Number(task.totalBytes) : 1; if (Number(task.totalBytes) > 0) progress.value = Math.min(Number(task.bytesReceived) || 0, progress.max); if (task.status === 'complete') progress.value = progress.max; progress.setAttribute('aria-label', `${task.name} 下载进度`); card.append(progress); }
      const meta = el('div', 'download-task-meta'); const total = Number(task.totalBytes) > 0 ? ` / ${formatBytes(task.totalBytes)}` : ''; meta.append(el('span', '', labels[task.status] || '未知状态'), el('span', '', `${formatBytes(task.bytesReceived || 0)}${total}`)); card.append(meta); card.append(el('p', 'download-mode', task.mode === 'demo' ? '演示样本 · 合成内容' : '真实网盘文件')); if (task.savedName && task.savedName !== task.name) card.append(el('p', 'download-saved-name', `本地文件名：${task.savedName}`)); if (task.error) card.append(el('p', 'download-error', typeof task.error === 'string' ? task.error : task.error.message || '下载失败，请稍后重新尝试。')); nodes.push(card);
    }
    $('downloads-content').replaceChildren(...nodes); restoreFocus?.focus?.({ preventScroll: true });
  }
  async function refreshDownloads({ showError = false } = {}) {
    const current = ++state.downloadVersion;
    try { const data = await api('/api/downloads'); if (current !== state.downloadVersion) return; state.tasks = Array.isArray(data.tasks) ? data.tasks : []; renderDownloads(); }
    catch (error) { if (current !== state.downloadVersion) return; if (showError || $('downloads-dialog').open) $('downloads-content').replaceChildren(emptyState('下载状态暂时不可用', error.message, { type: 'alert', error: true, actions: [button('重试', 'button button-primary', () => refreshDownloads({ showError: true }), 'refresh')] })); }
  }
  async function cancelDownload(id, sourceButton) { if (state.pendingCancels.has(id)) return; state.pendingCancels.add(id); sourceButton.disabled = true; try { await api(`/api/downloads/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: {} }); await refreshDownloads(); } catch (error) { showToast(`取消失败：${error.message}`, true); } finally { state.pendingCancels.delete(id); if (sourceButton.isConnected) sourceButton.disabled = false; } }
  function schedulePoll() { clearTimeout(pollTimer); if (stopped) return; pollTimer = setTimeout(async () => { if (state.session && !state.modeBusy && !document.hidden) await refreshDownloads(); schedulePoll(); }, state.tasks.some(t => ['running', 'queued'].includes(t.status)) || $('downloads-dialog').open ? 1800 : 12000); }
  function openDownloads() { openDialog($('downloads-dialog')); refreshDownloads({ showError: true }); schedulePoll(); }
  const config = {
    onedrive: { env: 'ONEDRIVE_CLIENT_ID', detail: '在 Microsoft Entra 创建应用；启用移动和桌面应用的公共客户端授权。可选 ONEDRIVE_TENANT，默认为 common。', url: 'https://portal.azure.com/' },
    googledrive: { env: 'GOOGLE_CLIENT_ID', detail: '在 Google Cloud 启用 Drive API，配置 OAuth 同意屏幕并创建“桌面应用”OAuth 客户端；如凭据提供了 secret，可配置 GOOGLE_CLIENT_SECRET。测试应用需要将自己的账号加入测试用户。', url: 'https://console.cloud.google.com/' },
    dropbox: { env: 'DROPBOX_CLIENT_ID', detail: '在 Dropbox App Console 创建 scoped access 应用，选择 Full Dropbox 以浏览整个账号；启用 files.metadata.read 与 files.content.read 两项权限，并配置下方回调地址。App folder 应用只能访问该应用文件夹。', url: 'https://www.dropbox.com/developers/apps' },
  };
  function renderSettings() {
    if (!state.session) { $('settings-providers').replaceChildren(emptyState('本地服务未连接', '先启动本地服务，再刷新此页面。', { type: 'alert' })); return; }
    const nodes = [];
    for (const p of state.session.providers) {
      const card = el('section', 'settings-provider'); const top = el('div', 'settings-provider-top'); const title = el('div'); const [statusClass, status] = statusText(p); title.append(el('div', 'provider-name', p.name), el('div', `provider-state provider-account ${statusClass}`, status)); top.append(providerMark(p), title);
      if (demo()) { const b = button('演示模式', 'button button-soft', () => {}); b.disabled = true; top.append(b); }
      else if (p.connected) top.append(button('断开连接', 'button button-danger', event => disconnectProvider(p, event.currentTarget)));
      else { const b = button(p.status === 'approval_pending' ? '等待官方准入' : p.configured ? '连接账号' : '先配置应用', 'button button-primary', event => connectProvider(p, event.currentTarget)); b.disabled = p.status === 'approval_pending' || !p.configured; top.append(b); }
      card.append(top);
      if (p.status === 'approval_pending') card.append(el('p', '', p.reason || '官方 API 接入需要服务商批准。当前版本尚未获得所需应用资质，不支持真实登录、搜索或下载。'));
      else { const c = config[p.id]; card.append(el('p', '', c?.detail || '按项目说明配置 OAuth 应用。')); if (c) { const code = el('div', 'settings-config'); code.append(el('span', '', '环境变量'), el('code', '', c.env), el('span', '', '授权回调地址'), el('code', '', `${location.origin}/oauth/callback/${p.id}`)); card.append(code); } }
      const setupUrl = p.setupUrl || config[p.id]?.url; if (isSafeProviderUrl(setupUrl, p.id)) { const link = el('a', '', p.status === 'approval_pending' ? '官方接入说明' : '打开官方应用控制台'); link.href = setupUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.append(icon('external')); card.append(link); }
      nodes.push(card);
    }
    $('settings-providers').replaceChildren(...nodes);
  }
  function openSettings() { renderSettings(); openDialog($('settings-dialog')); }
  async function connectProvider(p, sourceButton) {
    if (state.modeBusy || demo() || !p.configured || p.status === 'approval_pending') return;
    abortAuth(); authController = new AbortController(); const current = ++state.authVersion; const settingsWasOpen = $('settings-dialog').open; sourceButton.disabled = true; const old = sourceButton.textContent; sourceButton.textContent = '正在打开授权…';
    try { const data = await api('/api/auth/start', { method: 'POST', body: { provider: p.id }, signal: authController.signal }); if (current !== state.authVersion || demo() || (settingsWasOpen && !$('settings-dialog').open)) return; if (!isSafeProviderUrl(data.url, p.id, true)) throw new Error('授权地址不属于已支持的官方服务商，已阻止跳转。'); location.assign(data.url); }
    catch (error) { if (error.name !== 'AbortError' && current === state.authVersion) showToast(`无法连接账号：${error.message}`, true); }
    finally { if (sourceButton.isConnected) { sourceButton.disabled = false; sourceButton.textContent = old; } }
  }
  async function disconnectProvider(p, sourceButton) { if (state.modeBusy) return; if (state.tasks.some(t => t.provider === p.id && ['queued', 'running'].includes(t.status)) && !window.confirm(`断开${p.name}将取消该网盘正在进行的下载。确定要断开吗？`)) return; abortAuth(); sourceButton.disabled = true; try { await api('/api/disconnect', { method: 'POST', body: { provider: p.id } }); abortFiles(); await loadSession({ preserveRoute: true }); if ($('settings-dialog').open) renderSettings(); showToast(`已断开${p.name}连接`); } catch (error) { showToast(`断开连接失败：${error.message}`, true); } finally { if (sourceButton.isConnected) sourceButton.disabled = false; } }
  async function changeMode(mode) {
    if (!state.session || state.modeBusy || mode === state.session.mode) return;
    if (state.pendingDownloads.size || state.pendingCancels.size) { showToast('请等待当前下载操作完成，再切换模式'); return; }
    if (state.tasks.some(t => ['queued', 'running'].includes(t.status)) && !window.confirm('切换模式会取消正在排队或下载的任务。确定要切换吗？')) return;
    state.modeBusy = true; abortFiles(); abortAuth(); state.downloadVersion++; document.querySelectorAll('dialog[open]').forEach(d => d.close()); renderProviders(); $('exit-demo-button').disabled = true;
    try { await api('/api/mode', { method: 'POST', body: { mode } }); await loadSession({ preserveRoute: false }); showToast(mode === 'demo' ? '已进入演示模式，所有文件均为虚构示例' : '已返回真实网盘工作区'); }
    catch (error) { showToast(`切换模式失败：${error.message}`, true); await loadSession({ preserveRoute: true }); }
    finally { state.modeBusy = false; $('exit-demo-button').disabled = false; renderProviders(); renderBreadcrumbs(); }
  }
  async function loadSession({ preserveRoute = true } = {}) {
    sessionController?.abort(); sessionController = new AbortController(); const current = ++state.sessionVersion;
    try {
      const session = await api('/api/session', { signal: sessionController.signal }); if (current !== state.sessionVersion) return; if (!Array.isArray(session.providers) || typeof session.csrf !== 'string' || !['live', 'demo'].includes(session.mode)) throw new Error('本地会话数据格式异常，请重启服务。'); state.session = session; session.providers = session.providers.filter(p => PROVIDER_IDS.includes(p.id));
      const route = preserveRoute ? normalizeRoute(location.search, history.state) : { provider: state.provider, path: [{ id: 'root', name: '全部文件' }], query: '' }; state.provider = session.providers.some(p => p.id === route.provider) ? route.provider : session.providers.find(p => p.connected)?.id || (session.providers.some(p => p.id === 'onedrive') ? 'onedrive' : session.providers[0]?.id); state.path = route.path; state.query = route.query; $('search-input').value = state.query; writeHistory(true); renderProviders(); await Promise.all([loadFiles(), refreshDownloads()]); schedulePoll();
    } catch (error) { if (error.name === 'AbortError' || current !== state.sessionVersion) return; setOffline(true); $('connection-summary').textContent = '本地服务连接失败'; $('provider-cards').replaceChildren(); $('file-region').replaceChildren(emptyState('连接不上本地服务', error.message, { type: 'wifiOff', error: true, actions: [button('重新连接', 'button button-primary', () => loadSession(), 'refresh')] })); $('results-summary').textContent = '请启动 DriveOne 服务，并保持终端窗口运行'; $('mode-button').disabled = true; }
  }
  function submitSearch() { clearTimeout(searchTimer); if (!browseable() || state.modeBusy) return; const query = $('search-input').value.trim().slice(0, 200); if (query === state.query && !state.loading) return; navigate(state.path, query); }
  $('search-form').addEventListener('submit', event => { event.preventDefault(); submitSearch(); });
  $('search-input').addEventListener('search', () => { if (!$('search-input').value) submitSearch(); });
  $('search-input').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(submitSearch, 450); });
  $('home-button').addEventListener('click', () => { if (state.provider) chooseProvider(state.provider, true); });
  $('downloads-button').addEventListener('click', openDownloads);
  $('top-downloads-button').addEventListener('click', openDownloads);
  for (const id of ['settings-button', 'top-settings-button', 'manage-button']) $(id).addEventListener('click', openSettings);
  $('refresh-button').addEventListener('click', () => loadFiles()); $('offline-retry').addEventListener('click', () => loadSession());
  $('mode-button').addEventListener('click', () => changeMode(demo() ? 'live' : 'demo')); $('exit-demo-button').addEventListener('click', () => changeMode('live'));
  $('sort-select').addEventListener('change', event => { state.sort = event.target.value; if (!state.loading) renderFiles(); });
  $('load-more-button').addEventListener('click', () => { if (state.nextCursor && !state.loading) loadFiles({ append: true }); });
  for (const view of ['list', 'grid']) $(`${view}-view-button`).addEventListener('click', () => { state.view = view; for (const name of ['list', 'grid']) { $(`${name}-view-button`).classList.toggle('selected', name === view); $(`${name}-view-button`).setAttribute('aria-pressed', String(name === view)); } if (!state.loading) renderFiles(); });
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => $(b.dataset.close).close()));
  $('metadata-dialog').addEventListener('close', () => { metadataController?.abort(); state.metadataVersion++; });
  $('settings-dialog').addEventListener('close', abortAuth);
  for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => { if (event.target === dialog) { const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close(); } });
  window.addEventListener('popstate', () => { if (!state.session) return; abortAuth(); $('metadata-dialog').close(); const route = normalizeRoute(location.search, history.state); if (state.session.providers.some(p => p.id === route.provider)) state.provider = route.provider; state.path = route.path; state.query = route.query; $('search-input').value = route.query; renderProviders(); loadFiles(); });
  window.addEventListener('offline', () => setOffline(true)); window.addEventListener('online', () => loadSession());
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.session) { refreshDownloads(); schedulePoll(); } });
  window.addEventListener('pagehide', () => { stopped = true; clearTimeout(pollTimer); clearTimeout(searchTimer); abortFiles(); abortAuth(); sessionController?.abort(); });
  window.addEventListener('pageshow', event => { if (event.persisted) { stopped = false; loadSession(); } });
  const auth = new URLSearchParams(location.search).get('auth'); if (auth) { const url = new URL(location.href); url.searchParams.delete('auth'); url.searchParams.delete('error'); url.searchParams.delete('message'); history.replaceState(history.state, '', url); showToast(auth === 'connected' ? '授权成功，正在读取你的网盘' : '授权未完成。你可以在设置中重新连接账号。', auth !== 'connected'); }
  loadSession();
}
