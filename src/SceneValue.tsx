export function displayNumber(value:number|null):string {
  if(value===null)return '—';
  if(!Number.isFinite(value))return value>0?'∞':value<0?'−∞':'—';
  const magnitude=Math.abs(value);
  return magnitude!==0&&(magnitude<.01||magnitude>=1e6)?value.toExponential(2):String(Math.sign(value)*Math.round((magnitude+Number.EPSILON*magnitude)*100)/100);
}

export function sceneDisplayValue(value:number|null,unit:string){
  if(value===null)return {text:'—',unit:'',value:null};
  const scales:Record<string,[string,number]>={m:['mm',1000],mm:['μm',1000],'µm':['nm',1000],'μm':['nm',1000],nm:['pm',1000],'°':['角分',60],'角分':['角秒',60],mrad:['μrad',1000]};
  while(value!==0&&Math.abs(value)<1&&scales[unit]){
    const next=scales[unit];value*=next[1];unit=next[0];
  }
  return {text:displayNumber(value),unit,value};
}

export function sceneAxisDisplay(label:string,magnitude:number){
  const match=label.match(/^(.* \/ )(.+)$/);
  const shown=match?sceneDisplayValue(magnitude,match[2]):null;
  const factor=shown&&magnitude!==0?shown.value!/magnitude:1;
  return {label:match&&shown?match[1]+shown.unit:label,format:(n:number)=>displayNumber(n*factor)};
}

export default function SceneValue({value,unit,primary=false,unitClassName}:{value:number|null;unit:string;primary?:boolean;unitClassName?:string}){
  const shown=sceneDisplayValue(value,unit);
  return <>{shown.text}{shown.unit&&<> {primary?<small>{shown.unit}</small>:<span className={unitClassName}>{shown.unit}</span>}</>}</>;
}
