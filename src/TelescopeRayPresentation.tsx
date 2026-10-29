import {useTelescopeEye,TelescopeEyeLabel} from './TelescopeEyeView';
import {useTelescopeResolution,TelescopeResolutionLabel} from './TelescopeResolutionView';
import {createContext,useContext,useEffect,useState,type CSSProperties,type ReactNode} from 'react';
import type {SceneResult,SceneState} from './sceneRuntime';
import SceneQuantityLabel from './SceneQuantityLabel';
import SceneValue,{displayNumber} from './SceneValue';
import MicroscopeDetails from './MicroscopeDetails';
import {quantityColor} from './scenePresentation';
import {telescopeOptics} from './telescopeModel';

type Controls={selected:ReadonlySet<string>;toggle:(key:string)=>void;apparatus:boolean;setApparatus:(value:boolean)=>void};
const Context=createContext<Controls|null>(null);
export const useTelescopePresentation=()=>useContext(Context);
export function TelescopeRayProvider({enabled,children}:{enabled:boolean;children:ReactNode}){
  const [selected,setSelected]=useState<ReadonlySet<string>>(()=>new Set());
  const [apparatus,setApparatus]=useState(()=>{try{return localStorage.getItem('optics-telescope-presentation-v1')==='apparatus';}catch{return false;}});
  useEffect(()=>{if(enabled)try{localStorage.setItem('optics-telescope-presentation-v1',apparatus?'apparatus':'principle');}catch{/* The view remains usable without storage. */}},[enabled,apparatus]);
  const toggle=(key:string)=>setSelected(previous=>{const next=new Set(previous);if(next.has(key))next.delete(key);else next.add(key);return next;});
  return <Context.Provider value={enabled?{selected,toggle,apparatus,setApparatus}:null}>{children}</Context.Provider>;
}
export function TelescopePresentationSwitch(){
  const c=useTelescopePresentation();if(!c)return null;
  return <div className="os-microscope-presentation" role="group" aria-label="光路显示方式">{['原理光路','装置示意'].map((label,i)=><button type="button" key={label} aria-pressed={c.apparatus===!!i} onClick={()=>c.setApparatus(!!i)}>{label}</button>)}</div>;
}
export function TelescopeQuantityLabel({quantity,label}:{quantity:string;label:string}){
  const resolution=useTelescopeResolution(),eye=useTelescopeEye();
  const c=useTelescopePresentation(),content=<SceneQuantityLabel quantity={quantity} label={label} model="telescope"/>;
  if(eye)return <TelescopeEyeLabel quantity={quantity} label={label}/>;
  if(resolution)return <TelescopeResolutionLabel quantity={quantity} label={label}/>;
  if(!c||!['f1','f2','d','angle','centralAngle','aperture','eyepieceDiameter','afocalLength','angularSpread'].includes(quantity))return content;
  return <button type="button" className="os-quantity-toggle" aria-label={`查看${label.replace(/ [|A-Za-zθ].*$/,'')}图示`} aria-controls="telescope-ray-diagram" aria-pressed={c.selected.has(quantity)} onClick={()=>c.toggle(quantity)}>{content}</button>;
}
export function TelescopeRayResults({result}:{result:SceneResult}){
  const o=telescopeOptics(result.input.parameters),metric=(key:string)=>result.metrics.find(m=>m.key===key)!;
  const row=(key:string,label:string)=>{const m=metric(key);return <div key={key} style={{'--quantity-color':quantityColor(key,'telescope')} as CSSProperties}><dt><TelescopeQuantityLabel quantity={key} label={label}/></dt><dd data-testid={key==='angularM'?'telescope-primary':`telescope-metric-${key}`}><SceneValue value={key==='angularM'&&m.value!==null?Math.abs(m.value):m.value} unit={m.unit}/></dd></div>;};
  return <section className="gs-readouts os-microscope-readouts os-telescope-ray-results" aria-label="实时结果"><dl>
    {row('angularM','目视放大倍数 M')}
    {row('centralAngle','主光线出射角 θ′')}
    {row('afocalLength','平行出射所需间距')}
    {row('angularSpread','出射方向差')}
    <div style={{'--quantity-color':'#8a5eac'} as CSSProperties}><dt>成像方向</dt><dd>{o.afocal?(o.M!<0?'倒像':'正像'):'—'}</dd></div>
    <div style={{'--quantity-color':o.afocal?'#26836a':'#c16b37'} as CSSProperties}><dt>对焦状态</dt><dd data-testid="telescope-focus-status">{o.afocal?'已对焦':'未对焦'}</dd></div>
  </dl>
  <MicroscopeDetails id="telescope-ray-explanation" title="详细说明"><p>d = d₀ 时平行出射，Δθ′ = 0；未对焦可点击“恢复平行出射”。</p><p>开普勒倒像，伽利略正像。Δθ′ 按物镜全口径计算，单位 mrad（毫弧度）；采用理想薄透镜、小角度近似。</p>{result.warnings.filter(w=>!w.startsWith('两镜间距偏离')).map(w=><p className="os-warning" key={w}>{w}</p>)}</MicroscopeDetails></section>;
}

