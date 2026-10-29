import {AberrationSvgSymbol} from './AberrationQuantitySymbol';
import {ABERRATION_SYMBOLS} from './aberrationQuantities';

export default function AberrationSpotMeasure({radius,extent}:{radius:number;extent:number}){
  const r=radius/extent*95,color=ABERRATION_SYMBOLS.rmsRadius.color,head=Math.min(5,r/3);
  return <g data-testid="aberration-spot-radius" data-radius-mm={radius} pointerEvents="none"><title>均方根半径，不是光斑外边界</title><circle cx={115} cy={115} r={r} fill="none" stroke="white" strokeWidth={4} opacity={.7}/><circle cx={115} cy={115} r={r} fill="none" stroke={color} strokeWidth={2}/><path d={`M115 115H${115+r}M${115+head} 111L115 115L${115+head} 119M${115+r-head} 111L${115+r} 115L${115+r-head} 119`} fill="none" stroke="white" strokeWidth={1.5}/><text x={115+r/2} y={104} textAnchor="middle" fill="white" fontSize={13}><AberrationSvgSymbol quantity="rmsRadius"/></text></g>;
}
