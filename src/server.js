import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROVIDERS, createProvider } from './providers.js';
import * as oauth from './oauth.js';
import { createDownloadManager } from './downloads.js';
import { createDemoProvider } from './demo.js';
import { AppError, publicError } from './errors.js';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const COOKIE = 'driveone_session';
const SESSION_TTL = 8 * 60 * 60 * 1000;
const AUTH_TTL = 10 * 60 * 1000;
const token = () => randomBytes(32).toString('base64url');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const combine = (...signals) => AbortSignal.any(signals.filter(Boolean));
function checkSingleParams(url) {
  for (const key of new Set(url.searchParams.keys())) if (url.searchParams.getAll(key).length > 1) throw new AppError('INVALID_REQUEST', '请求包含重复参数');
}
function value(input, name, { max = 2048, fallback, optional = false } = {}) {
  const result = input instanceof URLSearchParams ? input.get(name) : input?.[name];
  if (result === null || result === undefined || result === '') {
    if (fallback !== undefined) return fallback;
    if (optional) return undefined;
    throw new AppError('INVALID_REQUEST', `缺少必要参数：${name}`);
  }
  if (typeof result !== 'string' || result.length > max || /[\x00-\x1f\x7f]/.test(result)) throw new AppError('INVALID_REQUEST', '参数格式无效');
  return result;
}
async function jsonBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new AppError('INVALID_CONTENT_TYPE', '请求必须使用 JSON', 415);
  if (req.headers['content-encoding']) throw new AppError('INVALID_ENCODING', '不支持压缩请求', 415);
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 16 * 1024) throw new AppError('BODY_TOO_LARGE', '请求内容过大', 413);
    chunks.push(chunk);
  }
  let parsed;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AppError('INVALID_JSON', 'JSON 格式无效'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new AppError('INVALID_JSON', '请求必须是 JSON 对象');
  return parsed;
}