export function TelescopeRayOptics({state,result,x,y,width,height}:{state:SceneState;result:SceneResult;x:(n:number)=>number;y:(n:number)=>number;width:number;height:number}){
  const c=useTelescopePresentation(),p=state.parameters,axis=y(0),left=x(0),right=x(p.d),apparatus=!!c?.apparatus;
  const objective=Math.abs(y(p.aperture/2)-axis),eyepiece=Math.abs(y(p.eyepieceDiameter/2)-axis);
  const h1=objective+18,h2=eyepiece+18;
  const o=telescopeOptics(p);
  const selected=['f1','f2','d','afocalLength'].filter(key=>c?.selected.has(key));
  return <g className="os-telescope-ray-optics" pointerEvents="none">
    {apparatus&&<g data-testid="telescope-apparatus"><title>望远镜展开剖面示意。外壳不按实物比例绘制，不参与截光；镜片和光线位置沿用当前计算。</title>
      {right-left>44&&<><path d={`M${left+12} ${axis-h1}L${right-14} ${axis-h2}V${axis+h2}L${left+12} ${axis+h1}Z`} fill="#eef3f7" fillOpacity={.75} stroke="#aab8c7" strokeWidth={1.5}/><path d={`M${left+23} ${axis-h1+10}L${right-22} ${axis-h2+10} M${left+23} ${axis+h1-10}L${right-22} ${axis+h2-10}`} stroke="#d0dbe4" fill="none"/></>}
      {[{cx:left,h:h1},{cx:right,h:h2}].map(({cx,h},i)=><rect key={i} x={cx-10} y={axis-h} width={20} height={2*h} rx={5} fill="#dce5ec" fillOpacity={.7} stroke="#91a6b9"/>)}
    </g>}
    {result.devices?.map((dev,i)=>{const cx=x(dev.x),top=y(dev.height),bottom=y(-dev.height),color=quantityColor(i?'angularM':'f1');return <g key={i}>{apparatus?<path d={dev.sign>0?`M${cx} ${top}Q${cx-16} ${axis} ${cx} ${bottom}Q${cx+16} ${axis} ${cx} ${top}Z`:`M${cx-8} ${top}Q${cx+3} ${axis} ${cx-8} ${bottom}H${cx+8}Q${cx-3} ${axis} ${cx+8} ${top}Z`} fill="#c5e2ed" fillOpacity={.8} stroke={color} strokeWidth={1.5}/>:<path d={`M${cx} ${top}V${bottom} M${cx-9} ${top+dev.sign*10}L${cx} ${top}L${cx+9} ${top+dev.sign*10} M${cx-9} ${bottom-dev.sign*10}L${cx} ${bottom}L${cx+9} ${bottom-dev.sign*10}`} fill="none" stroke={color} strokeWidth={3}/>}<text x={cx} y={Math.max(46,top-(apparatus?34:16)-(i&&right-left<80?25:0))} textAnchor="middle" style={{fill:color}}>{dev.label}</text></g>;})}
    {selected.map((key,i)=>{const from=key==='f2'?p.d-p.k2*p.f2:0,to=key==='afocalLength'?p.f1+o.fe:key==='f1'?p.f1:p.d,lane=Math.max(55,Math.min(height-55-(selected.length-1)*30,axis+Math.max(objective,eyepiece)+55)+i*30),a=x(from),b=x(to),color=key==='f2'?'#8a5eac':quantityColor(key,'telescope'),symbol=key==='afocalLength'?'d₀':key==='f1'?'fₒ':key==='f2'?'|fₑ|':'d',outside=Math.min(a,b)<30||Math.max(a,b)>width-30;
      const ax=Math.max(30,Math.min(width-30,a)),bx=Math.max(30,Math.min(width-30,b));
      return <g key={key} className="os-telescope-ray-annotation" data-testid={`telescope-quantity-${key}`}><title>{symbol} = {key==='afocalLength'?p.f1+o.fe:p[key]} mm{outside?'；端点在图外':''}</title><path d={`M${ax} ${axis}V${lane} M${bx} ${axis}V${lane}`} stroke={color} opacity={.3} strokeDasharray="3 4"/><path d={`M${ax} ${lane}H${bx} M${ax} ${lane-4}V${lane+4} M${bx} ${lane-4}V${lane+4}`} stroke={color} strokeWidth={1.5} strokeDasharray={outside?'5 3':undefined}/><text x={(ax+bx)/2} y={lane-8} textAnchor="middle" style={{fill:color}}>{symbol}{key==='afocalLength'?` = ${displayNumber(p.f1+o.fe)} mm（对焦位置）`:''}{outside?'（端点在图外）':''}</text></g>;
    })}
    {c?.selected.has('angularSpread')&&(()=>{
      const color=quantityColor('angularSpread','telescope'),spread=Math.abs(o.c)*p.aperture*1000,cx=Math.max(32,width-190),cy=84,base=o.dd*p.angle*Math.PI/180;
      const angles=[Math.atan(base-o.c*p.aperture/2),Math.atan(base+o.c*p.aperture/2)].sort((a,b)=>a-b),point=(a:number,r:number)=>[cx+r*Math.cos(a),cy-r*Math.sin(a)];
      const a=point(angles[0],38),b=point(angles[1],38);
      return <g className="os-telescope-ray-annotation" data-testid="telescope-quantity-angularSpread" data-value={spread}>
        <rect x={cx-15} y={cy-54} width={180} height={112} rx={8} fill="white" fillOpacity={.94} stroke={color} strokeOpacity={.3}/>
        <text x={cx} y={cy-34} style={{fill:color,fontSize:12}}>全口径边缘光线方向对比</text>
        {angles.map((angle,i)=>{const end=point(angle,120);return <path key={i} d={`M${cx} ${cy}L${end[0]} ${end[1]}`} fill="none" stroke={color} strokeWidth={2} strokeDasharray={i?'5 3':undefined}/>;})}
        <path d={`M${a[0]} ${a[1]}A38 38 0 0 0 ${b[0]} ${b[1]}`} fill="none" stroke={color}/>
        <text x={cx} y={cy+38} style={{fill:color,fontSize:13}}>Δθ′ = {displayNumber(spread)} mrad{spread===0?'（平行）':''}</text>
      </g>;
    })()}
    {(['aperture','eyepieceDiameter'] as const).filter(key=>c?.selected.has(key)).map(key=>{
      const second=key==='eyepieceDiameter',cx=second?right:left,offset=second?30:-30,dimX=Math.max(40,Math.min(width-40,cx+offset)),top=y(p[key]/2),bottom=y(-p[key]/2),a=Math.max(30,Math.min(height-30,top)),b=Math.max(30,Math.min(height-30,bottom)),outside=a!==top||b!==bottom,color=quantityColor(key,'telescope'),labelX=dimX+(second?14:-12),mid=(a+b)/2,symbol=second?'Dₑ':'Dₒ';
      return <g key={key} className="os-telescope-ray-annotation" data-testid={`telescope-quantity-${key}`} data-value={p[key]} data-physical-top={p[key]/2} data-physical-bottom={-p[key]/2}>
        <title>{second?'目镜通光口径':'物镜有效直径'} {symbol} = {displayNumber(p[key])} mm{outside?'；端点在图外':''}</title>
        <path d={`M${cx} ${a}H${dimX} M${cx} ${b}H${dimX}`} stroke={color} strokeDasharray="3 3" opacity={.5}/>
        <path d={`M${dimX} ${a}V${b} M${dimX-4} ${a+5}L${dimX} ${a}L${dimX+4} ${a+5} M${dimX-4} ${b-5}L${dimX} ${b}L${dimX+4} ${b-5}`} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray={outside?'5 3':undefined}/>
        <text x={labelX} y={mid} textAnchor="middle" transform={`rotate(-90 ${labelX} ${mid})`} style={{fill:color,fontSize:13}}>{symbol} = {displayNumber(p[key])} mm{outside?'（端点在图外）':''}</text>
      </g>;
    })}
  </g>;
}
