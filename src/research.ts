import { parseExperiment, type Experiment } from './model';
import { experimentKey } from './simulation';

export interface FocusGoal {
  lensId: string; screenId: string; screenPositionMm: number;
  positionRange: {start: number; stop: number}; focalRange: {start: number; stop: number};
}
export interface DesignRow {
  positionMm: number; focalLengthMm: number; phase: 'coarse' | 'refined' | 'baseline';
  radiusMm: number | null; capturedFraction: number | null; quality: 'within-model' | 'reference-only' | null;
  warnings: string[]; error: string | null;
}
export interface FocusDesign {
  id: string; createdAt: string; searchVersion: string; modelVersion: string; inputSnapshot: Experiment;
  goal: FocusGoal; objective: 'minimize_screen_1e2_radius'; units: {length: 'mm'; radius: 'mm'};
  method: string; limitations: string[]; baseline: DesignRow;
  grids: {phase: 'coarse' | 'refined'; positionsMm: number[]; focalsMm: number[]}[];
  rows: DesignRow[]; counts: {total: number; withinModel: number; referenceOnly: number; invalid: number};
  recommendation: (DesignRow & {experiment: Experiment; verified: true; boundaryParameters: string[]; improvementFraction: number | null}) | null;
  noRecommendationReason: string | null;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item=>typeof item==='string');
function fail(): never {throw new Error('自动设计数据未通过核对，请重新搜索。');}

export function designExperiment(design: FocusDesign, row: DesignRow): Experiment {
  return parseExperiment({...design.inputSnapshot, elements: design.inputSnapshot.elements.map(element=>element.id===design.goal.lensId ? {...element,positionMm:row.positionMm,focalLengthMm:row.focalLengthMm} : element.id===design.goal.screenId ? {...element,positionMm:design.goal.screenPositionMm} : element)});
}

