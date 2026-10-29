import {ABERRATION_SYMBOLS} from './aberrationQuantities';

export default function AberrationQuantitySymbol({quantity}:{quantity:string}){
  const symbol=ABERRATION_SYMBOLS[quantity];if(!symbol)return null;
  return <span className="os-physics-symbol" data-symbol={quantity} style={symbol.base==='BFL'?{fontStyle:'normal'}:undefined}>{symbol.base}{symbol.sub&&<sub>{symbol.sub}</sub>}</span>;
}
export function AberrationSvgSymbol({quantity}:{quantity:string}){
  const symbol=ABERRATION_SYMBOLS[quantity];if(!symbol)return null;
  return <tspan fontStyle={symbol.base==='BFL'?'normal':'italic'}>{symbol.base}{symbol.sub&&<tspan baselineShift="sub" fontSize=".75em" fontStyle="normal">{symbol.sub}</tspan>}</tspan>;
}
