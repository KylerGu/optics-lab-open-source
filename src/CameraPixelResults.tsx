import type {CSSProperties} from 'react';
import type {SceneState} from './sceneRuntime';
import {cameraOptics} from './cameraModel';
import {CAMERA_PIXEL_QUANTITIES} from './cameraPixelQuantities';
import {CameraQuantityLabel} from './CameraRayPresentation';
import SceneValue from './SceneValue';
import MicroscopeDetails from './MicroscopeDetails';

export function CameraPixelResults({state}:{state:SceneState}){
  const o=cameraOptics(state.parameters);
  const values:Record<string,number|null>={airyDiameter:o.airy,diffractionCutoff:o.cutoff,nyquist:o.nyquist};
  return <section className="gs-readouts os-microscope-readouts" aria-label="实时结果">
    <dl>{Object.entries(values).map(([key,value])=>{const q=CAMERA_PIXEL_QUANTITIES[key];return <div key={key} style={{'--quantity-color':q.color} as CSSProperties}>
      <dt>{value===null?q.label:<CameraQuantityLabel quantity={key} label={q.label}/>}</dt>
      <dd data-testid={`camera-metric-${key}`}><SceneValue value={value} unit={key==='airyDiameter'?'μm':'lp/mm'}/></dd>
    </div>;})}</dl>
    <p className="os-camera-field-status">{o.airy===null?'当前物距无有限实像':'按最佳对焦面比较衍射与像素采样'}</p>
    <MicroscopeDetails id="camera-pixel-conditions" title="计算条件"><p>圆边界表示衍射光斑的第一暗环，每格为一个像素。条纹比较光学成像与像素记录；欠采样可能产生假条纹。两项频率上限均不等于实际分辨率，未计入离焦、像差和噪声。</p></MicroscopeDetails>
  </section>;
}
