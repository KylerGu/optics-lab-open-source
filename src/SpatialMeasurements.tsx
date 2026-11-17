import { ChevronRight } from 'lucide-react';
import SpatialImagingResults from './SpatialImagingResults';
import type { DiffractionProfile, SpatialResult } from './builderModel';
import SpatialFourFOutput from './SpatialFourFOutput';
import SpatialFourierOutput from './SpatialFourierOutput';
import { cleanElementDisplayName, formatCompact, formatReadoutWithUnit } from './researchUnits';
import {spatialResultNotes} from './spatialResultNotes';

const POLARIZATION_KINDS = new Set(['polarizer', 'half-wave-plate', 'quarter-wave-plate', 'polarizing-splitter']);
const ATTENUATING_KINDS = new Set(['splitter', 'polarizing-splitter', 'aperture', 'filter', 'slit']);

function hasRelevantPolarization(result: SpatialResult): boolean {
  return result.inputSnapshot.elements.some(e => POLARIZATION_KINDS.has(e.kind));
}

function hasRelevantAnisotropy(result: SpatialResult, u: number | null | undefined, v: number | null | undefined): boolean {
  if (u == null || v == null) return false;
  const asymmetric = Math.abs(u - v) > Math.max(0.005, 0.05 * Math.max(u, v));
  return asymmetric || result.inputSnapshot.elements.some(e => e.kind.includes('cylinder') && (u > 0.005 || v > 0.005));
}

function beamSizeContext(result: SpatialResult, gaussianRadiusMm: number | null): string | null {
  if (gaussianRadiusMm === null) return null;
  const laser = result.inputSnapshot.elements.find(e => e.kind === 'laser' && e.beamModel === 'gaussian');
  if (!laser || laser.beamRadiusMm <= 0) return null;
  const ratio = gaussianRadiusMm / laser.beamRadiusMm;
  const baseLabel = formatReadoutWithUnit(laser.beamRadiusMm, 'mm');
  if (ratio < 0.98) return `较入射光束（${baseLabel}）聚焦压缩 ${formatCompact(1 / ratio, 3)}×`;
  if (ratio > 1.02) return `较入射光束（${baseLabel}）扩展 ${formatCompact(ratio, 3)}×`;
  return `与入射束腰（${baseLabel}）基本相当`;
}

