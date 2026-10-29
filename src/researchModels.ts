import { parseScene, sceneKey, SCENE_DEFINITIONS, type SceneState, type SceneMetric } from './sceneRuntime';
import { validateSceneReply, type Evidence } from './sceneAssistantModel';
import { patchSceneParameters } from './microscopeFocus';

const models = new Set(['wave-superposition', 'young-double-slit', 'michelson', 'film-interference', 'microscope', 'camera', 'telescope']);
export interface ResearchModelInput { id: string; state: SceneState }
export interface ResearchModelResult extends ResearchModelInput {
  evidence: Evidence & { modelVersion: string; curve: {x:number;y:number|null}[]; chart: {xLabel:string;yLabel:string} };
  scans: {field:string;rows:{value:number;result:Evidence}[]}[];
  limits: string; defaultParameters: string[];
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= max;

export function validateResearchModels(value: unknown): ResearchModelResult[] {
  if (!Array.isArray(value) || value.length > 3) throw new Error('模型实验记录无效。');
  const ids = new Set<string>();
  return value.map(raw => {
    if (!record(raw) || !text(raw.id,100) || ids.has(raw.id)) throw new Error('模型实验编号重复或无效。');
    ids.add(raw.id);
    const state = parseScene(raw.state), definition = SCENE_DEFINITIONS[state.sceneId];
    if (!models.has(definition.model)) throw new Error('此模型尚未接入实验探究工作区。');
    const reply = validateSceneReply({requestId:raw.id,inputSnapshot:state,state,changed:false,answer:'模型计算',evidence:raw.evidence,scans:raw.scans},raw.id,state);
    const check = (evidence: Evidence, expected:SceneState) => {
      if (sceneKey(parseScene(evidence.input)) !== sceneKey(expected) || !evidence.metrics.length || evidence.metrics.length > 100 || !Array.isArray(evidence.warnings) || evidence.warnings.length > 100 || evidence.warnings.some(w=>!text(w,2000)) || !text(evidence.scope,10000)) throw new Error('模型读数与计算条件不一致。');
      const keys = new Set<string>();
      for (const metric of evidence.metrics) {
        if (!text(metric.key,100) || keys.has(metric.key) || !text(metric.label,200) || typeof metric.unit!=='string' || metric.unit.length>100 || typeof metric.note!=='string' || metric.note.length>2000) throw new Error('模型读数定义无效。');
        keys.add(metric.key);
      }
    };
    if (!reply.evidence) throw new Error('模型实验缺少实际计算结果。');
    check(reply.evidence,state);
    for (const scan of reply.scans) {
      if (!definition.parameters.some(p=>p.key===scan.field) || scan.rows.length<2) throw new Error('模型扫描参数无效。');
      for (const row of scan.rows) {
        const expected = parseScene(patchSceneParameters(state,{[scan.field]:row.value}));
        check(row.result,expected);
        if (JSON.stringify(row.result.metrics.map(m=>[m.key,m.unit]))!==JSON.stringify(reply.evidence.metrics.map(m=>[m.key,m.unit]))) throw new Error('模型扫描的指标不一致。');
      }
    }
    const evidence = raw.evidence;
    if (!record(evidence) || !text(evidence.modelVersion,100) || !Array.isArray(evidence.curve) || evidence.curve.length>6000 || !record(evidence.chart) || !text(evidence.chart.xLabel,200) || !text(evidence.chart.yLabel,200) || !text(raw.limits,4000) || !Array.isArray(raw.defaultParameters) || new Set(raw.defaultParameters).size!==raw.defaultParameters.length || raw.defaultParameters.some(key=>!definition.parameters.some(p=>p.key===key))) throw new Error('模型曲线或适用范围无效。');
    const curve = evidence.curve.map(point=>{
      if (!record(point) || typeof point.x!=='number' || !Number.isFinite(point.x) || !(point.y===null || typeof point.y==='number' && Number.isFinite(point.y))) throw new Error('模型曲线读数无效。');
      return {x:point.x,y:point.y};
    });
    return {id:raw.id,state,evidence:{...reply.evidence,modelVersion:evidence.modelVersion,curve,chart:{xLabel:evidence.chart.xLabel,yLabel:evidence.chart.yLabel}},scans:reply.scans,limits:raw.limits,defaultParameters:raw.defaultParameters as string[]};
  });
}

export function researchModelInputs(turns: {reply: {modelResults?:ResearchModelResult[]}|null}[]): ResearchModelInput[] {
  const results = new Map<string,ResearchModelInput>();
  for (const turn of [...turns].reverse()) for (const model of [...(turn.reply?.modelResults??[])].reverse()) {
    if (!results.has(model.id)) results.set(model.id,{id:model.id,state:structuredClone(model.state)});
    if (results.size>=6) return [...results.values()];
  }
  return [...results.values()];
}

export const modelMetricLabel = (metric: SceneMetric) => metric.label + (metric.unit ? ' / ' + metric.unit : '');
