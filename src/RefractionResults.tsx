import type {CSSProperties} from 'react';
import SceneValue from './SceneValue';
import {SceneCurve} from './SceneDiagram';
import {RefractionQuantityLabel} from './RefractionAnnotations';
import {quantityColor} from './scenePresentation';
import type {RefractionQuantity} from './refractionQuantities';
import type {SceneResult} from './sceneRuntime';
import './refraction-results.css';

const labels:Record<string,string>={reflectedAngle:'反射角',transmittedAngle:'折射角',criticalAngle:'临界角',R:'反射功率比例',T:'透射功率比例',r1:'第一面折射角',r2:'第二面入射角',exitAngle:'第二面出射角',deviation:'有向偏折角',minimumDeviation:'对称光路偏折'};
export default function RefractionResults({result,selected,onToggle}:{result:SceneResult;selected:ReadonlySet<RefractionQuantity>;onToggle:(key:RefractionQuantity)=>void}){
  const trend={...result,chart:{...result.chart,xLabel:result.model==='prism'?'第一面入射角 i / °':'入射角 θᵢ / °',yLabel:result.model==='prism'?'有向偏折角 δ / °':result.chart.yLabel}};
  return <div className="os-system-results os-lens-results os-refraction-results">
    <section className="gs-readouts os-system-readouts" aria-label="实时结果"><h3>实时结果</h3><dl className="os-lens-readouts">{result.metrics.map(m=><div key={m.key} style={{'--quantity-color':quantityColor(m.key,result.model)} as CSSProperties}>
      <dt><RefractionQuantityLabel label={labels[m.key]??m.label} quantity={m.key} result={result} selected={selected} onToggle={onToggle}/></dt>
      <dd data-testid={`scene-metric-${m.key}`}><SceneValue value={m.value} unit={m.unit}/></dd>
    </div>)}</dl></section>
    <section className="os-system-trend os-refraction-trend" aria-label="参数趋势"><h3>参数趋势</h3><SceneCurve result={trend}/></section>
    {result.warnings.map(w=><p className="os-warning" key={w}>{w}</p>)}
  </div>;
}