function PolarizationState({state:s}:{state:{s1:number;s2:number;s3:number}}){
  const degree=Math.hypot(s.s1,s.s2,s.s3),angle=.5*Math.atan2(s.s2,s.s1),ellipticity=degree?Math.asin(Math.max(-1,Math.min(1,s.s3/degree)))/2:0;
  const label=degree<.001?'未偏振':degree<.999?'混合偏振':Math.abs(s.s3)>.999?'圆偏振':Math.abs(s.s3)<.001?'线偏振':'椭圆偏振';
  return <span className="sb-polarization-state"><svg viewBox="0 0 100 64" width="100" height="64" role="img" aria-label={label+'电场轨迹示意'}><path d="M10 32H90M50 4V60" stroke="#cbd5e1"/>{degree>.001?<ellipse cx="50" cy="32" rx="25" ry={Math.max(.3,25*Math.abs(Math.tan(ellipticity)))} fill="none" stroke="#9c77cf" strokeWidth="2" transform={`rotate(${-angle*180/Math.PI} 50 32)`}/>:<circle cx="50" cy="32" r="25" fill="none" stroke="#9c77cf" strokeDasharray="3 3"/>}</svg><small>电场轨迹示意</small><small>{label} · 偏振程度 {(degree*100).toFixed(1)}%</small><small>S1 / S2 / S3：{s.s1.toFixed(3)} / {s.s2.toFixed(3)} / {s.s3.toFixed(3)}</small></span>;
}
export function DiffractionChart({profile:p}:{profile:DiffractionProfile}){
  const grating='gratingId' in p,title=grating?'光栅屏上光强':'单狭缝远场条纹';
  const left=35,right=285,top=22,bottom=110,lo=p.points[0].xMm,hi=p.points.at(-1)!.xMm,peak=grating?Math.max(.001,...p.points.map(v=>v.intensity)):1;
  const x=(v:number)=>left+(v-lo)/(hi-lo)*(right-left),y=(v:number)=>bottom-v/peak*(bottom-top);
  return <article className="sb-diffraction" aria-label={title}><strong>{title}</strong><svg viewBox="0 0 305 147" role="img" aria-label="屏上位置 x 与相对光强曲线">
    <path d={`M${left},${top}V${bottom}H${right}`} fill="none" stroke="#cbd5e1"/>
    <path d={p.points.map((v,i)=>`${i?'L':'M'}${x(v.xMm).toFixed(2)},${y(v.intensity).toFixed(2)}`).join(' ')} fill="none" stroke="#427ad3" strokeWidth="1.5"/>
    {!grating&&[-p.firstMinimumMm,p.firstMinimumMm].filter(v=>v>=lo&&v<=hi).map(v=><line key={v} x1={x(v)} x2={x(v)} y1={top} y2={bottom} stroke="#91a7c5" strokeDasharray="3 3"/>)}
    <text x="35" y="12">{grating?'I / Iᵢₙ':'I / I₀'}</text><text x="3" y="26">{Number(peak.toPrecision(3))}</text><text x="8" y="112">0</text><text x={left} y="127">{lo.toFixed(1)}</text><text x={right} y="127" textAnchor="end">{hi.toFixed(1)}</text><text x="155" y="143" textAnchor="middle">屏上位置 x / mm</text>
  </svg>{grating?<span>周期数 N = {p.periodCount} · 屏距 L = {p.distanceMm.toFixed(1)} mm</span>:<span>中央亮纹宽度 {p.centralMaximumWidthMm.toFixed(3)} mm</span>}<small>{grating?'相对入射光强 · 近轴一维剖面':'归一化光强 · 单独计算，不代表功率计读数'}</small></article>;
}
function GratingOrders({result}:{result:SpatialResult}){
  return <>{result.gratingOrders?.map(entry=>{
    const grating=result.inputSnapshot.elements.find(e=>e.id===entry.gratingId),source=result.inputSnapshot.elements.find(e=>e.id===entry.sourceId);
    const table=(orders:typeof entry.orders)=><table className="sb-grating-table"><thead><tr><th>级次 m</th><th>角度 θₘ / °</th><th>效率 ηₘ / %</th></tr></thead><tbody>{orders.map(o=><tr key={o.m}><td>{o.m>0?'+':''}{o.m}</td><td>{o.angleDeg.toFixed(3)}</td><td>{o.efficiency===0?'0（缺级）':(o.efficiency*100).toFixed(3)}</td></tr>)}</tbody></table>;
    return <article className="sb-diffraction" key={entry.gratingId+entry.sourceId}><strong>{cleanElementDisplayName(grating?.name??'光栅')} · 衍射级次</strong><small>{cleanElementDisplayName(source?.name??'光源')} · λ = {source?.wavelengthNm} nm</small>{table(entry.orders.filter(o=>Math.abs(o.m)<=1))}{entry.orders.some(o=>Math.abs(o.m)>1)&&<details><summary>其余传播级次</summary>{table(entry.orders.filter(o=>Math.abs(o.m)>1))}</details>}<small>ηₘ：薄振幅光栅估算，角度相对法线</small></article>;
  })}</>;
}
export default function SpatialMeasurements({result,onSelect}:{result:SpatialResult;onSelect:(id:string)=>void}){
  const coherent=result.fourF??result.fourier,notes=spatialResultNotes(result);
  const mayAttenuate=result.screens.length>1||result.inputSnapshot.elements.some(e=>ATTENUATING_KINDS.has(e.kind));
  return <><SpatialImagingResults result={result}/><div className="sb-measurement-grid">{result.fourF&&<SpatialFourFOutput result={result.fourF} radius={(result.inputSnapshot.elements.find(e=>e.id===result.fourF!.screenId)?.diameterMm??40)/2}/>}{result.fourier&&<SpatialFourierOutput result={result.fourier} radius={(result.inputSnapshot.elements.find(e=>e.id===result.fourier!.screenId)?.diameterMm??40)/2}/>}<div className="sb-screen-results">{result.inputSnapshot.elements.some(e=>e.kind==='laser')&&result.screens.length?result.screens.map(s=>{
    const name=cleanElementDisplayName(s.name);
    const isCoherent=coherent?.screenId===s.elementId;
    const uvRelevant=!isCoherent&&hasRelevantAnisotropy(result,s.sampledRadiusUMm,s.sampledRadiusVMm);
    const polRelevant=!!s.polarizationStokes&&hasRelevantPolarization(result);
    const kpiLabel=isCoherent?'到屏功率（波动计算）':s.detectorKind==='power-meter'?'收集功率（几何采样）':s.hits?(s.gaussianRadiusMm!==null?'1/e² 高斯半径':'几何覆盖半径'):'到屏状态';
    const kpiValue=isCoherent?formatReadoutWithUnit(coherent!.capturedPowerMw,'mW'):s.detectorKind==='power-meter'?(s.overRange?'超量程':formatReadoutWithUnit(s.readingMw??0,'mW')):s.hits?formatReadoutWithUnit(s.gaussianRadiusMm??s.footprintRadiusMm??0,'mm'):'未到达';
    const contextNote=isCoherent
      ?`条纹后输入 ${formatReadoutWithUnit(coherent!.inputPowerMw,'mW')}`
      :s.detectorKind==='power-meter'
        ?(s.sampledPowerFraction<0.99?`占总功率 ${Math.round(s.sampledPowerFraction*100)}%`:null)
        :s.hits>0
          ?(beamSizeContext(result,s.gaussianRadiusMm)??(s.footprintRadiusMm!=null?`光斑覆盖范围约 ${formatReadoutWithUnit(s.footprintRadiusMm,'mm')}`:null))
          :'光线未命中，请检查位置与朝向';
    const showSplitPower=!isCoherent&&s.detectorKind!=='power-meter'&&s.hits>0&&(mayAttenuate||s.sampledPowerFraction<0.99);
    return <div key={s.elementId} className="sb-screen-card">
      <button type="button" className="sb-screen-card-select" onClick={()=>onSelect(s.elementId)}>
        <div className="sb-screen-card-head">
          <span className="sb-screen-name">{name}</span>
          <span className="sb-screen-locate">选中定位<ChevronRight size={13}/></span>
        </div>
        <span className="sb-screen-kpi-label">{kpiLabel}</span>
        <strong className="sb-screen-kpi">{kpiValue}</strong>
        {contextNote&&<small className={s.hits===0&&!isCoherent?'sb-screen-unlit':'sb-screen-context'}>{contextNote}</small>}
        {showSplitPower&&(
          <div className="sb-screen-kv">
            <div><span>到达功率</span><strong>{formatReadoutWithUnit(s.sampledPowerMw,'mW')}</strong></div>
            <div><span>通过占比</span><strong>{Math.round(s.sampledPowerFraction*100)}%</strong></div>
          </div>
        )}
      </button>
      {uvRelevant&&<p className="sb-screen-extra-line">横向 / 纵向半径：{formatReadoutWithUnit(s.sampledRadiusUMm!,'mm')} / {formatReadoutWithUnit(s.sampledRadiusVMm!,'mm')}</p>}
      {polRelevant&&s.polarizationStokes&&<PolarizationState state={s.polarizationStokes}/>}
    </div>;
  }):result.imaging?.length?null:<p>添加观察屏或功率计可以查看结果。</p>}</div>
  {!!result.diffraction?.length&&<div className="sb-diffraction-results">{result.diffraction.map(p=><DiffractionChart key={('gratingId' in p?p.gratingId:p.slitId)+p.screenId+p.sourceId} profile={p}/>)}</div>}
  {!!result.gratingOrders?.length&&<div className="sb-diffraction-results">{coherent?<details><summary>几何衍射级次</summary><GratingOrders result={result}/></details>:<GratingOrders result={result}/>}</div>}
  </div>
  {notes.warnings.length>0&&<div className="sb-warnings" role="status">{notes.warnings.map(w=><p key={w}>{w}</p>)}</div>}<details className="sb-calculation-details"><summary>计算说明</summary>{notes.scope.map(a=><p key={a}>{a}</p>)}</details></>;
}
