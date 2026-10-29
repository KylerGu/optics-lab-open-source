import {useId,useRef,useState} from 'react';
import {nearViewBox,type ImageView} from './spatialImageView';

export default function SpatialImagePreview({view,steady=false}:{view:ImageView;steady?:boolean}){
  const [near,setNear]=useState(true),id=useId().replace(/:/g,'');
  const initial=useRef({id:view.elementId,box:nearViewBox(view)});
  if(initial.current.id!==view.elementId)initial.current={id:view.elementId,box:nearViewBox(view)};
  const box=near?(steady?initial.current.box:nearViewBox(view)):[-view.width/2,-view.height/2,view.width,view.height];
  const stroke=Math.max(box[2],box[3])/65;
  return <div className="sb-image-preview">
    <button onClick={()=>setNear(v=>!v)} title="切换完整视野与局部放大">{view.kind==='eye'?'目视':'成像'} · {near?'近看':'全幅'}</button>
    <svg viewBox={box.join(' ')} role="img" aria-label={view.focused?'合焦图案':'离焦采样图案'}>
      <defs><clipPath id={id}>{view.kind==='sensor'?<rect x={-view.width/2} y={-view.height/2} width={view.width} height={view.height}/>:<circle r={view.width/2}/>}</clipPath></defs>
      <g clipPath={`url(#${id})`}>
        <rect x={-view.width/2} y={-view.height/2} width={view.width} height={view.height} fill="#142d3b"/>
        {view.paths.length?view.paths.map((path,i)=><path key={i} d={path.map(([x,y],j)=>`${j?'L':'M'}${x},${-y}`).join(' ')} fill="none" stroke="#f1cf8a" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"/>):view.hits.map((h,i)=><circle key={i} cx={h.x} cy={-h.y} r={stroke*.55} fill="#f1cf8a" opacity=".35"/>)}
      </g>
    </svg>
    <span>{view.caption??(view.kind==='eye'?'目视示意':view.focused?'已对焦':'未对焦')}</span>
  </div>;
}
