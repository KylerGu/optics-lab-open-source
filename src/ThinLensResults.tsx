import SceneValue from './SceneValue';
import type {CSSProperties} from 'react';
import {SceneCurve} from './SceneDiagram';
import SceneImagePreview from './SceneImagePreview';
import SceneQuantityLabel from './SceneQuantityLabel';
import {THIN_LENS_SYMBOLS,type ThinLensQuantity} from './thinLensQuantities';
import {quantityColor} from './scenePresentation';
import {type SceneResult} from './sceneRuntime';

export default function ThinLensResults({result,selected,onToggle}:{result:SceneResult;selected:ReadonlySet<ThinLensQuantity>;onToggle:(key:ThinLensQuantity)=>void}){
  return <div className="os-system-results os-lens-results">
    <section className="gs-readouts os-system-readouts" aria-label="实时结果"><h3>实时结果</h3><dl className="os-lens-readouts">{result.metrics.filter(m=>m.key!=='f').map(m=>{
      const key=m.key as ThinLensQuantity,drawable=key in THIN_LENS_SYMBOLS;
      return <div key={m.key} style={{'--quantity-color':quantityColor(m.key)} as CSSProperties}>
        <dt>{drawable?<button className="os-quantity-toggle" type="button" aria-label={`查看${m.label.replace(/ [A-Za-z].*$/,'')}图示`} aria-pressed={selected.has(key)} aria-controls="thin-lens-ray-diagram" onClick={()=>onToggle(key)}><SceneQuantityLabel label={m.label} quantity={m.key}/></button>:<SceneQuantityLabel label={m.label} quantity={m.key}/>}</dt>
        <dd data-testid={`scene-metric-${m.key}`}>{m.key==='v'&&m.value===null?'无穷远':<SceneValue value={m.value} unit={m.unit}/>}</dd>
      </div>;
    })}</dl></section>
    <section className="os-lens-trend os-system-trend" aria-label="参数趋势"><h3>参数趋势</h3><SceneCurve result={result}/>{result.imagePreview&&<SceneImagePreview preview={result.imagePreview}/>}</section>
    {result.warnings.filter(w=>w!=='图中光线用于说明理想成像；物体高度相对距离较大时，真实透镜的近轴近似可能失效。').map(w=><p className="os-warning" key={w}>{w}</p>)}
  </div>;
}
