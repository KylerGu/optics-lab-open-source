import { parseSpatial, type SpatialExperiment } from './builderModel';
import ResearchResults from './ResearchResults';
import type { ResearchArtifact } from './ResearchResults';
import type { ResearchResultRecord } from './researchResultRecords';

const sameSnapshot = (a: SpatialExperiment, b: SpatialExperiment) => JSON.stringify(parseSpatial(a)) === JSON.stringify(parseSpatial(b));
function coversBaseline(analysis: ResearchArtifact, baseline: Extract<ResearchArtifact, {kind: 'simulation'}>) {
  if (analysis.kind === 'simulation' || analysis.kind==='model') return false;
  if (analysis.kind === 'objects') return analysis.data.some(row => row.objectId === baseline.reference.objectId && sameSnapshot(row.inputSnapshot, baseline.input));
  const input = analysis.kind === 'comparison' ? analysis.data.inputSnapshot : analysis.input;
  return analysis.reference.objectId === baseline.reference.objectId && sameSnapshot(input, baseline.input);
}

export default function ResearchRecordResults({ record, selectedArtifactId, onSelectArtifact, onOpenBuilder }: {
  record: ResearchResultRecord;
  selectedArtifactId: string;
  onSelectArtifact: (id: string) => void;
  onOpenBuilder: (input: SpatialExperiment) => void;
}) {
  const selected = record.artifacts.find(a => a.id === selectedArtifactId) ?? record.artifacts.find(a => a.id === record.primaryId)!;
  // Baseline measurements remain in the data, without becoming a duplicate result entry.
  const options = record.artifacts.filter(a => a.kind !== 'simulation' || a.id === selected.id || !record.artifacts.some(other => coversBaseline(other, a)));
  const baseline = selected.kind === 'comparison' ? record.artifacts.find(a => a.kind === 'simulation' && coversBaseline(selected, a)) : undefined;
  return <>
    {options.length > 1 && <div className="rw-chart-controls"><label>查看结果<select aria-label="查看探究结果" value={selected.id} onChange={event => onSelectArtifact(event.target.value)}>{options.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}</select></label></div>}
    <ResearchResults key={selected.id} artifact={selected} baseline={baseline?.kind === 'simulation' ? baseline.data : undefined} onOpenBuilder={onOpenBuilder}/>
  </>;
}
