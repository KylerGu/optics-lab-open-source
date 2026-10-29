import { useEffect, useRef, useState, type RefObject, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';

const WIDTH_KEY = 'optics-gaussian-panel-width:v1';
const MIN_WIDTH = 280;

export function useGaussianPanelWidth(container: RefObject<HTMLDivElement | null>, spotOpen: boolean) {
  const [preferredWidth, setPreferredWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY));
      if (Number.isFinite(saved) && saved >= MIN_WIDTH) return Math.min(480, saved);
    } catch { /* Layout preferences are optional. */ }
    return 320;
  });
  const [maxWidth, setMaxWidth] = useState(480);
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const width = Math.min(preferredWidth, maxWidth);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const measure = () => {
      const spotWidth = el.querySelector('.gs-spot')?.getBoundingClientRect().width ?? 0;
      setMaxWidth(Math.max(MIN_WIDTH, Math.min(480, el.clientWidth - spotWidth - 376)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [container, spotOpen]);

  useEffect(() => {
    try { localStorage.setItem(WIDTH_KEY, String(preferredWidth)); } catch { /* A full store does not prevent resizing. */ }
  }, [preferredWidth]);

  const adjust = (next: number) => setPreferredWidth(Math.min(maxWidth, Math.max(MIN_WIDTH, Math.round(next))));
  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return { width, resizing, separator: {
    role: 'separator', tabIndex: 0, 'aria-label': '调整左侧参数面板宽度', 'aria-orientation': 'vertical' as const,
    'aria-valuemin': MIN_WIDTH, 'aria-valuemax': Math.round(maxWidth), 'aria-valuenow': Math.round(width),
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus();
      drag.current = { pointerId: event.pointerId, x: event.clientX, width };
      event.currentTarget.setPointerCapture(event.pointerId);
      setResizing(true);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (drag.current?.pointerId === event.pointerId) adjust(drag.current.width + event.clientX - drag.current.x);
    },
    onPointerUp: finish, onPointerCancel: finish, onLostPointerCapture: finish,
    onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      adjust(event.key === 'Home' ? MIN_WIDTH : event.key === 'End' ? maxWidth : width + (event.key === 'ArrowRight' ? 16 : -16));
    },
  } };
}
