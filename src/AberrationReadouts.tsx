import SceneValue from './SceneValue';
import type {CSSProperties} from 'react';
import {ABERRATION_SYMBOLS,type AberrationQuantity} from './aberrationQuantities';
import SceneQuantityLabel from './SceneQuantityLabel';
import type {SceneResult} from './sceneRuntime';

const labels:Record<string,string>={index:'折射率',thickness:'中心厚度',effectiveFocal:'有效焦距',backFocal:'后焦距',marginalFocus:'边缘焦距',longitudinalSA:'纵向球差',chromaticShift:'红蓝焦距差',rmsRadius:'均方根半径'};
export function AberrationResultLabel({label,quantity,selected,onSelect,fullLabel=label}:{label:string;quantity:AberrationQuantity;selected:AberrationQuantity|null;onSelect:(key:AberrationQuantity|null)=>void;fullLabel?:string}){
  return <button className="os-quantity-toggle" type="button" title={fullLabel} aria-label={`查看${fullLabel}图示`} aria-pressed={selected===quantity} aria-controls={quantity==='rmsRadius'?'aberration-spot-diagram':'aberration-ray-diagram'} onClick={()=>onSelect(selected===quantity?null:quantity)}><SceneQuantityLabel model="aberration" label={label} quantity={quantity}/></button>;
}
export default function AberrationReadouts({result,selected,onSelect,keys}:{result:SceneResult;selected:AberrationQuantity|null;onSelect:(key:AberrationQuantity|null)=>void;keys?:readonly AberrationQuantity[]}){
  return <dl className="os-aberration-readouts">{result.metrics.filter(metric=>(!keys||keys.includes(metric.key as AberrationQuantity))&&(metric.key!=='chromaticShift'||result.input.parameters.mode===1)).map(metric=>{const key=metric.key as AberrationQuantity,color=ABERRATION_SYMBOLS[key].color;return <div key={key} data-selected={selected===key} style={{'--quantity-color':color} as CSSProperties}>
    <dt><AberrationResultLabel label={labels[key]??metric.label} fullLabel={metric.label} quantity={key} selected={selected} onSelect={onSelect}/></dt>
    <dd data-testid={`scene-metric-${key}`}><SceneValue value={metric.value} unit={metric.unit}/></dd>
  </div>;})}</dl>;
}
