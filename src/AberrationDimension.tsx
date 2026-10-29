import {AberrationSvgSymbol} from './AberrationQuantitySymbol';

export default function AberrationDimension({quantity,start,end,x,y,color,width,vertical=false}:{quantity:string;start:number;end:number;x:number;y:number;color:string;width:number;vertical?:boolean}){
  const distance=Math.abs(end-start),head=Math.min(5,distance/3),lo=Math.min(start,end),hi=Math.max(start,end);
  return <g data-testid={`aberration-dimension-${quantity}`} data-start={start} data-end={end}>
    {vertical?<><line x1={x} x2={x} y1={start} y2={end} stroke={color}/><path d={`M${x-4} ${lo+head}L${x} ${lo}L${x+4} ${lo+head}M${x-4} ${hi-head}L${x} ${hi}L${x+4} ${hi-head}`} fill="none" stroke={color}/><text className="os-measure-symbol" x={x-10} y={(start+end)/2+4} textAnchor="end" style={{fill:color}}><AberrationSvgSymbol quantity={quantity}/></text></>:<>
      <path d={`M${start} ${y-8}V${y+8}M${end} ${y-8}V${y+8}M${start} ${y}H${end}M${lo+head} ${y-4}L${lo} ${y}L${lo+head} ${y+4}M${hi-head} ${y-4}L${hi} ${y}L${hi-head} ${y+4}`} fill="none" stroke={color} strokeWidth={1.4}/>
      <text className="os-measure-symbol" x={Math.max(50,Math.min(width-50,(start+end)/2))} y={y-12} textAnchor="middle" style={{fill:color}}><AberrationSvgSymbol quantity={quantity}/></text>
    </>}
  </g>;
}
