import type { ResearchReply } from './researchSession';
import type { ResearchObject } from './researchObjects';
import type { ResearchVisualGuide } from './researchVisual';
import { sameVisualSnapshot, VISUAL_FIELDS } from './researchVisual';

export default function ResearchVisualActions({ reply, objects, disabled, onOpen }: {
  reply: ResearchReply; objects: ResearchObject[]; disabled: boolean;
  onOpen: (object: ResearchObject, guide: ResearchVisualGuide) => void;
}) {
  if (!reply.visualActions?.length) return null;
  const actions = [...new Map(reply.visualActions.map(a => [JSON.stringify([a.objectId, a.elementId, a.kind, a.field, a.screenId]), a])).values()];
  return <div className="rw-visual-actions" aria-label="讲解对应的画面操作">{actions.map((action, i) => {
    const snapshot = reply.objectSnapshots?.find(o => o.id === action.objectId)?.experiment;
    const object = objects.find(o => o.id === action.objectId);
    const element = snapshot?.elements.find(e => e.id === action.elementId);
    const valid = !!snapshot && !!object && sameVisualSnapshot(snapshot, object.experiment);
    const label = action.kind === 'locate' ? `定位${element?.name ?? '器件'}` : `${action.kind === 'compare' ? '前后对照' : '调整'}：${element?.name ?? '器件'} · ${action.field ? VISUAL_FIELDS[action.field] : ''}`;
    return <div key={i}><button disabled={disabled || !valid} onClick={() => { if (valid) onOpen(object!, { action, snapshot: snapshot! }); }}>{label}</button><small>{valid ? action.explanation : '装置已更新或移除，请基于当前装置重新提问。'}</small></div>;
  })}</div>;
}
