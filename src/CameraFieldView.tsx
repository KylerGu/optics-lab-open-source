import {useId,type CSSProperties} from 'react';
import type {SceneState} from './sceneRuntime';
import {cameraOptics} from './cameraModel';
import {CAMERA_FIELD_QUANTITIES} from './cameraFieldQuantities';
import {CameraQuantityLabel,useCameraPresentation} from './CameraRayPresentation';
import SceneValue,{displayNumber as numberText} from './SceneValue';
import MicroscopeDetails from './MicroscopeDetails';
import {quantityColor} from './scenePresentation';

export function CameraFieldSwitch({onReset}:{onReset:()=>void}){
  const c=useCameraPresentation();if(!c)return null;
  return <div className="os-camera-field-heading" onPointerDown={e=>e.stopPropagation()}>
    <h3>{c.fieldMode==='sample'?'原始样品与取景范围':'感光面图像（倒像）'}</h3>
    <div className="os-microscope-presentation" role="group" aria-label="相机取景观察方式">
      {([['sensor','感光面图像'],['sample','原始样品']] as const).map(([mode,label])=><button type="button" key={mode} aria-pressed={c.fieldMode===mode} onClick={()=>{if(c.fieldMode!==mode){c.setFieldMode(mode);onReset();}}}>{label}</button>)}
    </div>
  </div>;
}

export function CameraFieldResults({state}:{state:SceneState}){
  const p=state.parameters,o=cameraOptics(p),focused=o.v!==null&&o.v>0&&o.blur<1e-8;
  const values:Record<string,number>={fieldWidth:o.fieldWidth,fieldHeight:o.fieldHeight};
  return <section className="gs-readouts os-microscope-readouts os-camera-field-results" aria-label="实时结果">
    <dl>{Object.entries(values).map(([key,value])=>{const q=CAMERA_FIELD_QUANTITIES[key];return <div key={key} style={{'--quantity-color':q.color} as CSSProperties}>
      <dt><CameraQuantityLabel quantity={key} label={q.label}/></dt>
      <dd data-testid={`camera-metric-${key}`}><SceneValue value={value} unit="mm"/></dd>
    </div>;})}</dl>
    <p className="os-camera-field-status" data-testid="camera-focus-status">{focused?'已对焦 · 感光面形成倒像':'当前离焦 · 仅示意投影范围'}</p>
    <MicroscopeDetails id="camera-field-conditions" title="计算条件"><p>绿框中的样品和背景对应感光面图像。两种视图分别缩放；已对焦时调节焦距或物距会跟随对焦，离焦时仅示意投影范围。</p></MicroscopeDetails>
  </section>;
}

// The same F target is projected with a negative scale on both axes.
// Its physical height is h; the origin stays on the optical axis.
export function CameraFieldSample({height}:{height:number}){
  return <path data-testid="camera-field-sample" d={`M${-height*.28} 0V${-height}H${height*.32}V${-height*.8}H${-height*.08}V${-height*.6}H${height*.22}V${-height*.4}H${-height*.08}V0Z`} fill="#e8c594"/>;
}

// The grid belongs to the sample plane: one cell is 10 mm in object space.
// Projecting the same grid makes the selected region recognizable in both views.
export function CameraFieldBackdrop({x,y,width,height,scale}:{x:number;y:number;width:number;height:number;scale:number}){
  const id=useId().replace(/:/g,''),cell=10*scale,cx=x+width/2,cy=y+height/2;
  return <g data-testid="camera-field-backdrop" data-grid-spacing={cell}>
    <defs><pattern id={`${id}-grid`} x={cx} y={cy} width={cell} height={cell} patternUnits="userSpaceOnUse"><path d={`M${cell} 0H0V${cell}`} fill="none" stroke="#7697b0" strokeOpacity={.16} strokeWidth={.8}/></pattern></defs>
    <rect x={x-18} y={y-18} width={width+36} height={height+36} rx={10} fill="#10213b"/>
    <rect x={x} y={y} width={width} height={height} fill="#193754"/>
    <rect x={x} y={y} width={width} height={height} fill={`url(#${id}-grid)`}/>
    <path d={`M${x} ${cy}H${x+width} M${cx} ${y}V${y+height}`} fill="none" stroke="#7697b0" strokeOpacity={.35} strokeWidth={1}/>
    <rect x={x} y={y} width={width} height={height} fill="none" stroke="#7894ad" strokeWidth={1}/>
  </g>;
}

export function CameraFieldDimension({quantity,a,b,value,outside=false}:{quantity:string;a:[number,number];b:[number,number];value:number;outside?:boolean}){
  const selected=useCameraPresentation()?.selected;
  if(!selected?.has(quantity))return null;
  const q=CAMERA_FIELD_QUANTITIES[quantity],color=q?.color??quantityColor(quantity,'camera'),symbol=q?.symbol??quantity;
  const vertical=a[0]===b[0],head=Math.min(5,Math.hypot(b[0]-a[0],b[1]-a[1])/3);
  const arrow=vertical?`M${a[0]-4} ${a[1]+head}L${a[0]} ${a[1]}L${a[0]+4} ${a[1]+head} M${b[0]-4} ${b[1]-head}L${b[0]} ${b[1]}L${b[0]+4} ${b[1]-head}`:`M${a[0]+head} ${a[1]-4}L${a[0]} ${a[1]}L${a[0]+head} ${a[1]+4} M${b[0]-head} ${b[1]-4}L${b[0]} ${b[1]}L${b[0]-head} ${b[1]+4}`;
  return <g className="os-camera-field-dimension" data-testid={`camera-quantity-${quantity}`} data-value={value} pointerEvents="none">
    <title>{q?.label??'样品高度'} {symbol} = {numberText(value)} mm{outside?'；端点在图外':''}</title>
    <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={color} strokeWidth={1.5} strokeDasharray={outside?'4 4':undefined}/>
    <path d={arrow} fill="none" stroke={color} strokeWidth={1.5}/>
    <text x={(a[0]+b[0])/2+(vertical?12:0)} y={(a[1]+b[1])/2+(vertical?5:22)} textAnchor={vertical?'start':'middle'} style={{fill:color}}>{symbol}{outside?'（图外）':''}</text>
  </g>;
}
