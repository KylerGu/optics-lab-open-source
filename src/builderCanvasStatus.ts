export type BuilderSimulationStatus = 'idle' | 'pending' | 'ready' | 'error';

export function builderCanvasStatus(run: boolean, manualEditing: boolean, status: BuilderSimulationStatus, pendingVisible: boolean) {
  if (!run) return { visible: null as string | null, live: '' };
  if (manualEditing) return { visible: '松开后更新', live: '松开后更新' };
  if (status === 'error') return { visible: '计算未完成', live: '计算未完成' };
  if (status === 'idle') return { visible: '请添加光源', live: '请添加光源' };
  if (status === 'pending') {
    const text = pendingVisible ? '计算中…' : '';
    return { visible: text || null, live: text };
  }
  return { visible: null, live: '光路已更新' };
}
