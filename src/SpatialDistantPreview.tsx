import {useId} from 'react';
import type {SpatialElement} from './builderModel';
import type {ObjectImageResult} from './spatialImaging';

export default function SpatialDistantPreview({object,result,compact=false}:{object:SpatialElement;result?:ObjectImageResult;compact?:boolean}){
 const view=result?.distantView,id=useId().replace(/:/g,''),scale=130/3;
 const draw=(reference:boolean)=>{
  const paths=reference?view?.referencePaths:view?.paths;
  const center=(reference?view?.referenceCenter:view?.center)??[0,0];
  return <svg viewBox="0 0 280 320" className="os-microscope-preview os-telescope-field-frame" role="img" aria-label={reference?'实际 F 物体':view?.focused?'进入眼瞳的光线形成的 F 像':'放松眼睛观察时的离焦光线像'} data-testid={reference?'telescope-reference-field':'telescope-magnified-field'} data-magnification={reference?1:view?.magnification} data-focused={view?.focused}>
   <defs><clipPath id={`${id}-${reference}-clip`}><circle cx="140" cy="140" r="130"/></clipPath><filter id={`${id}-${reference}-blur`} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation={(view?.sigmaDegrees??0)*scale}/></filter></defs>
   <rect width="280" height="320" rx="10" fill="#10213b"/><circle cx="140" cy="140" r="130" fill="#193754" stroke="#7894ad"/>
   <g clipPath={`url(#${id}-${reference}-clip)`}><path d="M10 140H270 M140 10V270" stroke="#7697b0" strokeOpacity=".28"/>
    <g filter={reference?undefined:`url(#${id}-${reference}-blur)`}>{paths?.map((path,i)=><path key={i} d={path.map(([x,y],j)=>`${j?'L':'M'}${140+(x-center[0])*scale},${140-(y-center[1])*scale}`).join(' ')} fill="none" stroke="#e8c594" strokeWidth={Math.max(.5,(view?.strokeDegrees??.05)*scale*(reference?1:Math.abs(view?.magnification??1)))} strokeLinecap="round" strokeLinejoin="round" opacity={reference?1:Math.min(1,2/(view?.pupilCount??1))}/>)}</g>
   </g><g role="img" aria-label="角度标尺：横线长度表示 1 度"><title>角度标尺：横线长度表示 1°</title><path d={`M86 296H${86+scale} M86 290V302 M${86+scale} 290V302`} fill="none" stroke="#e6eff8" strokeWidth="2.5"/><text x={98+scale} y="304" fill="#e6eff8" fontSize="24">1°</text></g>
   {!paths?.length&&<text x="140" y="145" textAnchor="middle" fill="#d7e7f2" fontSize="12">{result?'暂无光线进入眼睛':'计算中…'}</text>}
  </svg>;
 };
 const content=<><div className="sb-object-preview-pair sb-distant-pair"><div><span>远处样品 F</span>{draw(true)}</div><div><span>目视观察</span>{draw(false)}</div></div>
 <p className="sb-distant-caption">{view?`${Math.abs(view.magnification).toFixed(2)} 倍${view.focused?'':' · 未对焦，请调整目镜位置'}`:'请将物体、镜片和眼睛放在有效光路上'}</p>
 {result?.warnings.filter(w=>w!=='部分光线被口径挡住，目视图只显示进入眼瞳的部分。').map(w=><p role="status" key={w}>{w}</p>)}</>;
 return compact?<div className="sb-distant-preview" data-testid="spatial-distant-preview">{content}</div>:<details className="sb-object-preview has-image sb-distant-preview" open data-testid="spatial-distant-preview"><summary>物像对照</summary>{content}</details>;
}
