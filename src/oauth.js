import { createHash } from 'node:crypto';

export class OAuthError extends Error {
  constructor(code, status, message) { super(message); this.name = 'OAuthError'; this.code = code; this.status = status; }
  toJSON() { return { code: this.code, status: this.status, message: this.message }; }
}
const fail = (code, status, message) => { throw new OAuthError(code, status, message); };
const SPECS = Object.freeze({
  onedrive: { env: 'ONEDRIVE_CLIENT_ID', scopes: ['Files.Read', 'offline_access'] },
  googledrive: { env: 'GOOGLE_CLIENT_ID', scopes: ['https://www.googleapis.com/auth/drive.readonly'] },
  dropbox: { env: 'DROPBOX_CLIENT_ID', scopes: ['files.metadata.read', 'files.content.read'] },
});
function secret(value, label, max = 32768) {
  if (typeof value !== 'string' || !value || value.length > max || /[\u0000-\u0020\u007f]/u.test(value)) fail('invalid_oauth_input', 400, '授权参数缺失或格式无效。');
  return value;
}
function redirect(value) {
  let url; try { url = new URL(value); } catch { fail('invalid_oauth_config', 500, '请配置有效的本机 OAuth 回调地址。'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || url.username || url.password || url.hash || url.search || !url.port) fail('invalid_oauth_config', 500, 'OAuth 回调地址必须使用本机回环 HTTP 地址和明确端口，且不能包含查询参数。');
  return url.href;
}
function tenantName(value = 'common') {
  if (!['common', 'organizations', 'consumers'].includes(value) && !/^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(value)) fail('invalid_oauth_config', 500, 'ONEDRIVE_TENANT 必须为受支持的租户别名或租户 UUID。');
  return value;
}
function endpoints(provider, tenant) {
  if (provider === 'onedrive') return { authorizeUrl: `https://login.microsoftonline.com/${tenantName(tenant)}/oauth2/v2.0/authorize`, tokenUrl: `https://login.microsoftonline.com/${tenantName(tenant)}/oauth2/v2.0/token` };
  if (provider === 'googledrive') return { authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token' };
  if (provider === 'dropbox') return { authorizeUrl: 'https://www.dropbox.com/oauth2/authorize', tokenUrl: 'https://api.dropboxapi.com/oauth2/token' };
  fail('provider_pending', 409, '此网盘的官方 OAuth 接入暂未开放。');
}
function clientId(provider, value) {
  if (!value) return null;
  // Do not ship borrowed app IDs. These values must come from the operator's env.
  const patterns = { onedrive: /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/, googledrive: /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/, dropbox: /^[A-Za-z0-9_-]{5,128}$/ };
  if (typeof value !== 'string' || value.length > 512 || !patterns[provider]?.test(value)) fail('invalid_oauth_config', 500, 'OAuth 客户端 ID 的配置格式无效。');
  return value;
}
/** Returns only configuration; never creates a registration, grant, or network request. */
export function getOAuthConfig(provider, env = process.env, redirectUri) {
  const spec = Object.hasOwn(SPECS, provider) ? SPECS[provider] : undefined;
  if (!spec) return Object.freeze({ provider, available: false, reason: '等待核实此网盘的官方应用接入与授权条件。', scopes: Object.freeze([]) });
  const id = clientId(provider, env[spec.env]);
  const tenant = provider === 'onedrive' ? tenantName(env.ONEDRIVE_TENANT || 'common') : undefined;
  const uri = redirect(redirectUri);
  const clientSecret = provider === 'googledrive' && env.GOOGLE_CLIENT_SECRET ? secret(env.GOOGLE_CLIENT_SECRET, 'Google client secret', 4096) : undefined;
  return Object.freeze({ provider, available: Boolean(id), reason: id ? '' : `请将 ${spec.env} 配置为你自己注册的应用客户端 ID。`, clientId: id, ...(clientSecret ? { clientSecret } : {}), ...(tenant ? { tenant } : {}), redirectUri: uri, scopes: Object.freeze([...spec.scopes]), ...endpoints(provider, tenant) });
}
function checked(provider, config) {
  const spec = Object.hasOwn(SPECS, provider) ? SPECS[provider] : undefined;
  if (!spec || !config || config.provider !== provider || !config.available) fail('oauth_not_configured', 409, '连接此网盘前，请先配置你自己的 OAuth 应用。');
  const id = clientId(provider, config.clientId);
  if (!id) fail('oauth_not_configured', 409, '连接此网盘前，请先配置你自己的 OAuth 应用。');
  const urls = endpoints(provider, config.tenant);
  if (config.authorizeUrl !== urls.authorizeUrl || config.tokenUrl !== urls.tokenUrl) fail('invalid_oauth_config', 500, '已拦截不受支持的 OAuth 请求目标。');
  return { clientId: id, redirectUri: redirect(config.redirectUri), scopes: spec.scopes, ...urls, ...(provider === 'googledrive' && config.clientSecret ? { clientSecret: secret(config.clientSecret, 'Google client secret', 4096) } : {}) };
}
function verifierValue(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(value)) fail('invalid_pkce', 400, 'PKCE 校验参数无效，请重新发起连接。');
  return value;
}
/** The caller must generate unpredictable state/verifier and validate single-use state. */
export function createAuthorization(provider, config, { state, verifier } = {}) {
  const cfg = checked(provider, config); secret(state, 'OAuth state', 1024);
  if (state.length < 16) fail('invalid_oauth_state', 400, 'OAuth 状态参数必须随机生成且长度至少为 16 个字符。');
  const challenge = createHash('sha256').update(verifierValue(verifier)).digest('base64url');
  const url = new URL(cfg.authorizeUrl);
  const params = { client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: 'code', scope: cfg.scopes.join(' '), state, code_challenge: challenge, code_challenge_method: 'S256' };
  if (provider === 'onedrive') params.response_mode = 'query';
  if (provider === 'googledrive') { params.access_type = 'offline'; params.prompt = 'consent'; }
  if (provider === 'dropbox') params.token_access_type = 'offline';
  url.search = new URLSearchParams(params).toString();
  return url.href;
}
async function tokenRequest(provider, config, params, { fetchImpl = fetch, signal, oldRefreshToken } = {}) {
  const cfg = checked(provider, config);
  const body = new URLSearchParams({ client_id: cfg.clientId, ...params });
  if (cfg.clientSecret) body.set('client_secret', cfg.clientSecret);
  if (provider === 'onedrive') body.set('scope', cfg.scopes.join(' '));
  let response;
  try { response = await fetchImpl(cfg.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: body.toString(), redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer', signal }); }
  catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') fail('request_cancelled', 499, '授权已取消。');
    fail('oauth_network_error', 502, '暂时无法连接授权服务，请稍后重试。');
  }
  if (response.redirected || (response.status >= 300 && response.status < 400)) { try { await response.body?.cancel(); } catch {} fail('unsafe_oauth_redirect', 502, '已拦截授权服务返回的意外跳转。'); }
  if (!response.ok) { try { await response.body?.cancel(); } catch {} fail(response.status === 429 ? 'rate_limited' : 'oauth_exchange_failed', response.status === 429 ? 429 : 401, '暂时无法完成授权，请重新连接账号后重试。'); }
  let data; try { data = await response.json(); } catch { fail('invalid_oauth_response', 502, '授权服务返回的数据格式无效。'); }
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.access_token !== 'string' || !data.access_token || /[\u0000-\u0020\u007f]/u.test(data.access_token) || data.access_token.length > 32768 || (data.token_type && String(data.token_type).toLowerCase() !== 'bearer')) fail('invalid_oauth_response', 502, '授权服务返回的令牌格式无效。');
  const expires = Number(data.expires_in);
  if (!Number.isFinite(expires) || expires <= 0 || expires > 365 * 24 * 60 * 60) fail('invalid_oauth_response', 502, '授权服务返回的令牌有效期无效。');
  const refresh = data.refresh_token === undefined ? oldRefreshToken ?? null : data.refresh_token;
  if (refresh !== null && (typeof refresh !== 'string' || !refresh || refresh.length > 32768 || /[\u0000-\u0020\u007f]/u.test(refresh))) fail('invalid_oauth_response', 502, '授权服务返回的刷新令牌无效。');
  return { accessToken: data.access_token, refreshToken: refresh, expiresAt: Date.now() + Math.floor(expires * 1000) };
}
export async function exchangeCode(provider, config, { code, verifier, fetchImpl = fetch, signal } = {}) {
  const cfg = checked(provider, config);
  return tokenRequest(provider, config, { grant_type: 'authorization_code', code: secret(code, 'Authorization code'), code_verifier: verifierValue(verifier), redirect_uri: cfg.redirectUri }, { fetchImpl, signal });
}
export async function refreshToken(provider, config, { refreshToken: token, fetchImpl = fetch, signal } = {}) {
  return tokenRequest(provider, config, { grant_type: 'refresh_token', refresh_token: secret(token, 'Refresh token') }, { fetchImpl, signal, oldRefreshToken: token });
}
