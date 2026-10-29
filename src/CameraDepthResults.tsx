import type {CSSProperties} from 'react';
import type {SceneState} from './sceneRuntime';
import {cameraOptics} from './cameraModel';
import {CAMERA_DEPTH_QUANTITIES} from './cameraDepthQuantities';
import {CameraQuantityLabel} from './CameraRayPresentation';
import SceneValue from './SceneValue';
import MicroscopeDetails from './MicroscopeDetails';

export function CameraDepthResults({state}:{state:SceneState}){
  const o=cameraOptics(state.parameters);
  const values:Record<string,number|null>={focusDistance:o.focus,nearDepth:o.near,farDepth:o.far,depth:o.near!==null&&o.far!==null?o.far-o.near:null,blurDiameter:o.blur};
  return <section className="gs-readouts os-microscope-readouts" aria-label="实时结果">
    <dl>{Object.entries(values).map(([key,value])=>{const q=CAMERA_DEPTH_QUANTITIES[key];return <div key={key} style={{'--quantity-color':q.color} as CSSProperties}>
      <dt><CameraQuantityLabel quantity={key} label={q.label}/></dt>
      <dd data-testid={`camera-metric-${key}`}>{o.focus!==null&&value===null&&['farDepth','depth'].includes(key)?'∞':<SceneValue value={value} unit="mm"/>}</dd>
    </div>;})}</dl>
    <p className="os-camera-field-status" data-testid="camera-focus-status">{o.focus===null?'当前设置无有限对焦物距':o.acceptable?'当前样品在容许清晰范围内':'当前样品超出容许清晰范围'}</p>
    <MicroscopeDetails id="camera-depth-conditions" title="计算条件"><p>以 c ≤ c₀ 判断清晰范围。移动样品时保持对焦设置不变；下方固定大小的局部样品仅比较离焦模糊，不含衍射与像差。</p></MicroscopeDetails>
  </section>;
}