export function validateFocusDesign(value: unknown, snapshotKey?: string): FocusDesign {
  if(!record(value) || typeof value.id!=='string' || !value.id || typeof value.createdAt!=='string' || !Number.isFinite(Date.parse(value.createdAt)) || value.searchVersion!=='single-lens-screen-grid/1.0' || typeof value.modelVersion!=='string' || value.objective!=='minimize_screen_1e2_radius' || !record(value.units) || value.units.length!=='mm' || value.units.radius!=='mm' || typeof value.method!=='string' || !strings(value.limitations)) fail();
  const original=parseExperiment(value.inputSnapshot);
  if(snapshotKey && experimentKey(original)!==snapshotKey) fail();
  const goal=value.goal;
  if(!record(goal) || typeof goal.lensId!=='string' || typeof goal.screenId!=='string' || !finite(goal.screenPositionMm) || goal.screenPositionMm<=0 || goal.screenPositionMm>600 || !record(goal.positionRange) || !record(goal.focalRange)) fail();
  for(const bounds of [goal.positionRange,goal.focalRange]) if(!finite(bounds.start) || !finite(bounds.stop) || bounds.start>=bounds.stop) fail();
  if((goal.positionRange.start as number)<0 || (goal.positionRange.stop as number)>=goal.screenPositionMm || (goal.focalRange.start as number)<1 || (goal.focalRange.stop as number)>5000) fail();
  const lenses=original.elements.filter(item=>item.kind==='lens'), source=original.elements.find(item=>item.kind==='laser');
  if(lenses.length!==1 || lenses[0].id!==goal.lensId || !source || (goal.positionRange.start as number)<=source.positionMm || !original.elements.some(item=>item.kind==='screen' && item.id===goal.screenId)) fail();
  function rowCheck(row: unknown) {
    if(!record(row) || !finite(row.positionMm) || !finite(row.focalLengthMm) || !['baseline','coarse','refined'].includes(row.phase as string) || !strings(row.warnings)) fail();
    if(row.error===null) {
      if(!finite(row.radiusMm) || row.radiusMm<=0 || !finite(row.capturedFraction) || row.capturedFraction<0 || row.capturedFraction>1 || !['within-model','reference-only'].includes(row.quality as string) || (row.quality==='within-model' && row.warnings.length!==0)) fail();
    } else if(typeof row.error!=='string' || row.radiusMm!==null || row.capturedFraction!==null || row.quality!==null) fail();
  }
  rowCheck(value.baseline);
  if((value.baseline as DesignRow).phase!=='baseline' || (value.baseline as DesignRow).positionMm!==lenses[0].positionMm || (value.baseline as DesignRow).focalLengthMm!==lenses[0].focalLengthMm) fail();
  if(!Array.isArray(value.grids) || value.grids.length<1 || value.grids.length>2 || !Array.isArray(value.rows) || value.rows.length!==441*value.grids.length) fail();
  let offset=0;
  for(const [index,grid] of value.grids.entries()) {
    if(!record(grid) || grid.phase!==(index===0?'coarse':'refined')) fail();
    for(const [axis,bounds] of [[grid.positionsMm,goal.positionRange],[grid.focalsMm,goal.focalRange]] as const) {
      if(!Array.isArray(axis) || axis.length!==21 || !axis.every(finite) || axis.some((n,i)=>n<(bounds.start as number) || n>(bounds.stop as number) || (i>0 && n<=axis[i-1]))) fail();
      if(index===0 && (axis[0]!==bounds.start || axis[20]!==bounds.stop)) fail();
    }
    for(const focal of grid.focalsMm as number[]) for(const position of grid.positionsMm as number[]) {
      const row=value.rows[offset++]; rowCheck(row);
      if(row.phase!==grid.phase || row.positionMm!==position || row.focalLengthMm!==focal) fail();
    }
  }
  const rows=value.rows as DesignRow[], valid=rows.filter(row=>row.quality==='within-model');
  if(!record(value.counts) || value.counts.total!==rows.length || value.counts.withinModel!==valid.length || value.counts.referenceOnly!==rows.filter(row=>row.quality==='reference-only').length || value.counts.invalid!==rows.filter(row=>row.error!==null).length) fail();
  const design={...value,inputSnapshot:original} as unknown as FocusDesign;
  if(value.recommendation===null) {if(valid.length || typeof value.noRecommendationReason!=='string') fail();}
  else {
    const best=value.recommendation; rowCheck(best);
    if(!record(best) || best.verified!==true || best.quality!=='within-model' || !strings(best.boundaryParameters) || value.noRecommendationReason!==null || !valid.some(row=>row.positionMm===best.positionMm && row.focalLengthMm===best.focalLengthMm && row.radiusMm===best.radiusMm) || valid.some(row=>row.radiusMm!<(best.radiusMm as number))) fail();
    if(experimentKey(parseExperiment(best.experiment))!==experimentKey(designExperiment(design,best as unknown as DesignRow))) fail();
    const baseline=design.baseline, expected=baseline.quality==='within-model' && baseline.radiusMm ? 1-(best.radiusMm as number)/baseline.radiusMm : null;
    if(expected===null ? best.improvementFraction!==null : !finite(best.improvementFraction) || Math.abs(best.improvementFraction-expected)>1e-12) fail();
  }
  return design;
}

export function designCSV(design: FocusDesign): string {
  const cell=(value: string | number)=>`"${String(value).replace(/"/g,'""')}"`;
  const safe=(value: string)=>/^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  const rows: (string | number)[][]=[['design_id',design.id],['created_at',design.createdAt],['search_version',design.searchVersion],['model_version',design.modelVersion],['objective',design.objective],['radius_definition','1/e^2 intensity radius'],['length_unit','mm'],['method',safe(design.method)],['limitations',safe(design.limitations.join(' | '))],['goal_json',JSON.stringify(design.goal)],['input_snapshot_json',JSON.stringify(design.inputSnapshot)],['baseline_json',JSON.stringify(design.baseline)],['recommendation_json',JSON.stringify(design.recommendation)],['phase','lens_position_mm','focal_length_mm','screen_radius_mm','captured_fraction','quality','warnings','error'],...design.rows.map(row=>[row.phase,row.positionMm,row.focalLengthMm,row.radiusMm??'',row.capturedFraction??'',row.quality??'',safe(row.warnings.join(' | ')),safe(row.error??'')])];
  return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
}

export function downloadDesign(design: FocusDesign, format: 'json' | 'csv') {
  const url=URL.createObjectURL(new Blob([format==='json' ? JSON.stringify(design,null,2) : designCSV(design)],{type:format==='json'?'application/json':'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=`单透镜自动设计.${format}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
