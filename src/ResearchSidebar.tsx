import { ArrowUpRight, BarChart3, Check, ChevronRight } from 'lucide-react';
import type { ResearchArtifact } from './ResearchResults';
import type { ResearchEvidenceRef, ResearchPlanStep } from './researchPlan';
import type { ResearchResultRecord } from './researchResultRecords';

export function ResearchPlanList({ plan, hasProgress, artifacts, onSelect }: {
  plan: ResearchPlanStep[]; hasProgress: boolean; artifacts: ResearchArtifact[]; onSelect: (id: string) => void;
}) {
  return <ol className="rw-plan">{plan.map((step, i) => {
    const records = step.evidence.flatMap(ref => {
      const result = artifacts.find(a => Object.entries(ref).every(([k, v]) => a.reference[k as keyof ResearchEvidenceRef] === v));
      return result ? [result] : [];
    });
    const status = !hasProgress ? '进度未记录' : step.status === 'completed' ? '已完成' : step.status === 'needs_validation' ? '待验证' : '待开展';
    return <li key={i} className={`rw-plan-${step.status}`}>
      <span>{hasProgress && step.status === 'completed' ? <Check size={12}/> : i + 1}</span>
      <div>{step.text.length > 24 || records.length ? <details className="rw-plan-task">
        <summary><span>{step.text}</span></summary>
        {records.map(record => <button key={record.id} className="rw-text-button rw-plan-evidence" onClick={() => onSelect(record.id)}>查看结果<ArrowUpRight size={13}/></button>)}
      </details> : <p>{step.text}</p>}<small className="rw-plan-status">{status}</small></div>
    </li>;
  })}</ol>;
}

export function ResearchRecordList({ records, onSelect }: { records: ResearchResultRecord[]; onSelect: (id: string) => void }) {
  return <div className="rw-records">{[...records].reverse().map(record => <button key={record.id} onClick={() => onSelect(record.id)}>
    <BarChart3 size={17}/><span><strong>{record.title}</strong></span><ChevronRight size={15}/>
  </button>)}</div>;
}
