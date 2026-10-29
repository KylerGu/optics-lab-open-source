import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

type Side = 'left' | 'right';
const KEY = 'optics-research-panels-v2';
const DEFAULT = { left: 224, right: 360, leftHidden: false, rightHidden: false };
const MIN = { left: 180, right: 240 };
const MAX = { left: 420, right: 600 };
const COLLAPSE = { left: 120, right: 180 };
function readLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    const oldRight = Number(localStorage.getItem('optics-research-sidebar-width-v1'));
    return { left: Number.isFinite(saved?.left) ? Math.max(MIN.left, Math.min(MAX.left, saved.left)) : DEFAULT.left,
      right: Number.isFinite(saved?.right) ? Math.max(MIN.right, Math.min(MAX.right, saved.right)) : oldRight >= 300 && oldRight <= 600 ? oldRight : DEFAULT.right,
      leftHidden: saved?.leftHidden === true, rightHidden: saved?.rightHidden === true };
  } catch { return DEFAULT; }
}
export function useResearchLayout() {
  const workspace = useRef<HTMLElement>(null);
  const [panels, setPanels] = useState(readLayout);
  const [bounds, setBounds] = useState({ width: 1200, desktop: false });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ side: Side; pointerId: number; x: number; width: number } | null>(null);
  useEffect(() => {
    const root = workspace.current;
    if (!root) return;
    const measure = () => {
      // Hidden workspaces must not overwrite the last usable size.
      if (root.clientWidth) setBounds({ width: root.clientWidth, desktop: window.matchMedia('(min-width: 901px)').matches });
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(root);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(panels)); } catch { /* Optional preference. */ } }, [panels]);
  const budget = Math.max(0, bounds.width - 360 - 18);
  const desiredLeft = panels.leftHidden ? 0 : panels.left;
  const desiredRight = panels.rightHidden ? 0 : panels.right;
  const scale = Math.min(1, budget / Math.max(1, desiredLeft + desiredRight));
  const widths = { left: Math.round(desiredLeft * scale), right: Math.floor(desiredRight * scale) };
  const maximum = (side: Side) => Math.max(MIN[side], Math.min(MAX[side], budget - widths[side === 'left' ? 'right' : 'left']));
  const toggle = (side: Side) => setPanels(p => ({ ...p, [side + 'Hidden']: !p[side === 'left' ? 'leftHidden' : 'rightHidden'] }));
  function adjust(side: Side, value: number) {
    setPanels(p => value < COLLAPSE[side]
      ? { ...p, [side + 'Hidden']: true }
      : { ...p, [side + 'Hidden']: false, [side]: Math.round(Math.max(MIN[side], Math.min(maximum(side), value))) });
  }
  function stop(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function separator(side: Side) {
    const hidden = panels[side === 'left' ? 'leftHidden' : 'rightHidden'];
    return {
      role: 'separator', 'aria-label': side === 'left' ? '调整探究记录栏宽度' : '调整探究材料栏宽度', 'aria-orientation': 'vertical' as const,
      'aria-controls': side === 'left' ? 'research-projects' : 'research-inspector',
      'aria-valuemin': 0, 'aria-valuemax': maximum(side), 'aria-valuenow': widths[side],
      'aria-valuetext': hidden ? '已收起' : `${widths[side]} 像素`, tabIndex: bounds.desktop ? 0 : -1,
      title: '拖动调宽，拖窄可收起；方向键微调，双击恢复默认宽度',
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (!bounds.desktop || event.button !== 0 || drag.current) return;
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { side, pointerId: event.pointerId, x: event.clientX, width: widths[side] }; setDragging(true);
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        const current = drag.current;
        if (current?.pointerId === event.pointerId) adjust(side, current.width + (event.clientX - current.x) * (side === 'left' ? 1 : -1));
      },
      onPointerUp: stop, onPointerCancel: stop,
      onLostPointerCapture: () => { drag.current = null; setDragging(false); },
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        const step = event.shiftKey ? 40 : 20;
        if (event.key === 'Home' || event.key === 'Enter') { event.preventDefault(); toggle(side); }
        else if (event.key === 'End') { event.preventDefault(); adjust(side, maximum(side)); }
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          const delta = (event.key === 'ArrowRight' ? 1 : -1) * (side === 'left' ? 1 : -1) * step;
          adjust(side, hidden && delta > 0 ? MIN[side] : widths[side] === MIN[side] && delta < 0 ? 0 : widths[side] + delta);
        }
      },
      onDoubleClick: () => setPanels(p => ({ ...p, [side]: DEFAULT[side], [side + 'Hidden']: false })),
    };
  }
  return { workspace, dragging, leftHidden: panels.leftHidden, rightHidden: panels.rightHidden, toggle,
    style: { '--rw-projects-width': `${widths.left}px`, '--rw-inspector-width': `${widths.right}px` } as CSSProperties,
    leftSeparator: separator('left'), rightSeparator: separator('right') };
}
