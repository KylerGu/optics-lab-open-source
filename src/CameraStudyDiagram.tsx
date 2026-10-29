import {CAMERA_DEPTH_QUANTITIES} from './cameraDepthQuantities';
import {CameraFieldDimension,CameraFieldSample,CameraFieldSwitch,CameraFieldBackdrop} from './CameraFieldView';
import {useCameraPresentation} from './CameraRayPresentation';
import {displayNumber as numberText} from './SceneValue';
import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { CAMERA_STUDIES, cameraOptics } from './cameraModel';
import { type SceneState } from './sceneRuntime';
import { type SceneView } from './SceneDiagram';
import { quantityColor } from './scenePresentation';
import { CameraDepthPreview, CameraPixelPreview } from './CameraVisuals';

export function CameraStudyDiagram({state,view,onView,onPreview,onStart,onCommit}:{state:SceneState;view:SceneView;onView:(v:SceneView)=>void;onPreview:(p:Record<string,number>)=>void;onStart:()=>void;onCommit:()=>void}) {
  const presentation=useCameraPresentation(),marks=presentation?.selected,fieldMode=presentation?.fieldMode??'sensor';
  const p=state.parameters,o=cameraOptics(p),svg=useRef<SVGSVGElement>(null),clip=useId().replace(/:/g,'');
  const [size,setSize]=useState({width:800,height:600});
  const drag=useRef<{id:number;kind:'pan'|'object';xy:{x:number;y:number};view:SceneView;u:number;h:number;unit:number;low:number;sampleScale:number}|null>(null),latest=useRef(view),change=useRef(onView);latest.current=view;change.current=onView;
  useEffect(()=>{
    const el=svg.current!,measure=()=>{const r=el.getBoundingClientRect();if(r.width&&r.height)setSize({width:r.width,height:r.height});};
    measure();const observer=new ResizeObserver(measure);observer.observe(el);
    const wheel=(e:WheelEvent)=>{e.preventDefault();if(drag.current)return;const v=latest.current,z=Math.max(1,Math.min(16,v.zoom*Math.exp(-e.deltaY*.0015))),point=new DOMPoint(e.clientX,e.clientY).matrixTransform(el.getScreenCTM()!.inverse()),ratio=z/v.zoom,cx=el.viewBox.baseVal.width/2,cy=el.viewBox.baseVal.height/2;change.current({...v,zoom:z,dx:point.x-cx-(point.x-cx-v.dx)*ratio,dy:point.y-cy-(point.y-cy-v.dy)*ratio});};
    el.addEventListener('wheel',wheel,{passive:false});return()=>{observer.disconnect();el.removeEventListener('wheel',wheel);};
  },[]);
  const coords=(e:PointerEvent)=>new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());
  // Hold the distance axis fixed during a drag so the handle follows the pointer.
  const coreLow=Math.min(p.u,o.near??p.u,o.focus??p.u),coreHigh=Math.max(p.u,o.focus??p.u,Math.min(o.far??o.focus??p.u,(o.focus??p.u)*1.8));
  const margin=Math.max(10,(coreHigh-coreLow)*.2),axisLow=drag.current?.kind==='object'?drag.current.low:Math.max(0,coreLow-margin);
  const extent=drag.current?.kind==='object'?drag.current.unit:Math.max(50,coreHigh+margin-axisLow),x=(u:number)=>95+(u-axisLow)/extent*610;
  const begin=(e:PointerEvent<SVGElement>,kind:'pan'|'object')=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();drag.current={id:e.pointerId,kind,xy:coords(e),view,u:p.u,h:p.h,unit:extent,low:axisLow,sampleScale:worldScale};svg.current!.setPointerCapture(e.pointerId);if(kind==='object')onStart();};
  const finish=(e:PointerEvent)=>{if(drag.current?.id!==e.pointerId)return;const kind=drag.current.kind;drag.current=null;if(svg.current?.hasPointerCapture(e.pointerId))svg.current.releasePointerCapture(e.pointerId);if(kind==='object')onCommit();};
  const clampU=(u:number)=>Math.max(20,Math.min(5000,u)),worldScale=drag.current?.kind==='object'&&p.study===1?drag.current.sampleScale:Math.min(2.6,240/o.fieldWidth,180/o.fieldHeight,125/p.h);
  const narrowPixel=p.study===3&&size.width<560;
  const centerX=p.study===1?300:narrowPixel?250:400,centerY=p.study===1?330:narrowPixel?350:300;
  const objectX=300,objectY=330,captureX=300,captureY=330;
  const captureScale=Math.min(360/p.sensorW,280/p.sensorH),captureW=p.sensorW*captureScale,captureH=p.sensorH*captureScale;
  const airy=o.airy??0,halfExtent=Math.max(airy*.85,p.pixel*4),scale=220/(halfExtent*2),spacing=p.pixel*scale;
  const font=Math.max(14,13/Math.min(size.width/(p.study===1?600:800),size.height/600));
  const narrowFont=Math.max(14,13/Math.min(size.width/500,size.height/700));
  return <>{p.study===1&&<CameraFieldSwitch onReset={()=>onView({zoom:1,dx:0,dy:0})}/>}<svg ref={svg} id="camera-study-diagram" className="os-camera-study-diagram" viewBox={p.study===1?'0 0 600 600':narrowPixel?'0 0 500 700':'0 0 800 600'} role="img" aria-label={p.study===1?(fieldMode==='sample'?'原始样品与取景范围':'感光面图像（倒像）'):CAMERA_STUDIES[p.study]} data-field-mode={p.study===1?fieldMode:undefined} style={{'--study-font-size':`${narrowPixel?narrowFont:font}px`} as CSSProperties} data-testid="camera-study-diagram" data-zoom={view.zoom}
    onPointerDown={e=>begin(e,'pan')} onPointerMove={e=>{const d=drag.current;if(!d||d.id!==e.pointerId)return;const xy=coords(e),dx=xy.x-d.xy.x,dy=xy.y-d.xy.y;if(d.kind==='pan')onView({...d.view,dx:d.view.dx+dx,dy:d.view.dy+dy});else if(p.study===2)onPreview({u:clampU(d.u+dx*d.unit/(610*d.view.zoom))});else onPreview({h:Math.max(1,Math.min(100,d.h-dy/(worldScale*d.view.zoom)))});}}
    onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
    <defs>
      <clipPath id={`${clip}-capture`}><rect x={captureX-captureW/2} y={captureY-captureH/2} width={captureW} height={captureH}/></clipPath>
      <clipPath id={`${clip}-airy`}><rect x={290} y={100} width={220} height={220}/></clipPath>
    </defs>
    <g transform={`translate(${centerX+view.dx} ${centerY+view.dy}) scale(${view.zoom}) translate(${-centerX} ${-centerY})`}>
      {p.study===1?<>
        {fieldMode==='sample'?<g data-testid="camera-original-sample">
        <g>
          <CameraFieldBackdrop x={120} y={190} width={360} height={280} scale={worldScale}/>
          <path d={`M120 190H480V470H120Z M${objectX-o.fieldWidth*worldScale/2} ${objectY-o.fieldHeight*worldScale/2}v${o.fieldHeight*worldScale}h${o.fieldWidth*worldScale}v${-o.fieldHeight*worldScale}Z`} fill="#071728" fillOpacity={.38} fillRule="evenodd" pointerEvents="none"/>
          <g transform={`translate(${objectX} ${objectY}) scale(${worldScale})`}><CameraFieldSample height={p.h}/></g>
          <rect x={objectX-o.fieldWidth*worldScale/2} y={objectY-o.fieldHeight*worldScale/2} width={o.fieldWidth*worldScale} height={o.fieldHeight*worldScale} fill="none" stroke="#77d3b9" strokeWidth={1.8} strokeDasharray="5 4" data-testid="camera-field-rectangle" data-width={o.fieldWidth} data-height={o.fieldHeight}/>
        </g>
        {marks?.has('fieldWidth')&&<path d={`M${objectX-o.fieldWidth*worldScale/2} ${objectY+o.fieldHeight*worldScale/2}V505 M${objectX+o.fieldWidth*worldScale/2} ${objectY+o.fieldHeight*worldScale/2}V505`} stroke="#77d3b9" opacity={.6} strokeDasharray="3 4"/>}
        {marks?.has('fieldHeight')&&<path d={`M${objectX+o.fieldWidth*worldScale/2} ${objectY-o.fieldHeight*worldScale/2}H515 M${objectX+o.fieldWidth*worldScale/2} ${objectY+o.fieldHeight*worldScale/2}H515`} stroke="#63c9d2" opacity={.6} strokeDasharray="3 4"/>}
        <text className="os-camera-field-caption" x={300} y={555} textAnchor="middle">绿色框内为相机拍摄范围</text>
        <CameraFieldDimension quantity="fieldWidth" a={[objectX-o.fieldWidth*worldScale/2,505]} b={[objectX+o.fieldWidth*worldScale/2,505]} value={o.fieldWidth}/>
        <CameraFieldDimension quantity="fieldHeight" a={[515,objectY-o.fieldHeight*worldScale/2]} b={[515,objectY+o.fieldHeight*worldScale/2]} value={o.fieldHeight}/>
        <CameraFieldDimension quantity="h" a={[85,objectY-p.h*worldScale]} b={[85,objectY]} value={p.h}/>
        <g className="os-device-handle" role="slider" tabIndex={0} aria-label="移动取景中的物体高度" aria-valuemin={1} aria-valuemax={100} aria-valuenow={p.h} onPointerDown={e=>begin(e,'object')} onKeyDown={e=>{if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();onStart();onPreview({h:Math.max(1,Math.min(100,p.h+(e.key==='ArrowUp'?.5:-.5)))});onCommit();}}}>
          <title>竖直拖动改变样品高度</title>
          <circle cx={objectX-p.h*worldScale*.28} cy={objectY-p.h*worldScale} r={7} fill="#10213b" stroke="#e8c594" strokeWidth={2}/>
        </g>
        </g>:<g data-testid="camera-sensor-image">
        <CameraFieldBackdrop x={captureX-captureW/2} y={captureY-captureH/2} width={captureW} height={captureH} scale={p.sensor/p.u*captureScale}/>
        <g clipPath={`url(#${clip}-capture)`} data-testid="camera-captured-subject">
          <g transform={`translate(${captureX} ${captureY}) scale(${-p.sensor/p.u*captureScale})`}><CameraFieldSample height={p.h}/></g>
        </g>
        <text className="os-camera-field-caption" x={300} y={555} textAnchor="middle">{o.blur<1e-8?'绿框内的同一样品 · 倒像与裁切':'当前离焦 · 仅示意取景与倒置'}</text>
        <CameraFieldDimension quantity="sensorW" a={[captureX-captureW/2,captureY+captureH/2+35]} b={[captureX+captureW/2,captureY+captureH/2+35]} value={p.sensorW}/>
        <CameraFieldDimension quantity="sensorH" a={[captureX+captureW/2+35,captureY-captureH/2]} b={[captureX+captureW/2+35,captureY+captureH/2]} value={p.sensorH}/>
        </g>}
      </>:p.study===2?<>
        <text x={400} y={65} textAnchor="middle">景深范围与样品清晰度</text>
        <rect x={65} y={100} width={670} height={190} rx={10} fill="#10213b"/>
        <path d="M95 235H705" stroke="#7894ad" strokeWidth={1.5}/>
        {o.near!==null&&<>
          <rect x={x(o.near)} y={155} width={Math.max(2,x(Math.min(o.far??axisLow+extent,axisLow+extent))-x(o.near))} height={80} fill="#77d3b9" fillOpacity={.18} stroke="#77d3b9" data-testid="camera-depth-region"/>
          <path d={`M${x(o.focus!)} 135V250`} stroke="#70b5f1" strokeDasharray="5 5"/>
          <text x={400} y={125} textAnchor="middle" style={{fill:'#9acdbf'}}>容许清晰范围</text>
          {(['focusDistance','nearDepth','farDepth'] as const).map((key,i)=>{
            if(!marks?.has(key))return null;
            const value=key==='focusDistance'?o.focus!:key==='nearDepth'?o.near!:o.far;
            const outside=value===null||value>axisLow+extent,pos=x(Math.min(value??axisLow+extent,axisLow+extent)),q=CAMERA_DEPTH_QUANTITIES[key];
            return <g key={key} data-testid={`camera-quantity-${key}`}><path d={`M${pos} 235V${305+i*24}`} stroke={q.color} strokeDasharray="3 4"/><text x={pos} y={320+i*24} textAnchor="middle" style={{fill:q.color}}>{q.symbol}{outside?(value===null?' → ∞':'（图外）'):''}</text></g>;
          })}
          {marks?.has('depth')&&<g data-testid="camera-quantity-depth"><path d={`M${x(o.near)} 145V138H${x(Math.min(o.far??axisLow+extent,axisLow+extent))}V145`} fill="none" stroke="#77d3b9"/><text x={(x(o.near)+x(Math.min(o.far??axisLow+extent,axisLow+extent)))/2} y={95} textAnchor="middle" style={{fill:CAMERA_DEPTH_QUANTITIES.depth.color}}>ΔD{o.far===null?' → ∞':''}</text></g>}
        </>}
        {o.focus===null&&<text x={400} y={175} textAnchor="middle" style={{fill:'#9bb0c5'}}>当前设置没有有限对焦距离</text>}
        <text x={95} y={275} style={{fill:'#9bb0c5'}}>← 朝镜头</text>
        <text x={705} y={275} textAnchor="end" style={{fill:'#9bb0c5'}}>远离镜头 →</text>
        <g className="os-device-handle os-horizontal-handle" role="slider" tabIndex={0} aria-label="拖动物体比较景深范围" aria-valuemin={20} aria-valuemax={5000} aria-valuenow={p.u} onPointerDown={e=>begin(e,'object')} onKeyDown={e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();onStart();onPreview({u:clampU(p.u+(e.key==='ArrowLeft'?-1:1))});onCommit();}}}>
          <title>沿距离轴移动样品</title>
          <g transform={`translate(${x(p.u)} 235) scale(1.7)`}><CameraFieldSample height={25}/></g>
          <circle data-testid="camera-depth-object-handle" cx={x(p.u)} cy={235} r={7} fill="#10213b" stroke="#e8c594" strokeWidth={2}/>
          {marks?.has('u')&&<text data-testid="camera-quantity-u" x={x(p.u)} y={390} textAnchor="middle" style={{fill:quantityColor('u','camera')}}>u = {numberText(p.u)} mm</text>}
        </g>
        <CameraDepthPreview diameter={o.blur}/>
      </>:<>
        <text x={centerX} y={40} textAnchor="middle">衍射光斑与像素网格</text>
        {o.airy!==null&&o.cutoff!==null?<>
          <g transform={narrowPixel?'translate(-150 0)':undefined}>
          <rect x={276} y={86} width={248} height={248} rx={10} fill="#10213b"/>
          <rect x={290} y={100} width={220} height={220} fill="#193754" stroke="#7894ad"/>
          <defs><pattern id={`${clip}-pixels`} x={290} y={100} width={spacing} height={spacing} patternUnits="userSpaceOnUse"><path d={`M${spacing} 0H0V${spacing}`} fill="none" stroke="#b8a481" strokeOpacity={.55} strokeWidth={.7}/></pattern></defs>
          <g clipPath={`url(#${clip}-airy)`}>
            <circle cx={400} cy={210} r={airy/2*scale} fill="#e8c594" fillOpacity={.32} stroke="#e8c594" strokeWidth={1.5} data-highlighted={marks?.has('airyDiameter')||undefined} data-testid="camera-airy-circle" data-diameter={airy}/>
            <rect x={290} y={100} width={220} height={220} fill={`url(#${clip}-pixels)`}/>

          </g>
          {marks?.has('airyDiameter')&&<g data-testid="camera-quantity-airyDiameter"><path d={`M${400-airy/2*scale} 210V345 M${400+airy/2*scale} 210V345 M${400-airy/2*scale} 340H${400+airy/2*scale}`} stroke={quantityColor('airyDiameter','camera')} fill="none"/><text x={400} y={363} textAnchor="middle" style={{fill:quantityColor('airyDiameter','camera')}}>dₐ</text></g>}
          {marks?.has('pixel')&&<g data-testid="camera-quantity-pixel"><path d={`M290 100V76H${290+spacing}V100`} stroke={quantityColor('pixel','camera')} fill="none"/><text x={290+spacing/2} y={70} textAnchor="middle" style={{fill:quantityColor('pixel','camera')}}>p</text></g>}
          </g>
          <CameraPixelPreview pixel={p.pixel} cutoff={o.cutoff} narrow={narrowPixel}/>
        </>:<text x={centerX} y={300} textAnchor="middle">当前物距没有有限实像</text>}
      </>}
    </g>
  </svg></>;
}
