import { MICROSCOPE_QUANTITIES } from './microscopeQuantities';
import { SCENE_DEFINITIONS, numberText } from './sceneRuntime';
import type { Evidence, SceneReply } from './sceneAssistantModel';
import {geometricalSymbol,supportsGeometricalInteraction} from './geometricalAnswerQuantities';

type Scan = SceneReply['scans'][number];
export interface ComparisonColumn {
  key: string;
  label: string;
  unit: string;
  value: (result: Evidence) => number | null;
  format?: (value: number | null, result: Evidence) => string;
}

const reading = (result: Evidence, key: string) => result.metrics.find(m => m.key === key)?.value ?? null;
const hasRealFinalImage = (result: Evidence) => (reading(result, 'v') ?? 0) > 0;
const symbols: Record<string, string> = {
  ...Object.fromEntries(Object.entries(MICROSCOPE_QUANTITIES).map(([key, value]) => [key, value.symbol])),
  near: 'D', fieldNumber: 'FN', adapter: 'a', sensorW: 'wₛ', sensorH: 'hₛ', displayWidth: 'Wₛ',
};

export function comparisonParameter(scan: Scan) {
  const state = scan.rows[0]?.result.input;
  const parameter = state && SCENE_DEFINITIONS[state.sceneId].parameters.find(p => p.key === scan.field);
  let label = parameter?.label ?? scan.field;
  const symbol = state?.sceneId === 'instruments-0' ? symbols[scan.field] : state?geometricalSymbol(SCENE_DEFINITIONS[state.sceneId].model,scan.field):undefined;
  if (symbol && !label.endsWith(' ' + symbol)) label = label.replace(/\s+[|A-Za-zλθΔβη].*$/u,'')+' '+symbol;
  return { label, unit: parameter?.unit ?? '' };
}

export function comparisonColumns(scan: Scan): ComparisonColumn[] {
  const first = scan.rows[0]?.result;
  if (!first) return [];
  if (!scan.rows.every(row => row.result.input.sceneId === 'instruments-0')) {
    if(supportsGeometricalInteraction(first.input.sceneId))return geometricalColumns(scan);
    return first.metrics.map(m => ({ ...m, value: (result: Evidence) => reading(result, m.key) }));
  }

  const columns = new Map<string, ComparisonColumn>();
  const add = (key: string, label: string, unit: string, magnitude = false) => {
    if (key === scan.field) return; // The varied quantity already appears in the first column.
    columns.set(key, {
      key, label, unit,
      value: result => {
        // A real final image uses linear magnification, not angular magnification.
        if (key === 'm' && !hasRealFinalImage(result)) return null;
        const value = reading(result, key);
        return magnitude && value !== null ? Math.abs(value) : value;
      },
      ...(key === 'v' || key === 'v1' ? { format: (value: number | null, result: Evidence) => value === null && result.metrics.some(m => m.key === key) ? '∞' : numberText(value) } : {}),
    });
  };
  for (const { result } of scan.rows) {
    const { study, mode } = result.input.parameters;
    if (study === 1) {
      add('resolution', '横向分辨率 rₓᵧ', 'µm');
      add('separation', '两点间距 s', 'µm');
    } else if (study === 3) {
      add('depth', '景深 DOF', 'µm');
    } else if (mode === 1) {
      add('cameraM', '相机光学放大倍数 |M|', '倍', true);
      if (study === 2) {
        add('fieldWidth', '水平视场 W', 'mm');
        add('fieldHeight', '垂直视场 H', 'mm');
      } else {
        add('v', '最佳像面距管镜 v₂', 'mm');
        add('focusOffset', '物体离焦量 Δu', 'mm');
      }
    } else {
      if (study === 0) {
        add('v1', '中间像距 v₁', 'mm');
        add('v', '距目镜的像距 v₂', 'mm');
      }
      if (reading(result, 'angularM') !== null || !hasRealFinalImage(result)) {
        add('angularM', '目视放大倍数 |M|', '倍', true);
      }
      if (hasRealFinalImage(result)) add('m', '投影尺寸放大倍数 |m|', '倍', true);
      if (study === 2) add('fieldDiameter', '目视视野直径 D', 'mm');
    }
  }
  return [...columns.values()];
}

function geometricalColumns(scan:Scan):ComparisonColumn[]{
  const columns=new Map<string,ComparisonColumn>();
  for(const {result} of scan.rows){
    const {model}=SCENE_DEFINITIONS[result.input.sceneId],p=result.input.parameters;
    const keys=model==='interface'?['transmittedAngle','criticalAngle','R']
      :model==='prism'?['exitAngle','deviation']
      :model==='lens'||model==='mirror'?['v','m','imageHeight']
      :model==='double-lens'?['v1','v','m']
      :model==='aperture'?['entranceDiameter','exitDiameter','throughput']
      :model==='aberration'?['longitudinalSA',...(p.mode===1?['chromaticShift']:[]),'rmsRadius']
      :model==='camera'?[['v','blurDiameter','m'],['fieldWidth','fieldHeight','blurDiameter'],['nearDepth','farDepth','depth'],['airyDiameter','nyquist','objectPixel']][p.study]
      :model==='telescope'?[['angularM','centralAngle','angularSpread'],['angularM','visibleField'],['resolution','starSeparation'],['pupilDiameter','pupilPosition','acceptedLight']][p.study]:[];
    for(const key of keys){
      if(key===scan.field)continue;
      const metric=result.metrics.find(m=>m.key===key),parameter=SCENE_DEFINITIONS[result.input.sceneId].parameters.find(f=>f.key===key);
      if(!metric&&!parameter)continue;
      const magnitude=key==='angularM',symbol=geometricalSymbol(model,key);
      let label=magnitude?'目视放大倍数 |M|':metric?.label??parameter!.label;
      if(symbol&&!magnitude&&!label.endsWith(' '+symbol))label+=' '+symbol;
      columns.set(key,{key,label,unit:metric?.unit??parameter!.unit,value:r=>{
        const value=r.metrics.some(m=>m.key===key)?reading(r,key):r.input.parameters[key]??null;
        return magnitude&&value!==null?Math.abs(value):value;
      },format:(value,r)=>value===null&&model==='camera'&&['depth','farDepth'].includes(key)&&reading(r,'focusDistance')!==null?'∞':numberText(value)});
    }
  }
  return [...columns.values()];
}
