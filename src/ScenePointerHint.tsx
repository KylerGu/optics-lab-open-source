import { Mouse } from 'lucide-react';

export default function ScenePointerHint({ children }: { children: string }) {
  return <span className="gs-pointer-hint"><button type="button" className="gs-pointer-hint-button" aria-label="操作说明"><Mouse size={15} /></button><span className="gs-pointer-tip">{children}</span></span>;
}
