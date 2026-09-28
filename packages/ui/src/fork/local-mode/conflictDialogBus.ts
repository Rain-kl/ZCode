/**
 * 冲突弹窗的打开入口（fork 局部实现，不改上游 store）。
 * 状态项与设置页横幅都能用它把用户引导到冲突处理。
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function openForkWebdavConflictDialog(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeForkWebdavConflictDialog(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
