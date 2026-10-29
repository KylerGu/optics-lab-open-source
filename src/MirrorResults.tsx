import './mirror-results.css';
import type {CSSProperties} from 'react';
import {SceneCurve} from './SceneDiagram';
import SceneValue from './SceneValue';
import {MirrorQuantityLabel} from './MirrorAnnotations';
import type {MirrorQuantity} from './mirrorQuantities';
import {quantityColor} from './scenePresentation';
import type {SceneResult} from './sceneRuntime';

export default function MirrorResults({result,selected,onToggle}:{result:SceneResult;selected:ReadonlySet<MirrorQuantity>;onToggle:(key:MirrorQuantity)=>void}){
  const trend={...result,chart:{...result.chart,xLabel:'物距 u / mm',yLabel:'像距 v / mm'}};
  return <div className="os-system-results os-lens-results os-mirror-results">
    <section className="gs-readouts os-system-readouts" aria-label="实时结果"><h3>实时结果</h3><dl className="os-lens-readouts">{result.metrics.map(m=><div key={m.key} style={{'--quantity-color':quantityColor(m.key,'mirror')} as CSSProperties}>
      <dt><MirrorQuantityLabel label={m.label} quantity={m.key} selected={selected} onToggle={onToggle}/></dt>
      <dd data-testid={`scene-metric-${m.key}`}>{m.key==='v'&&m.value===null?'无穷远':<SceneValue value={m.value} unit={m.unit}/>}</dd>
    </div>)}</dl></section>
    <section className="os-system-trend" aria-label="参数趋势"><h3>参数趋势</h3><SceneCurve result={trend}/></section>
    {result.warnings.filter(w=>w!=='本图采用近轴球面镜模型；大孔径或大角度的球差未包含。').map(w=><p className="os-warning" key={w}>{w}</p>)}
  </div>;
}
