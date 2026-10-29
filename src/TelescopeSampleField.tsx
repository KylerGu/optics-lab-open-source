import {useId,useMemo} from 'react';
import type {SceneState} from './sceneRuntime';
import {telescopeThroughput} from './telescopeModel';
import {telescopeComparison,telescopeSampleResolution,telescopeVisibleAnnotation,TELESCOPE_COMPARISON_ANGLE,TELESCOPE_FIELD_RADIUS} from './telescopeFieldPresentation';
import {displayNumber} from './SceneValue';

// One fixed distant target, 0.6 degrees high. Signed angular magnification
// transforms the entire shape, including its strokes, about the optical axis.
const samplePath='M-.18-.3H.18V-.2H-.06V-.06H.12V.04H-.06V.3H-.18Z';
export default function TelescopeSampleField({state,reference=false,framed=false,showRange=false,showVisible=false,diagramId='telescope-field-diagram'}:{state:SceneState;reference?:boolean;framed?:boolean;showRange?:boolean;showVisible?:boolean;diagramId?:string|null}){
  const p=state.parameters,comparison=telescopeComparison(p),M=reference?1:comparison?.M??1;
  const clarity=telescopeSampleResolution(p),sampleRatio=(p.sampleAngleDeg??.6)/.6;
  const id=useId().replace(/:/g,''),scale=TELESCOPE_FIELD_RADIUS/(TELESCOPE_COMPARISON_ANGLE/2);
  const valid=reference||comparison!==null,angle=reference?6:comparison?.skyAngle??null;
  const bar=angle===null?0:10**Math.floor(Math.log10(angle/3)),barWidth=angle===null?0:260*bar/angle;
  // Sample illumination in object angles, so aperture and eye settings keep
  // their existing geometrical effect. Blur is applied after the F clip.
  const illumination=useMemo(()=>reference?[]:Array.from({length:24*40},(_,i)=>{
    const x=-.18+(i%24)*.015,y=-.3+Math.floor(i/24)*.015;
    return {x,y,light:telescopeThroughput(p,(x+.0075)*sampleRatio*Math.PI/180,-(y+.0075)*sampleRatio*Math.PI/180)};
  }),[p,reference,sampleRatio]);
  return <svg id={framed?diagramId??undefined:undefined} viewBox={`0 0 280 ${framed?320:280}`} className={framed?'os-microscope-preview os-telescope-field-frame':'os-telescope-stars os-telescope-field'} role="img" aria-label={reference?(comparison&&Math.abs(comparison.M)<1?'原始 F 样品，目视图观察范围更大':'原始 F 样品，绿色圆圈对应目视图观察范围'):valid?`望远镜中的同一个 F 样品，${M<0?'倒像':'正像'}`:'当前未对焦，请恢复平行出射'} data-testid={reference?'telescope-reference-field':'telescope-magnified-field'} data-magnification={valid?M:''} data-sky-angle={angle??''} data-resolution={clarity.resolution} data-blur-pixels={reference?0:clarity.sigmaPixels??''}>
    <defs><filter id={`${id}-resolution`} x={-.35*sampleRatio} y={-.48*sampleRatio} width={.7*sampleRatio} height={.96*sampleRatio} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB"><feGaussianBlur stdDeviation={clarity.sigmaDegrees}/></filter><clipPath id={`${id}-field`}><circle cx={140} cy={140} r={130}/></clipPath><clipPath id={`${id}-sample`}><path d={samplePath} transform={`scale(${sampleRatio})`}/></clipPath></defs>
    {framed&&<rect width={280} height={320} rx={10} fill="#10213b"/>}
    <circle cx={140} cy={140} r={130} fill="#193754"/>
    {valid?<g clipPath={`url(#${id}-field)`}>
      <path d="M10 140H270 M140 10V270" stroke="#7697b0" strokeOpacity={.28}/>
      {reference&&comparison&&<circle cx={140} cy={140} r={Math.min(130,comparison.selectionRadius)} fill="#77d3b9" fillOpacity={.06} stroke="#77d3b9" strokeWidth={1.5} strokeDasharray="4 3" data-testid="telescope-selected-region" data-radius={comparison.selectionRadius}/>}
      <g transform={`translate(140 140) scale(${M*scale})`} data-testid={reference?'telescope-reference-sample':'telescope-magnified-sample'} data-sample-angle={p.sampleAngleDeg??.6} data-orientation={Math.sign(M)}>
        {reference?<path d={samplePath} transform={`scale(${sampleRatio})`} fill="#e8c594"/>:<g filter={`url(#${id}-resolution)`}><g clipPath={`url(#${id}-sample)`}>{illumination.map((cell,i)=><rect key={i} x={cell.x*sampleRatio} y={cell.y*sampleRatio} width={.015*sampleRatio} height={.015*sampleRatio} shapeRendering="crispEdges" fill="#e8c594" fillOpacity={Math.sqrt(cell.light)}/>)}</g></g>}
      </g>
    </g>:<text x={140} y={145} textAnchor="middle" className="os-telescope-field-message">请先恢复平行出射</text>}
    <circle cx={140} cy={140} r={130} fill="none" stroke="#7894ad"/>
    {framed&&valid&&<><path d={`M24 300H${24+barWidth} M24 296V304 M${24+barWidth} 296V304`} fill="none" stroke="#d7e7f2" strokeWidth={1.5}/><text x={24+barWidth+8} y={304} className="os-telescope-field-scale">{displayNumber(bar)}°</text></>}
    {showVisible&&valid&&comparison&&(()=>{
      const annotation=telescopeVisibleAnnotation(p,reference);
      if(!annotation)return null;
      const {field,a,b,value}=annotation,color='#8fbeff';
      return <g className="os-telescope-visible-annotation" pointerEvents="none" data-testid="telescope-visible-angle-annotation" data-value={value} data-left={field?.[0]} data-right={field?.[1]}>
        <title>模型内可见角宽 βᵥ = {displayNumber(value)}°；水平通光范围</title>
        {field&&<><path d={`M${a} 140V155 M${b} 140V155 M${a} 150H${b}`} fill="none" stroke={color} strokeWidth={2}/><circle cx={a} cy={150} r={2.5} fill={color}/><circle cx={b} cy={150} r={2.5} fill={color}/></>}
        <text x={140} y={174} textAnchor="middle" style={{fill:color,fontSize:12}}>βᵥ = {displayNumber(value)}°</text>

      </g>;
    })()}
    {showRange&&valid&&<g className="os-telescope-field-annotation" pointerEvents="none" data-testid="telescope-field-angle-annotation" data-value={angle}><title>图中观察角宽 β = {displayNumber(angle)}°</title><path d="M10 140H270 M15 136L10 140L15 144 M265 136L270 140L265 144" fill="none" stroke="#77d3b9" strokeWidth={1.5}/><text x={140} y={129} textAnchor="middle">β</text></g>}
  </svg>;
}
