import { useEffect, useState } from 'react';
import { formatNumber } from './formatNumber';
import type { ErrorEvaluation } from './tolerance';

export function ErrorChart({evaluation}:{evaluation:ErrorEvaluation}) {
  const [selected,setSelected]=useState<number|null>(null);
  useEffect(()=>setSelected(null),[evaluation]);
  const positions=evaluation.positionOffsetsMm,focals=evaluation.focalOffsetsPercent;
  const values=evaluation.rows.filter(row=>row.radiusMm!==null).map(row=>row.radiusMm!);
  const low=values.length?Math.min(...values):1,high=values.length?Math.max(...values):1;
  const color=(radius:number|null)=>{
    if(radius===null)return '#e2e8f0';
    const fraction=high===low?0:(radius-low)/(high-low);
    return `rgb(${239-fraction*194}, ${246-fraction*161}, ${255-fraction*95})`;
  };
  const row=selected===null?evaluation.worstSample:evaluation.rows[selected];
  const width=270/positions.length,height=135/focals.length;
  return <div className="error-chart"><svg viewBox="0 0 360 228" preserveAspectRatio="none" role="group" aria-label="位置与焦距偏差下的光斑变化图">
    <text x="8" y="20">焦距偏差 / %</text>
    {evaluation.rows.map((point,i)=>{const x=65+i%positions.length*width,y=40+(focals.length-1-Math.floor(i/positions.length))*height;const worst=point===evaluation.worstSample || (point.positionErrorMm===evaluation.worstSample?.positionErrorMm && point.focalErrorPercent===evaluation.worstSample?.focalErrorPercent);return <g key={i}><rect x={x} y={y} width={width} height={height} fill={color(point.radiusMm)} stroke={selected===i?'white':worst?'#804712':'none'} strokeWidth={worst || selected===i?2:0} role="button" tabIndex={0} aria-label={`位置偏差${formatNumber(point.positionErrorMm)}毫米，焦距偏差${formatNumber(point.focalErrorPercent)}百分比，${point.radiusMm===null?'无法计算':`半径${formatNumber(point.radiusMm)}毫米`}`} onClick={()=>setSelected(i)} onKeyDown={event=>{if(event.key==='Enter' || event.key===' '){event.preventDefault();setSelected(i);}}}><title>{point.error ?? `${point.radiusMm} mm${point.quality==='reference-only'?' · 仅作参考':''}`}</title></rect>{point.quality==='reference-only' && <path d={`M${x+2},${y+2}l6,0l-6,6z`} fill="#c2782b" pointerEvents="none"/>}</g>;})}
    <text x="58" y="51" textAnchor="end">{formatNumber(focals.at(-1)!)}</text>{focals.length>1 && <text x="58" y="175" textAnchor="end">{formatNumber(focals[0])}</text>}
    <text x="70" y="192">{formatNumber(positions[0])}</text>{positions.length>1 && <text x="331" y="192" textAnchor="end">{formatNumber(positions.at(-1)!)}</text>}<text x="200" y="216" textAnchor="middle">位置偏差 / mm</text>
  </svg><div className="design-color-legend"><span>{values.length?formatNumber(low):'—'} mm · 小</span><i/><span>{values.length?formatNumber(high):'—'} mm · 大</span></div><p className="plot-note">深框为已计算组合中的最大半径。点击色块查看数值；橙色角标为模型警告，灰色为无法计算。色标随所选方案变化。</p>{row && <p className="design-readout">{selected===null?'最大半径组合':'所选组合'}：位置偏差 {formatNumber(row.positionErrorMm)} mm，焦距偏差 {formatNumber(row.focalErrorPercent)}%；实际位置 {formatNumber(row.positionMm)} mm、焦距 {formatNumber(row.focalLengthMm)} mm，屏上半径 <b>{row.radiusMm===null?'—':`${formatNumber(row.radiusMm)} mm`}</b>。{row.error ?? row.warnings.join('；')}</p>}</div>;
}
