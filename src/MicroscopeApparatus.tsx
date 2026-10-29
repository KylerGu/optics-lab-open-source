import type {SceneResult,SceneState} from './sceneRuntime';
import {microscopeEyePosition,microscopeRayHeight} from './microscopeEye';
import './microscope-apparatus.css';

export function microscopeApparatusHalfHeight(result:SceneResult,y:(value:number)=>number,height:number){
  const envelope=result.segments.filter(s=>s.role==='internal').flatMap(s=>[Math.abs(y(s.start[1])-y(0)),Math.abs(y(s.end[1])-y(0))]);
  return Math.max(58,Math.min(height*.29,Math.max(0,...envelope)+30));
}

// A cutaway skin over the existing optical coordinates. Housing dimensions are
// illustrative only: they never clip rays or introduce additional optical surfaces.
export default function MicroscopeApparatus({state,result,x,y,width,height}:{state:SceneState;result:SceneResult;x:(value:number)=>number;y:(value:number)=>number;width:number;height:number}){
  const p=state.parameters,camera=p.mode===1,axis=y(0),objective=x(0),second=x(p.d),sample=x(-p.u);
  const half=microscopeApparatusHalfHeight(result,y,height);
  const left=objective+14,right=second-20,tubeWidth=Math.max(0,right-left);
  const nose=Math.max(8,Math.min(26,(objective-sample)*.35)),baseY=axis+half+35;
  const supportX=(left+right)/2,baseWidth=Math.min(180,Math.max(55,tubeWidth*.55));
  const screen=result.devices?.find(d=>d.kind==='screen');
  const screenX=screen?x(screen.x):second;
  const cameraHalf=screen?Math.max(half*.82,Math.abs(y(screen.height)-axis)+12):half*.82;
  return <g className="microscope-apparatus" data-testid="microscope-apparatus" data-mode={camera?'camera':'eye'} pointerEvents="none">
    <title>显微镜展开剖面示意。外壳不按实物比例绘制、不参与截光；镜片位置和光线沿用当前计算。</title>
    {tubeWidth>30&&<>
      <rect x={left} y={axis-half} width={tubeWidth} height={half*2} rx={13} className="microscope-shell"/>
      <path d={`M${left+14} ${axis-half+12}H${right-14} M${left+14} ${axis+half-12}H${right-14}`} className="microscope-shell-seam"/>
      <rect x={left+6} y={axis-half+18} width={Math.max(0,tubeWidth-12)} height={Math.max(0,half*2-36)} rx={5} className="microscope-cutaway"/>
      {baseY+18<height-30&&<g className="microscope-support">
        <path d={`M${supportX-14} ${axis+half}V${baseY}H${supportX+14}V${axis+half}`} className="microscope-shell"/>
        <rect x={supportX-baseWidth/2} y={baseY} width={baseWidth} height={12} rx={5} className="microscope-shell"/>
      </g>}
    </>}
    <path d={`M${objective-nose} ${axis-half*.58}L${objective+14} ${axis-half}V${axis+half}L${objective-nose} ${axis+half*.58}Z`} className="microscope-objective-shell"/>
    <path d={`M${objective-nose-4} ${axis-half*.58}H${objective-nose+3} M${objective-nose-4} ${axis+half*.58}H${objective-nose+3}`} className="microscope-rim"/>
    <g data-testid="microscope-sample-stage">
      <rect x={sample-4} y={axis-Math.max(20,Math.abs(y(p.h)-axis)+10)} width={8} height={Math.max(40,Math.abs(y(p.h)-axis)+30)} rx={2} className="microscope-slide"/>
      <path d={`M${sample-16} ${axis+26}H${sample+16}V${axis+33}H${sample-16}Z`} className="microscope-shell"/>
    </g>
    {camera?<>
      <rect x={second-20} y={axis-half} width={40} height={half*2} rx={7} className="microscope-objective-shell"/>
      {screen&&screenX-second>55&&<>
        <path d={`M${second+20} ${axis-half*.68}H${screenX-18} M${second+20} ${axis+half*.68}H${screenX-18}`} className="microscope-shell-seam"/>
        <rect x={screenX-18} y={axis-cameraHalf} width={46} height={cameraHalf*2} rx={9} className="microscope-camera-shell"/>
        <rect x={screenX+11} y={axis-19} width={8} height={38} rx={3} className="microscope-camera-detail"/>
        <text x={Math.min(width-105,Math.max(105,screenX))} y={axis+cameraHalf+24} textAnchor="middle">相机 · 转接前等效面</text>
      </>}
    </>:<>
      <path d={`M${second-20} ${axis-half}H${second+15}L${second+24} ${axis-half*.48}V${axis+half*.48}L${second+15} ${axis+half}H${second-20}Z`} className="microscope-objective-shell"/>
      <path d={`M${second+24} ${axis-half*.48}H${second+31} M${second+24} ${axis+half*.48}H${second+31}`} className="microscope-rim"/>
    </>}
  </g>;
}

