export class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}
export function publicError(error) {
  const allowed = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,60}$/i.test(error.code);
  // Do not forward network errors, URL strings, provider responses, or file paths.
  if (allowed && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599) {
    return { status: error.status, error: { code: error.code.toUpperCase(), message: error.message } };
  }
  if (error?.name === 'AbortError') return { status: 409, error: { code: 'CANCELLED', message: '操作已取消' } };
  return { status: 500, error: { code: 'INTERNAL_ERROR', message: '操作失败，请重试。凭据和底层响应不会显示在日志中' } };
}
