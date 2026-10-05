import { AppError } from './errors.js';
const DATE = '2026-01-01T08:00:00Z';
const TEXT = 'DriveOne 演示文件\n\n这是一份由本机生成的合成示例，不来自任何真实网盘。\n';
const ENCODED = new TextEncoder().encode(TEXT);
const seeds = [
  ['design', '设计资料', 'folder', 'root'], ['work', '工作文档', 'folder', 'root'],
  ['photos', '灵感图库', 'folder', 'root'],
  ['readme', '欢迎使用 DriveOne.txt', 'file', 'root'],
  ['guide', '产品使用说明.txt', 'file', 'work'], ['roadmap', '项目计划 · 示例.txt', 'file', 'work'],
  ['brand', '品牌规范 · 示例.txt', 'file', 'design'], ['ideas', '灵感记录 · 示例.txt', 'file', 'photos'],
  ['archive', '历史版本', 'folder', 'work'], ['old', '旧版计划 · 示例.txt', 'file', 'archive'],
  ...Array.from({ length: 28 }, (_, i) => [`sample-${i + 1}`, `示例笔记 ${String(i + 1).padStart(2, '0')}.txt`, 'file', 'root']),
];
const files = seeds.map(([id, name, kind, parent]) => ({
  id, name, kind, parent, size: kind === 'folder' ? null : ENCODED.byteLength,
  mimeType: kind === 'folder' ? 'application/vnd.driveone.folder' : 'text/plain',
  modifiedAt: DATE, downloadable: kind === 'file', webUrl: null,
}));
function page(items, cursor = '') {
  let index = 0;
  if (cursor) {
    if (!/^demo:\d+$/.test(cursor)) throw new AppError('INVALID_CURSOR', '演示分页已过期，请刷新');
    index = Number(cursor.slice(5));
    if (!Number.isSafeInteger(index) || index > items.length) throw new AppError('INVALID_CURSOR', '分页无效');
  }
  const sorted = items.toSorted((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name, 'zh-CN', { numeric: true }) : a.kind === 'folder' ? -1 : 1);
  return { items: sorted.slice(index, index + 15).map(({ parent, ...item }) => item), nextCursor: index + 15 < items.length ? `demo:${index + 15}` : null };
}
export function createDemoProvider() {
  return {
    async list({ folderId = 'root', cursor, signal } = {}) {
      signal?.throwIfAborted();
      if (folderId !== 'root' && !files.some(f => f.id === folderId && f.kind === 'folder')) throw new AppError('NOT_FOUND', '演示文件夹不存在', 404);
      return page(files.filter(f => f.parent === folderId), cursor);
    },
    async search({ query, cursor, signal }) {
      signal?.throwIfAborted();
      return page(files.filter(f => f.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())), cursor);
    },
    async stat({ fileId, signal }) {
      signal?.throwIfAborted();
      const file = files.find(f => f.id === fileId);
      if (!file) throw new AppError('NOT_FOUND', '演示文件不存在', 404);
      const { parent, ...item } = file;
      return item;
    },
    async download({ fileId, signal }) {
      const file = await this.stat({ fileId, signal });
      if (!file.downloadable) throw new AppError('NOT_DOWNLOADABLE', '文件夹不能直接下载');
      return { response: new Response(ENCODED, { headers: { 'content-type': 'text/plain; charset=utf-8', 'content-length': String(ENCODED.byteLength) } }), fileName: file.name };
    },
  };
}
