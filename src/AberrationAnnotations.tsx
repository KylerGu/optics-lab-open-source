import {AberrationResultLabel} from './AberrationReadouts';
import type {CSSProperties} from 'react';
import SceneValue, {displayNumber as numberText} from './SceneValue';
import {ABERRATION_COLORS,aberrationDimensions,aberrationFocal,aberrationFocusGuides} from './aberrationModel';
import {type SceneResult,type SceneState} from './sceneRuntime';
import {aberrationMeasure,ABERRATION_SYMBOLS,type AberrationQuantity} from './aberrationQuantities';
import {AberrationSvgSymbol} from './AberrationQuantitySymbol';
import AberrationDimension from './AberrationDimension';

export default function AberrationAnnotations({result,state,x,y,width,height,selected}:{result:SceneResult;state:SceneState;x:(n:number)=>number;y:(n:number)=>number;width:number;height:number;selected:AberrationQuantity|null}){
  const p=state.parameters,t=aberrationDimensions(p).thickness,measure=selected&&(selected!=='chromaticShift'||p.mode===1)?aberrationMeasure(result,selected):null;
  const screenHeight=result.devices?.find(device=>device.kind==='screen')?.height??p.diameter/2;
  const pathBottom=Math.max(y(-p.diameter/2),y(-screenHeight),...result.segments.flatMap(segment=>[y(segment.start[1]),y(segment.end[1])]));
  const screenDimensionY=Math.min(height-38,Math.max(pathBottom+28,measure?.start!=null&&measure.end!=null?Math.min(height-95,y(0)+110)+38:0));
  return <g pointerEvents="none" data-testid="aberration-annotations">
    {aberrationFocusGuides(result).map((guide,i)=><line key={`guide-${i}`} data-testid="aberration-focus-guide" x1={x(guide.start[0])} y1={y(guide.start[1])} x2={x(guide.end[0])} y2={y(guide.end[1])} stroke={guide.color} strokeWidth={1.5} strokeDasharray="5 5" opacity={.5}><title>移开观察屏后的几何光路参考，实际光线在屏上终止</title></line>)}
    {p.mode===1&&[450,550,650].map((wave,i)=>{const focus=t+aberrationFocal(p,wave).back,color=ABERRATION_COLORS[wave];return <g key={wave} data-testid={`aberration-focus-${wave}`} data-position={focus}><title>{wave} nm近轴焦点，后焦距{numberText(focus-t)} mm</title><line x1={x(focus)} x2={x(focus)} y1={y(0)+7} y2={y(0)+22+i*9} stroke={color} strokeWidth={2}/><circle cx={x(focus)} cy={y(0)} r={3} fill={color}/></g>;})}
    {result.markers.map((marker,i)=>{const edge=marker.label==='边缘焦点',end=x(marker.x)>width-120,cx=Math.max(35,Math.min(width-35,x(marker.x)+(end?-12:12))),cy=y(0)+(edge?60:-64),color=edge?'#b8792e':'#357fc6';return <g key={`focus-${i}`} data-testid={edge?'aberration-marginal-marker':'aberration-paraxial-marker'} data-position={marker.x}><title>{marker.label}：距后顶点{numberText(marker.x-t)} mm；屏挡在前方时为移开屏后的参考位置</title><path data-testid="aberration-focus-leader" d={`M${x(marker.x)} ${y(0)+(edge?7:-7)} L${x(marker.x)} ${cy+(edge?-15:12)} L${cx} ${cy+(edge?-15:12)}`} fill="none" stroke={color} strokeWidth={1.3}/><circle cx={x(marker.x)} cy={y(0)} r={5} fill="white" stroke={color} strokeWidth={2}/><text x={cx} y={cy} textAnchor={end?'end':'start'} style={{fontSize:13,fill:color}}>{marker.label}</text></g>;})}
    <AberrationDimension quantity="diameter" start={y(p.diameter/2)} end={y(-p.diameter/2)} x={x(0)-20} y={0} color={ABERRATION_SYMBOLS.diameter.color} width={width} vertical/>
    <AberrationDimension quantity="screen" start={x(t)} end={x(t+p.screen)} x={0} y={screenDimensionY} color={ABERRATION_SYMBOLS.screen.color} width={width}/>
    {selected==='index'&&<g data-testid="aberration-quantity-index"><polygon points={result.regions[0].points.map(([a,b])=>`${x(a)},${y(b)}`).join(' ')} fill={measure!.color} fillOpacity={.15} stroke={measure!.color} strokeWidth={2}/><text x={x(t/2)} y={y(0)+28} style={{fill:measure!.color}} textAnchor="middle" className="os-measure-symbol"><AberrationSvgSymbol quantity="index"/></text></g>}
    {measure?.start!==null&&measure?.start!==undefined&&measure.end!==null&&<g data-testid={`aberration-selected-${selected}`} data-start-mm={measure.start} data-end-mm={measure.end} data-value-mm={measure.value}>
      {selected!=='chromaticShift'&&[measure.start,measure.end].map((position,i)=><line key={i} x1={x(position)} x2={x(position)} y1={y(0)+7} y2={Math.min(height-103,y(0)+102)} stroke={measure.color} strokeDasharray="3 4" opacity={.65}/>)}
      <AberrationDimension quantity={selected!} start={x(measure.start)} end={x(measure.end)} x={0} y={Math.min(height-95,y(0)+110)} color={measure.color} width={width}/>
      {(selected==='thickness'||selected?.startsWith('backFocal')||selected==='marginalFocus')&&<text x={x(t)+8} y={y(0)-14} style={{fill:measure.color}} className="os-measure-symbol">V′</text>}
      {selected==='thickness'&&<text x={x(0)-8} y={y(0)-14} textAnchor="end" style={{fill:measure.color}} className="os-measure-symbol">V</text>}
      {selected==='effectiveFocal'&&<g data-testid="aberration-principal-plane" data-position={measure.start}><line x1={x(measure.start)} x2={x(measure.start)} y1={y(p.diameter/2)-15} y2={Math.min(height-100,y(0)+100)} stroke={measure.color} strokeDasharray="3 3"/><text x={x(measure.start)+8} y={y(p.diameter/2)-23} style={{fill:measure.color}} className="os-measure-symbol">H′</text></g>}
      {selected==='chromaticShift'&&[450,650].map(wave=>{const position=t+aberrationFocal(p,wave).back;return <g key={wave}><line x1={x(position)} x2={x(position)} y1={y(0)+6} y2={Math.min(height-100,y(0)+100)} stroke={ABERRATION_COLORS[wave]} strokeDasharray="3 3"/><text x={x(position)+(wave===450?-8:8)} y={y(0)+88} textAnchor={wave===450?'end':'start'} style={{fill:ABERRATION_COLORS[wave]}} className="os-measure-symbol">{wave} nm</text></g>;})}
    </g>}
  </g>;
}

export function AberrationFocalReadouts({state,selected,onSelect}:{state:SceneState;selected:AberrationQuantity|null;onSelect:(key:AberrationQuantity|null)=>void}){
  if(state.parameters.mode!==1)return null;
  return <section className="os-aberration-focal-readouts" aria-label="三色近轴后焦距"><h3>三色近轴后焦距</h3><dl className="os-aberration-readouts">{[450,550,650].map((wave,i)=>{const key=`backFocal${wave}` as AberrationQuantity,label=['蓝光','绿光','红光'][i];return <div key={wave} data-selected={selected===key} style={{'--quantity-color':ABERRATION_SYMBOLS[key].color} as CSSProperties}><dt><AberrationResultLabel label={label} fullLabel={label+'近轴后焦距'} quantity={key} selected={selected} onSelect={onSelect}/></dt><dd data-testid={`scene-metric-${key}`}><SceneValue value={aberrationFocal(state.parameters,wave).back} unit="mm"/></dd></div>;})}</dl></section>;
}
