import SpatialDistantPreview from './SpatialDistantPreview';
import SpatialImagePreview from './SpatialImagePreview';
import {imageView} from './spatialImageView';
import type {SpatialResult} from './builderModel';
import {geometryFrame,dot3,sub3} from './spatialGeometry';
const fmt=(x:number|null)=>x===null?'—':Number(x.toPrecision(5)).toString();
export default function SpatialImagingResults({result}:{result:SpatialResult}){
  return <>{result.imaging?.map(r=>{
    const object=result.inputSnapshot.elements.find(e=>e.id===r.objectId)!;
    if(object.objectMode==='distant')return <article className="sb-imaging-result" key={r.objectId}><strong>{object.name} · 远处物体成像</strong><SpatialDistantPreview object={object} result={r} compact/>{r.observations.filter(o=>o.kind!=='eye').map(o=>{const view=imageView(result.inputSnapshot,r,o.elementId);return view?<div key={o.elementId}><strong>{result.inputSnapshot.elements.find(e=>e.id===o.elementId)?.name}</strong><p>{o.focused?'已对焦':'未对焦'}</p><SpatialImagePreview view={view}/></div>:null;})}</article>;
    const eyePath=(points:number[][],id:string)=>{
      const detector=result.inputSnapshot.elements.find(e=>e.id===id)!;
      const {u,v}=geometryFrame(detector),center=result.inputSnapshot.elements.find(e=>e.id===r.stages[0]?.lensId)?.position??object.position;
      return points.map((p,i)=>{const delta=sub3(p as [number,number,number],center);return `${i?'L':'M'}${dot3(delta,u)},${dot3(delta,v)}`;}).join(' ');
    };
    const final=r.stages.at(-1),{n,v}=geometryFrame(object);
    const project=(p:number[])=>[dot3(sub3(p as [number,number,number],object.position),n),-dot3(sub3(p as [number,number,number],object.position),v)];
    const segments=r.segments.filter(s=>s.point===0||s.point===2||s.point===4);
    const points=[...r.objectPaths.flat(),...segments.flatMap(s=>[s.start,s.end]),...r.stages.filter(s=>s.visible).flatMap(s=>s.paths.flat()).filter(p=>p.every(x=>Math.abs(x)<2000))].map(project);
    const xmin=Math.min(0,...points.map(p=>p[0])),xmax=Math.max(10,...points.map(p=>p[0])),extent=Math.max(.01,...points.map(p=>Math.abs(p[1])));
    const x=(v:number)=>35+(v-xmin)/(xmax-xmin)*630,y=(v:number)=>110-v/extent*80;
    const path=(ps:number[][])=>ps.map((p,i)=>{const q=project(p);return `${i?'L':'M'}${x(q[0])},${y(q[1])}`;}).join(' ');
    return <article className="sb-imaging-result" key={r.objectId}>
      <strong>{object.name} · {final?final.kind==='infinity'?'像在无穷远':`${final.magnification!<0?'倒立':'正立'}${final.kind==='real'?'实像':'虚像'}`:'暂不计算成像'}</strong>
      {!!r.stages.length&&<><svg viewBox="0 0 700 225" role="img" aria-label="物体多点成像光路，虚线为反向延长线">
        <path d="M25 110H680" stroke="#cbd5e1"/>
        {segments.map((s,i)=><path key={i} d={path([s.start,s.end])} fill="none" stroke={['#cb7950','#428aba','#49a68f'][s.point%3]} strokeWidth="1" opacity=".55" strokeDasharray={s.dashed?'4 4':undefined}/>)}
        {r.stages.map(s=>{const lens=result.inputSnapshot.elements.find(e=>e.id===s.lensId)!;const px=x(project(lens.position)[0]);return <g key={s.lensId}><path d={`M${px} 20V198`} stroke="#6795c5" strokeWidth="3"/><text x={px} y="216" textAnchor="middle">{lens.name}</text></g>;})}
        {r.objectPaths.map((p,i)=><path key={i} d={path(p)} stroke="#347a69" strokeWidth="3" fill="none"/>)}
        {r.stages.filter(s=>s.visible).map((s,i)=>s.paths.filter(p=>p.every(q=>q.every(v=>Math.abs(v)<2000))).map((p,j)=><path key={`${i}-${j}`} d={path(p)} stroke="#a05eaa" strokeWidth="2" fill="none" strokeDasharray={s.kind==='virtual'?'3 2':undefined}/>))}
      </svg><small>横向为光轴距离；纵向单独放大。虚线表示反向延长线。</small>
      <div className="sb-imaging-readings">{r.stages.map(s=><span key={s.lensId}>{result.inputSnapshot.elements.find(e=>e.id===s.lensId)?.name}后：{s.kind==='infinity'?'无穷远':`像距 ${fmt(s.distanceMm)} mm · 倍率 ${fmt(s.magnification)} · 像高 ${fmt(s.heightMm)} mm`}</span>)}</div></>}
      <div className="sb-imaging-observations">{r.observations.map(o=><div key={o.elementId}>
        <strong>{result.inputSnapshot.elements.find(e=>e.id===o.elementId)?.name}</strong>
        {o.kind==='eye'?<><p>{o.angularMagnification===null?'出射光形成实像，非通常目视状态':`目视角放大率 ${fmt(o.angularMagnification)} 倍${final?.kind==='infinity'?' · 放松观察':' · 需调节眼睛对焦'}`}{o.fieldDiameterMm!==null&&<><br/>样品视野直径 {fmt(o.fieldDiameterMm)} mm</>}</p>{o.angularMagnification!==null&&o.fieldDiameterMm!==null&&final?.visible&&o.hits.length>0&&<svg viewBox="-100 -100 200 200" role="img" aria-label="目视样品视野"><circle r="95" fill="#edf4f5" stroke="#7190ae"/><svg x="-95" y="-95" width="190" height="190" style={{clipPath:"circle(50%)"}} viewBox={`${-o.fieldDiameterMm/2} ${-o.fieldDiameterMm/2} ${o.fieldDiameterMm} ${o.fieldDiameterMm}`} overflow="hidden"><g transform={`scale(${o.angularMagnification<0?-1:1})`}>{r.objectPaths.map((line,i)=><path key={i} d={eyePath(line,o.elementId)} stroke="#38887d" strokeWidth={o.fieldDiameterMm!/120} fill="none"/>)}</g></svg></svg>}</>:<>
          <p>{o.focused?'已对焦':`未对焦${o.defocusMm===null?'（像在无穷远）':` · 偏离像面 ${fmt(o.defocusMm)} mm`}`}{o.magnification!==null&&` · 成像倍率 ${fmt(o.magnification)}`}</p>
          <SpatialImagePreview view={imageView(result.inputSnapshot,r,o.elementId)!}/>
          <small>{o.kind==='sensor'?`${fmt(o.widthMm)} × ${fmt(o.heightMm)} mm · 转接 ${fmt(o.adapterMagnification)} 倍`:'采样点示意，离焦时同一物点散开'}</small>
        </>}
      </div>)}</div>
      {r.warnings.map(w=><p role="status" key={w}>{w}</p>)}
    </article>;
  })}</>;
}