export function MicroscopeEye({state,result,x,y}:{state:SceneState;result:SceneResult;x:(value:number)=>number;y:(value:number)=>number}){
  const position=microscopeEyePosition(state,result);
  if(position===null)return null;
  const rays=result.segments.filter(s=>s.role==='transmitted'),axis=y(0),cx=x(position);
  if(!rays.length)return null;
  const entries=rays.map(ray=>({height:y(microscopeRayHeight(ray,position)),slope:(y(ray.end[1])-y(ray.start[1]))/(x(ray.end[0])-x(ray.start[0]))}));
  const v=result.metrics.find(m=>m.key==='v')!.value;
  // The eye follows the incoming bundle. Its retina is a schematic destination,
  // not the microscope's final-image plane or a new calculated eye model.
  const cy=entries.reduce((sum,e)=>sum+e.height,0)/entries.length;
  const angle=Math.atan(entries.reduce((sum,e)=>sum+e.slope,0)/entries.length);
  const cos=Math.cos(angle),sin=Math.sin(angle),rx=cx+38*cos,ry=cy+38*sin;
  const pupil=Math.max(6,...entries.map(e=>Math.abs(e.height-cy)+2));
  const lower=Math.max(cy,ry)+42,upper=Math.min(cy,ry)-38;
  return <g className="microscope-eye" data-testid="microscope-eye" data-position={position} pointerEvents="none">
    <title>眼睛位于目镜出瞳附近；眼内折射与视网膜像仅作示意，不参与显微镜计算。</title>
    <g transform={`translate(${cx} ${cy}) rotate(${angle*180/Math.PI})`}>
      <path d="M-5-13C-17-9-17 9-5 13C3 35 38 30 38 0C38-30 3-35-5-13Z" fill="#f6fafc" fillOpacity={.9} stroke="#91a4b7" strokeWidth={1.5}/>
      <path d="M29-18Q47 0 29 18" fill="none" stroke="#c99580" strokeWidth={2}/>
      <path d={`M-4-16V${-pupil} M-4 ${pupil}V16`} stroke="#7192a3" strokeWidth={3}/>
      <ellipse cx={0} cy={0} rx={4} ry={Math.max(12,pupil)} fill="#d8eaf0" fillOpacity={.8} stroke="#8cabbc"/>
    </g>
    {entries.map((entry,i)=>{
      const t=(entry.height-cy)/(cos+entry.slope*sin);
      return <path key={i} d={`M${cx-12} ${entry.height-12*entry.slope}L${cx-sin*t} ${cy+cos*t}L${rx} ${ry}`} fill="none" stroke="#26836a" strokeWidth={1.8}/>;
    })}
    <circle cx={rx} cy={ry} r={3} fill="#26836a"/>
    <text x={cx+12} y={upper} textAnchor="middle">眼睛</text>
    <path d={`M${rx+4} ${ry+4}L${cx+40} ${lower-20}H${cx+12}`} stroke="#91a4b7" fill="none"/>
    <text x={cx+12} y={lower} textAnchor="middle">视网膜像</text>
    {v===null&&<text data-testid="microscope-infinite-image" x={cx+38} y={Math.min(upper-32,axis-110)} textAnchor="end" className="microscope-final-image">平行光入眼 · 最终虚像在 ∞</text>}
  </g>;
}
