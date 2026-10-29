import SceneValue from './SceneValue';
import type {CSSProperties} from 'react';
import {ApertureQuantityLabel} from './ApertureAnnotations';
import type {ApertureQuantity} from './apertureQuantities';
import {quantityColor} from './scenePresentation';
import type {SceneResult} from './sceneRuntime';

const rows=[['apertureStop','限制孔径'],['entrancePosition','入瞳位置'],['entranceDiameter','入瞳直径'],['exitPosition','出瞳位置'],['exitDiameter','出瞳直径'],['throughput','通光面积比例'],['v','像距'],['acceptedWidth','可通光宽度']] as const;
export default function ApertureReadouts({result,selected,onToggle}:{result:SceneResult;selected:ReadonlySet<ApertureQuantity>;onToggle:(key:ApertureQuantity)=>void}){
  return <dl className="os-lens-readouts" data-testid="aperture-main-readouts">{rows.map(([key,label])=>{
    const m=result.metrics.find(m=>m.key===key);if(!m)return null;
    return <div key={key} style={{'--quantity-color':quantityColor(key,'aperture')} as CSSProperties}>
      <dt><ApertureQuantityLabel label={label} quantity={key} selected={selected} onToggle={onToggle}/></dt>
      <dd data-testid={`scene-metric-${key}`}>{key==='apertureStop'?(m.value===1?'外置光阑':'透镜口径'):m.value===null&&(key.endsWith('Position')||key==='v')?'无穷远':<SceneValue value={m.value} unit={m.unit}/>}</dd>
    </div>;
  })}</dl>;
}
