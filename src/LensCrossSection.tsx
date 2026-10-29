import type {SpatialElement} from './builderModel';
import {physicalLensSpan,physicalLensSurfaces,isSolidCylinder} from './physicalLensGeometry';
export function lensFaceLabels(e:SpatialElement){const front=e.kind.includes('concave')?'凹面':'凸面',back=e.kind.endsWith('meniscus-lens')?'凹面':e.kind==='biconvex-lens'?'凸面':e.kind==='biconcave-lens'?'凹面':'平面';return {front,back};}
export default function LensCrossSection({element:e,compact=false}:{element:SpatialElement;compact?:boolean}){
  const a=physicalLensSpan(e),raw:[number,number][]=[];for(let i=0;i<=48;i++){const r=-a+2*a*i/48;raw.push([physicalLensSurfaces(e,Math.abs(r))[0],r]);}for(let i=48;i>=0;i--){const r=-a+2*a*i/48;raw.push([physicalLensSurfaces(e,Math.abs(r))[1],r]);}
  const xs=raw.map(p=>p[0]),left=Math.min(...xs),right=Math.max(...xs),scale=Math.min(76/(2*a),64/Math.max(1,right-left)),cx=(left+right)/2;
  const path=raw.map(([x,y],i)=>`${i?'L':'M'}${110+(x-cx)*scale},${58+y*scale}`).join(' ')+' Z',labels=lensFaceLabels(e),clear=(isSolidCylinder(e.kind)?e.clearWidthMm:e.clearApertureMm)/2*scale;
  return <svg className="sb-lens-section" viewBox="0 0 220 116" aria-label={compact?undefined:`镜片截面：前面${labels.front}，后面${labels.back}`} aria-hidden={compact||undefined}><path d="M45 58H175" stroke="#bbcadd" strokeDasharray="3 3"/><path d={path} fill="#d8edfa" stroke="#6691ca" strokeWidth="1.5"/>{!compact&&<><path d={`M65 ${58-clear}H155M65 ${58+clear}H155`} stroke="#4ea896" strokeDasharray="3 3"/><text x="14" y="22">前面 · {labels.front}</text><text x="206" y="22" textAnchor="end">后面 · {labels.back}</text><text x="110" y="109" textAnchor="middle">{isSolidCylinder(e.kind)?'沿弯曲方向的截面':'镜片截面'} · 绿色为通光边界</text></>}</svg>;
}
