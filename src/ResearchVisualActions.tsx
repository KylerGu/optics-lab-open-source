import { ArrowUpRight } from 'lucide-react';
import type { ResearchReply } from './researchSession';
import type { ResearchObject } from './researchObjects';
import type { ResearchVisualGuide } from './researchVisual';
import { sameVisualSnapshot, visualActionLabel } from './researchVisual';

export default function ResearchVisualActions({ reply, objects, disabled, onOpen }: {
  reply: ResearchReply;
  objects: ResearchObject[];
  disabled: boolean;
  onOpen: (object: ResearchObject, guide: ResearchVisualGuide) => void;
}) {
  if (!reply.visualActions?.length) return null;
  const actions = [...new Map(reply.visualActions.map(a => [JSON.stringify([a.objectId, a.elementId, a.kind, a.field, a.screenId]), a])).values()];
  return (
    <div className="rw-visual-actions" aria-label="讲解对应的画面操作">
      {actions.map((action, i) => {
        const snapshot = reply.objectSnapshots?.find(o => o.id === action.objectId)?.experiment;
        const object = objects.find(o => o.id === action.objectId);
        const exactMatch = !!snapshot && !!object && sameVisualSnapshot(snapshot, object.experiment);
        const targetStillPresent =
          !!object &&
          object.experiment.elements.some(e => e.id === action.elementId) &&
          (!action.screenId || object.experiment.elements.some(s => s.id === action.screenId && s.kind === 'screen'));
        const canRestoreOriginal = !!snapshot && !!object;
        const { badge, elementName, fieldLabel } = snapshot
          ? visualActionLabel(action, snapshot)
          : { badge: '3D 验证', elementName: '装置', fieldLabel: null };
        return (
          <div key={i} className={`rw-visual-card${!canRestoreOriginal ? ' is-disabled' : !exactMatch ? ' is-updated' : ''}`}>
            <div className="rw-visual-card-top">
              <em className="rw-visual-badge">{badge}</em>
              <strong>{elementName}{fieldLabel ? ` · ${fieldLabel}` : ''}</strong>
            </div>
            <p className="rw-visual-desc">
              {!canRestoreOriginal
                ? '原关联装置已移除，请重新挂载装置后再试。'
                : action.explanation}
            </p>
            <div className="rw-visual-btn-row">
              <button
                type="button"
                className="rw-visual-btn"
                disabled={disabled || !canRestoreOriginal}
                onClick={() => {
                  if (canRestoreOriginal) {
                    onOpen(object!, { action, snapshot: snapshot!, resetToSnapshot: !exactMatch });
                  }
                }}
              >
                <span>
                  {!canRestoreOriginal
                    ? '装置已移除'
                    : !exactMatch
                      ? '按本轮原装置打开验证'
                      : action.kind === 'compare'
                        ? '去光路台拖动验证'
                        : '在光路台定位查看'}
                </span>
                <ArrowUpRight size={14} />
              </button>
              {!exactMatch && targetStillPresent && canRestoreOriginal && (
                <button
                  type="button"
                  className="rw-visual-btn is-secondary"
                  disabled={disabled}
                  onClick={() => onOpen(object!, { action, snapshot: snapshot! })}
                >
                  <span>用当前光路继续</span>
                  <ArrowUpRight size={14} />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
