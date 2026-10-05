import { randomUUID } from 'node:crypto';
import { mkdir, lstat, realpath, open, unlink, link } from 'node:fs/promises';
import path from 'node:path';
import { AppError, publicError } from './errors.js';

export function safeFileName(input) {
  const source = String(input ?? '').normalize('NFC');
  let name = source.replace(/[<>:"/\\|?*\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069\ufeff]/g, '_').replace(/[. ]+$/g, '').replace(/^\.+/, '_');
  if (!name) name = 'download';
  if (/^(CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³])(?:\.|$)/i.test(name)) name = `_${name}`;
  // Leave room for suffixes and Windows' path/filename limits.
  const ext = path.extname(name).slice(0, 24);
  if (Buffer.byteLength(name, 'utf8') > 180) {
    let base = name.slice(0, name.length - path.extname(name).length);
    while (Buffer.byteLength(base + ext, 'utf8') > 180) base = base.slice(0, -1);
    name = base + ext;
  }
  return name;
}

export async function createDownloadManager({ directory, maxBytes = 20 * 1024 ** 3, concurrency = 2 } = {}) {
  if (!directory) throw new Error('Download directory is required');
  const requested = path.resolve(directory);
  await mkdir(requested, { recursive: true });
  // Refuse a symlink at the configured destination. Resolve its ancestors once.
  if ((await lstat(requested)).isSymbolicLink()) throw new Error('Download directory must not be a symlink');
  const root = await realpath(requested);
  const identity = await lstat(root);
  if (!identity.isDirectory()) throw new Error('Download destination is not a directory');
  const tasks = new Map();
  let running = 0;
  let closed = false;
  const publicTask = task => {
    const { controller, run, owner, providerGeneration, promise, ...publicFields } = task;
    return { ...publicFields };
  };
  async function verifyDirectory() {
    const now = await lstat(requested);
    const resolved = await realpath(requested);
    const canonical = await lstat(root);
    if (now.isSymbolicLink() || resolved !== root || canonical.dev !== identity.dev || canonical.ino !== identity.ino || !canonical.isDirectory()) {
      throw new AppError('UNSAFE_DESTINATION', '下载目录发生变化，请重启应用', 409);
    }
  }
  async function commit(temp, name, signal) {
    await verifyDirectory();
    const ext = path.extname(name);
    const stem = name.slice(0, name.length - ext.length);
    for (let i = 0; i < 1000; i++) {
      signal.throwIfAborted();
      const candidate = i ? `${stem} (${i})${ext}` : name;
      const destination = path.join(root, candidate);
      try {
        // Hard-link creation is atomic and never replaces an existing file or symlink.
        await link(temp, destination);
        if (signal.aborted) {
          await unlink(destination).catch(() => {});
          signal.throwIfAborted();
        }
        return candidate;
      } catch (error) {
        if (error.code === 'EEXIST') continue;
        if (['EPERM', 'EOPNOTSUPP', 'EXDEV', 'ENOTSUP'].includes(error.code)) throw new AppError('ATOMIC_SAVE_UNSUPPORTED', '此磁盘不支持安全原子保存，请使用本地 NTFS/APFS/ext4 下载目录', 409);
        throw error;
      }
    }
    throw new AppError('NAME_CONFLICT', '同名文件过多，请清理下载目录后重试', 409);
  }
  async function execute(task) {
    const signal = task.controller.signal;
    let temp;
    let handle;
    let reader;
    let response;
    task.status = 'running';
    try {
      await verifyDirectory();
      signal.throwIfAborted();
      ({ response } = await task.run(signal));
      signal.throwIfAborted();
      if (response?.status === 206 || response?.headers?.has('content-range')) throw new AppError('PARTIAL_DOWNLOAD', '网盘返回了部分内容，本版不支持断点续传，请重新下载', 502);
      if (!response?.ok || !response.body) throw new AppError('DOWNLOAD_FAILED', '网盘未返回可下载的文件', 502);
      const encoding = response.headers.get('content-encoding')?.trim().toLowerCase();
      // Fetch decompresses transfer representations but retains encoded Content-Length.
      const length = !encoding || encoding === 'identity' ? response.headers.get('content-length') : null;
      const total = length && /^\d+$/.test(length) ? Number(length) : null;
      if (total !== null && (!Number.isSafeInteger(total) || total > maxBytes)) throw new AppError('FILE_TOO_LARGE', '文件超过本机配置的下载大小限制', 413);
      task.totalBytes = total;
      // The provider call is asynchronous; the destination may have changed while it ran.
      await verifyDirectory();
      signal.throwIfAborted();
      temp = path.join(root, `.driveone-${randomUUID()}.part`);
      handle = await open(temp, 'wx', 0o600);
      reader = response.body.getReader();
      const abortReader = () => { reader.cancel().catch(() => {}); };
      signal.addEventListener('abort', abortReader, { once: true });
      try {
        while (true) {
          signal.throwIfAborted();
          const chunk = await reader.read();
          signal.throwIfAborted();
          if (chunk.done) break;
          task.bytesReceived += chunk.value.byteLength;
          if (task.bytesReceived > maxBytes) throw new AppError('FILE_TOO_LARGE', '文件超过本机配置的下载大小限制', 413);
          let offset = 0;
          while (offset < chunk.value.byteLength) {
            const { bytesWritten } = await handle.write(chunk.value, offset, chunk.value.byteLength - offset);
            if (bytesWritten === 0) throw new Error('Short file write');
            offset += bytesWritten;
          }
        }
      } finally {
        signal.removeEventListener('abort', abortReader);
      }
      if (total !== null && total !== task.bytesReceived) throw new AppError('INCOMPLETE_DOWNLOAD', '下载长度不完整，请重试', 502);
      await handle.sync();
      await handle.close();
      handle = null;
      signal.throwIfAborted();
      task.savedName = await commit(temp, task.name, signal);
      task.status = 'complete';
      task.completedAt = new Date().toISOString();
    } catch (error) {
      task.status = signal.aborted ? 'cancelled' : 'error';
      task.error = signal.aborted ? null : publicError(error).error.message;
    } finally {
      if (reader) await reader.cancel().catch(() => {});
      else if (response?.body) await response.body.cancel().catch(() => {});
      if (handle) await handle.close().catch(() => {});
      if (temp) await unlink(temp).catch(() => {});
      task.run = null;
      running--;
      pump();
    }
  }
  function pump() {
    if (closed) return;
    for (const task of tasks.values()) {
      if (running >= concurrency) break;
      if (task.status === 'queued') {
        running++;
        task.status = 'running';
        task.promise = execute(task);
      }
    }
  }
  return {
    directory: root,
    add({ owner, provider, name, run, mode = 'live' }) {
      if (closed) throw new AppError('SHUTTING_DOWN', '应用正在关闭', 503);
      if ([...tasks.values()].filter(t => t.status === 'queued' || t.status === 'running').length >= 50) throw new AppError('QUEUE_FULL', '下载队列已满，请稍后再试', 429);
      const task = { id: randomUUID(), owner, provider, name: safeFileName(name), mode, status: 'queued', bytesReceived: 0, totalBytes: null, error: null, createdAt: new Date().toISOString(), controller: new AbortController(), run };
      tasks.set(task.id, task);
      // Bound retained completed metadata (no token or file content).
      if (tasks.size > 500) for (const [id, old] of tasks) {
        if (tasks.size <= 500) break;
        if (['complete', 'cancelled', 'error'].includes(old.status)) tasks.delete(id);
      }
      pump();
      return publicTask(task);
    },
    list(owner) { return [...tasks.values()].filter(t => t.owner === owner).reverse().map(publicTask); },
    cancel(owner, id) {
      const task = tasks.get(id);
      if (!task || task.owner !== owner) throw new AppError('NOT_FOUND', '下载任务不存在', 404);
      if (['queued', 'running'].includes(task.status)) {
        task.controller.abort();
        if (task.status === 'queued') task.status = 'cancelled';
      }
      return publicTask(task);
    },
    cancelOwner(owner, provider) {
      for (const task of tasks.values()) if (task.owner === owner && (!provider || task.provider === provider)) this.cancel(owner, task.id);
    },
    async idle() { while (running > 0 || [...tasks.values()].some(t => t.status === 'queued')) await Promise.all([...tasks.values()].filter(t => t.promise).map(t => t.promise)); },
    async close() {
      closed = true;
      for (const task of tasks.values()) if (['queued', 'running'].includes(task.status)) {
        task.controller.abort();
        if (task.status === 'queued') task.status = 'cancelled';
      }
      await Promise.all([...tasks.values()].filter(t => t.promise).map(t => t.promise));
      tasks.clear();
    },
  };
}
