/**
 * 列表拖拽排序的纯函数工具（带单元测试：frontend/_smoke_ai_stream.mjs 之外由 _tmp 脚本验证）
 */
export type DropPosition = 'before' | 'after';

/**
 * 把 draggedId 移到 targetId 的前/后，返回新数组（不修改入参）。
 * 找不到拖动项时返回副本；找不到目标项时返回原顺序副本。
 */
export function moveItem<T extends { id: number | string }>(
  list: T[],
  draggedId: number | string,
  targetId: number | string,
  pos: DropPosition,
): T[] {
  const copy = list.slice();
  const from = copy.findIndex((item) => String(item.id) === String(draggedId));
  if (from < 0) return copy;
  const [moved] = copy.splice(from, 1);
  let to = copy.findIndex((item) => String(item.id) === String(targetId));
  if (to < 0) return list.slice();
  if (pos === 'after') to += 1;
  copy.splice(to, 0, moved);
  return copy;
}