export async function createApp({ port = 4318, env = process.env, downloadDir = env.DRIVEONE_DOWNLOAD_DIR || path.resolve('downloads'), fetchImpl = fetch, providerFactory = createProvider, oauthImpl = oauth, now = Date.now, maxBytes = Number(env.DRIVEONE_MAX_DOWNLOAD_BYTES || 20 * 1024 ** 3) } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Invalid download size limit');
  const downloads = await createDownloadManager({ directory: downloadDir, maxBytes });
  const sessions = new Map();
  let origin = `http://127.0.0.1:${port}`;
  let shuttingDown = false;
  const configs = new Map();
  function refreshConfigs() {
    configs.clear();
    for (const provider of PROVIDERS.filter(p => p.status === 'available')) configs.set(provider.id, oauthImpl.getOAuthConfig(provider.id, env, `${origin}/oauth/callback/${provider.id}`));
  }
  function headers(res) {
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  }
  function send(res, data, status = 200) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  }
  function disconnect(session, provider) {
    const account = session.accounts.get(provider);
    if (account) account.controller.abort();
    session.accounts.delete(provider);
    session.pending.delete(provider);
    downloads.cancelOwner(session.id, provider);
  }
  function dispose(session) {
    session.modeController.abort();
    for (const provider of session.accounts.keys()) disconnect(session, provider);
    session.pending.clear();
    downloads.cancelOwner(session.id);
    sessions.delete(session.id);
  }
  function getSession(req, res, create = false) {
    const matches = (req.headers.cookie ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith(`${COOKIE}=`));
    let session = matches.length === 1 ? sessions.get(matches[0].slice(COOKIE.length + 1)) : null;
    if (session && (now() - session.createdAt >= SESSION_TTL || now() - session.touchedAt >= SESSION_TTL)) { dispose(session); session = null; }
    if (!session && create) {
      if (sessions.size >= 64) throw new AppError('TOO_MANY_SESSIONS', '本机浏览器会话过多，请重启应用', 429);
      session = { id: token(), csrf: token(), mode: 'live', createdAt: now(), touchedAt: now(), accounts: new Map(), pending: new Map(), modeController: new AbortController() };
      sessions.set(session.id, session);
      res.setHeader('Set-Cookie', `${COOKIE}=${session.id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}`);
    }
    if (!session) throw new AppError('SESSION_EXPIRED', '会话已过期，请刷新页面', 401);
    session.touchedAt = now();
    return session;
  }
  function providerInfo(id) {
    const info = PROVIDERS.find(p => p.id === id);
    if (!info) throw new AppError('UNKNOWN_PROVIDER', '未知网盘');
    return info;
  }
  function requireAvailable(id) {
    const info = providerInfo(id);
    if (info.status !== 'available') throw new AppError('PROVIDER_PENDING', info.reason || '此网盘尚未开放接入', 409);
    return info;
  }
  function status(session) {
    return { csrf: session.csrf, mode: session.mode, downloadsDirectory: downloads.directory,
      providers: PROVIDERS.map(p => ({ ...p, configured: Boolean(configs.get(p.id)?.available), connected: Boolean(session.accounts.get(p.id)?.tokens), demo: session.mode === 'demo' })) };
  }
  async function realAdapter(session, id, signal) {
    requireAvailable(id);
    const account = session.accounts.get(id);
    if (!account?.tokens) throw new AppError('NOT_CONNECTED', '请先连接此网盘', 401);
    const joined = combine(signal, account.controller.signal);
    joined.throwIfAborted();
    if (account.tokens.expiresAt <= now() + 60_000) {
      if (!account.tokens.refreshToken) {
        disconnect(session, id);
        throw new AppError('RECONNECT_REQUIRED', '授权已过期，请重新连接网盘', 401);
      }
      if (!account.refreshing) {
        account.refreshing = (async () => {
          try {
            const updated = await oauthImpl.refreshToken(id, configs.get(id), { refreshToken: account.tokens.refreshToken, fetchImpl, signal: combine(account.controller.signal, AbortSignal.timeout(30_000)) });
            if (session.accounts.get(id) !== account || account.controller.signal.aborted) throw new AppError('DISCONNECTED', '网盘已断开', 409);
            account.tokens = { ...updated, refreshToken: updated.refreshToken || account.tokens.refreshToken };
          } catch (error) {
            if (session.accounts.get(id) === account) disconnect(session, id);
            throw new AppError('RECONNECT_REQUIRED', '刷新授权失败，请重新连接网盘', 401);
          } finally { account.refreshing = null; }
        })();
      }
      await account.refreshing;
    }
    joined.throwIfAborted();
    if (session.accounts.get(id) !== account) throw new AppError('DISCONNECTED', '网盘已断开', 409);
    return { adapter: providerFactory(id, { accessToken: account.tokens.accessToken, fetchImpl }), signal: joined, account };
  }
  async function operation(session, id, method, args, signal) {
    providerInfo(id);
    const modeSignal = session.modeController.signal;
    const timeoutSignal = method === 'download' ? null : AbortSignal.timeout(30_000);
    const joined = combine(signal, modeSignal, timeoutSignal);
    joined.throwIfAborted();
    if (session.mode === 'demo') return createDemoProvider()[method]({ ...args, signal: joined });
    const real = await realAdapter(session, id, joined);
    try {
      const result = await real.adapter[method]({ ...args, signal: real.signal });
      if (real.signal.aborted && result?.response?.body) await result.response.body.cancel().catch(() => {});
      real.signal.throwIfAborted();
      return result;
    } catch (error) {
      if (timeoutSignal?.aborted && !signal?.aborted && !modeSignal.aborted) throw new AppError('PROVIDER_TIMEOUT', '网盘响应超时，请稍后重试', 504);
      if (error.status === 401 && session.accounts.get(id) === real.account) disconnect(session, id);
      throw error;
    }
  }
  async function callback(req, res, url, provider) {
    requireAvailable(provider);
    const session = getSession(req, res);
    const pending = session.pending.get(provider);
    const state = value(url.searchParams, 'state', { max: 128 });
    if (!pending || !same(state, pending.state)) throw new AppError('INVALID_OAUTH_STATE', '授权会话无效，请从应用重新连接', 400);
    // Consume on success, denial, or exchange failure. A matching callback is never replayable.
    session.pending.delete(provider);
    if (now() - pending.createdAt > AUTH_TTL) throw new AppError('OAUTH_EXPIRED', '授权已超时，请重新连接', 400);
    if (url.searchParams.has('error')) {
      res.writeHead(303, { Location: '/?auth=cancelled' }); res.end(); return;
    }
    const code = value(url.searchParams, 'code', { max: 4096 });
    const controller = new AbortController();
    const modeSignal = session.modeController.signal;
    // Reserve a generation before exchange; disconnect can invalidate it while token exchange is running.
    const account = { tokens: null, controller, refreshing: null };
    disconnect(session, provider);
    session.accounts.set(provider, account);
    try {
      const tokens = await oauthImpl.exchangeCode(provider, configs.get(provider), { code, verifier: pending.verifier, fetchImpl, signal: combine(controller.signal, modeSignal, AbortSignal.timeout(30_000)) });
      if (session.accounts.get(provider) !== account || controller.signal.aborted || modeSignal.aborted) throw new AppError('DISCONNECTED', '授权已取消', 409);
      account.tokens = tokens;
      res.writeHead(303, { Location: '/?auth=connected' }); res.end();
    } catch {
      if (session.accounts.get(provider) === account) disconnect(session, provider);
      res.writeHead(303, { Location: '/?auth=error' }); res.end();
    }
  }
  const server = http.createServer({ maxHeaderSize: 32 * 1024 }, async (req, res) => {
    headers(res);
    const controller = new AbortController();
    const abort = () => { if (!res.writableFinished) controller.abort(); };
    req.on('aborted', abort); res.on('close', abort);
    try {
      if (shuttingDown) throw new AppError('SHUTTING_DOWN', '应用正在关闭', 503);
      if (req.headers.host !== new URL(origin).host) throw new AppError('INVALID_HOST', '仅允许本机访问', 403);
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) throw new AppError('INVALID_REQUEST', '请求地址无效');
      const url = new URL(req.url, origin);
      if (url.origin !== origin) throw new AppError('INVALID_REQUEST', '请求地址无效');
      checkSingleParams(url);
      const callbackMatch = /^\/oauth\/callback\/([a-z]+)$/.exec(url.pathname);
      if (callbackMatch && req.method === 'GET') { await callback(req, res, url, callbackMatch[1]); return; }
      if (req.headers.origin && req.headers.origin !== origin) throw new AppError('INVALID_ORIGIN', '拒绝跨站请求', 403);
      if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) throw new AppError('CROSS_SITE_REQUEST', '拒绝跨站请求', 403);
      if (req.method === 'GET' && ['/', '/index.html', '/app.js', '/styles.css'].includes(url.pathname)) {
        const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const file = await readFile(path.join(PUBLIC, name));
        res.writeHead(200, { 'Content-Type': name.endsWith('.js') ? 'text/javascript; charset=utf-8' : name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8' });
        res.end(file); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/session') { send(res, status(getSession(req, res, true))); return; }
      if (!url.pathname.startsWith('/api/')) throw new AppError('NOT_FOUND', '页面不存在', 404);
      const session = getSession(req, res);
      let body;
      if (req.method === 'POST') {
        if (req.headers.origin !== origin) throw new AppError('INVALID_ORIGIN', '写入请求需要本机来源', 403);
        if (!same(req.headers['x-csrf-token'], session.csrf)) throw new AppError('INVALID_CSRF', '请求已失效，请刷新页面', 403);
        body = await jsonBody(req);
      } else if (req.method !== 'GET') throw new AppError('METHOD_NOT_ALLOWED', '不支持此请求方法', 405);
      if (req.method === 'POST' && url.pathname === '/api/mode') {
        if (!['demo', 'live'].includes(body.mode)) throw new AppError('INVALID_MODE', '模式无效');
        if (body.mode !== session.mode) {
          session.modeController.abort(); session.modeController = new AbortController();
          downloads.cancelOwner(session.id);
          for (const provider of session.pending.keys()) session.pending.delete(provider);
          session.mode = body.mode;
        }
        send(res, status(session)); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/start') {
        const provider = value(body, 'provider', { max: 30 }); requireAvailable(provider);
        if (session.mode === 'demo') throw new AppError('DEMO_MODE', '请先退出演示模式再连接真实网盘', 409);
        const config = configs.get(provider);
        if (!config?.available) throw new AppError('SETUP_REQUIRED', '请按 README 配置自己的应用 Client ID 后重启', 409);
        const state = token(); const verifier = token();
        session.pending.set(provider, { state, verifier, createdAt: now() });
        const authUrl = oauthImpl.createAuthorization(provider, config, { state, verifier });
        send(res, { url: authUrl }); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/disconnect') {
        const provider = value(body, 'provider', { max: 30 }); providerInfo(provider);
        disconnect(session, provider); send(res, status(session)); return;
      }
      if (req.method === 'GET' && ['/api/files', '/api/search', '/api/file'].includes(url.pathname)) {
        const provider = value(url.searchParams, 'provider', { max: 30 });
        const cursor = value(url.searchParams, 'cursor', { max: 24_000, optional: true });
        let result;
        if (url.pathname === '/api/files') result = await operation(session, provider, 'list', { folderId: value(url.searchParams, 'folderId', { fallback: 'root' }), cursor, sort: 'name' }, controller.signal);
        else if (url.pathname === '/api/search') result = await operation(session, provider, 'search', { query: value(url.searchParams, 'query', { max: 256 }), cursor }, controller.signal);
        else result = await operation(session, provider, 'stat', { fileId: value(url.searchParams, 'fileId') }, controller.signal);
        send(res, result); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/downloads') { send(res, { tasks: downloads.list(session.id) }); return; }
      if (req.method === 'POST' && url.pathname === '/api/downloads') {
        const provider = value(body, 'provider', { max: 30 });
        const fileId = value(body, 'fileId');
        const exportFormat = value(body, 'exportFormat', { max: 100, optional: true });
        const mode = session.mode; const modeSignal = session.modeController.signal;
        const file = await operation(session, provider, 'stat', { fileId }, controller.signal);
        modeSignal.throwIfAborted();
        if (file.kind !== 'file' || !file.downloadable) throw new AppError('NOT_DOWNLOADABLE', '此项目不支持下载', 409);
        let name = file.name;
        if (file.exportFormats?.length) {
          const format = file.exportFormats.find(f => f.id === exportFormat);
          if (!format) throw new AppError('EXPORT_FORMAT_REQUIRED', '请先选择 Google 文档的导出格式');
          const extension = `.${format.extension.replace(/^\./, '')}`;
          if (!name.toLowerCase().endsWith(extension.toLowerCase())) name += extension;
        } else if (exportFormat) throw new AppError('INVALID_EXPORT_FORMAT', '此文件不需要导出格式');
        const task = downloads.add({ owner: session.id, provider, name, mode, run: signal => operation(session, provider, 'download', { fileId, exportFormat }, combine(signal, modeSignal)) });
        send(res, { task }, 202); return;
      }
      const cancelMatch = /^\/api\/downloads\/([a-f0-9-]+)\/cancel$/.exec(url.pathname);
      if (req.method === 'POST' && cancelMatch) { send(res, { task: downloads.cancel(session.id, cancelMatch[1]) }); return; }
      throw new AppError('NOT_FOUND', '接口不存在', 404);
    } catch (error) { const result = publicError(error); send(res, { error: result.error }, result.status); }
    finally { req.off('aborted', abort); res.off('close', abort); }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.maxHeadersCount = 50;
  const cleanup = setInterval(() => {
    for (const session of sessions.values()) if (now() - session.createdAt >= SESSION_TTL || now() - session.touchedAt >= SESSION_TTL) dispose(session);
  }, 60_000).unref();
  return {
    server, downloads,
    get origin() { return origin; },
    async listen() {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
      origin = `http://127.0.0.1:${server.address().port}`;
      try { refreshConfigs(); } catch (error) { await this.close(); throw error; }
      return origin;
    },
    async close() {
      shuttingDown = true; clearInterval(cleanup);
      for (const session of sessions.values()) dispose(session);
      await downloads.close();
      if (server.listening) await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let app;
  try {
    app = await createApp({ port: Number(process.env.PORT || 4318) });
    await app.listen();
    console.log(`DriveOne 已启动：${app.origin}`);
    console.log('仅本机访问 · 授权保存在内存 · 按 Ctrl+C 安全退出');
    for (const name of ['SIGINT', 'SIGTERM']) process.once(name, async () => { await app.close(); process.exit(0); });
  } catch {
    console.error('DriveOne 启动失败：检查端口、Client ID 配置和本地下载目录权限。详细信息不会包含凭据');
    if (app) await app.close();
    process.exitCode = 1;
  }
}
