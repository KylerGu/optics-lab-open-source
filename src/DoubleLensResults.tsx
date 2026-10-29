import SceneValue from './SceneValue';
import type {CSSProperties} from 'react';
import {SceneCurve} from './SceneDiagram';
import SceneQuantityLabel from './SceneQuantityLabel';
import {DOUBLE_LENS_SYMBOLS,type DoubleLensQuantity} from './doubleLensQuantities';
import {quantityColor} from './scenePresentation';
import {type SceneResult} from './sceneRuntime';

export default function DoubleLensResults({result,selected,onToggle}:{result:SceneResult;selected:ReadonlySet<DoubleLensQuantity>;onToggle:(key:DoubleLensQuantity)=>void}){
  const trend={...result,chart:{...result.chart,xLabel:'透镜间距 d / mm',yLabel:'最终像距 v₂ / mm'}};
  const rows=(keys:string[])=><dl className="os-double-readouts">{result.metrics.filter(m=>keys.includes(m.key)).map(m=>{
    const key=m.key as DoubleLensQuantity,drawable=key in DOUBLE_LENS_SYMBOLS;
    return <div key={m.key} style={{'--quantity-color':quantityColor(m.key,'double-lens')} as CSSProperties}>
      <dt>{drawable?<button className="os-quantity-toggle" type="button" aria-label={`查看${m.label.replace(/ [A-Za-z].*$/,'')}图示`} aria-pressed={selected.has(key)} aria-controls="double-lens-ray-diagram" onClick={()=>onToggle(key)}><SceneQuantityLabel model="double-lens" label={m.label} quantity={m.key}/></button>:<SceneQuantityLabel model="double-lens" label={m.label} quantity={m.key}/>}</dt>
      <dd data-testid={`scene-metric-${m.key}`}>{m.value===null&&['v1','v'].includes(m.key)?'无穷远':m.value===null&&m.key==='equivalentFocal'?'无焦':<SceneValue value={m.value} unit={m.unit}/>}</dd>
    </div>;
  })}</dl>;
  return <div className="os-system-results os-double-results">
    <section className="gs-readouts os-system-readouts" aria-label="实时结果"><h3>实时结果</h3>{rows(['v1','v','m','equivalentFocal'])}
    </section>
    <section className="os-double-trend os-system-trend" aria-label="参数趋势"><h3>参数趋势</h3><SceneCurve result={trend}/></section>
    <details className="os-microscope-details os-system-extra"><summary>光线计算详情</summary>{rows(['matrixB','matrixD'])}<p>B、D 是由物平面到第二片透镜后的光线传递系数，不是两段距离。B 表示入射方向对出射高度的影响，单位 mm；D 表示入射方向对出射方向的影响，没有单位。</p><p>最终像距 v₂ = −B / D；D 为零时，最终像在无穷远。</p></details>
    {result.warnings.map(w=><p className="os-warning" key={w}>{w}</p>)}
  </div>;
}
