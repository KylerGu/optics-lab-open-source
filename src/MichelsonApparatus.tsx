import { useId, useRef, type PointerEvent, type KeyboardEvent } from 'react';
import { MICHELSON_FIELDS, type MichelsonParameters } from './michelson';
import { MICHELSON_QUANTITIES } from './michelsonAnnotations';

export type MichelsonDevice='mirror1'|'mirror2'|'source'|'lens'|'splitter'|'compensator'|'screen';
export type MichelsonPath='both'|'arm1'|'arm2';
export const MICHELSON_DEVICE_NAMES:Record<MichelsonDevice,string>={mirror1:'第一反射镜 M₁',mirror2:'第二反射镜 M₂',source:'入射光源',lens:'观察透镜',splitter:'分光镜 BS',compensator:'补偿板 C',screen:'观察屏'};
export const MICHELSON_DEVICE_FIELDS:Partial<Record<MichelsonDevice,keyof MichelsonParameters>>={mirror1:'mirror1MoveUm',mirror2:'mirrorMoveUm',source:'sourceDistanceMm',lens:'lensDistanceMm'};
type Props={p:MichelsonParameters;view:'perspective'|'top';labelScale:number;path:MichelsonPath;selected:MichelsonDevice;annotations:string[];onSelect:(id:MichelsonDevice)=>void;onStart:()=>void;onChange:(key:keyof MichelsonParameters,value:number)=>void;onFinish:()=>void};
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));

/** An original vector illustration. Optical axes are constrained, not freely tilted. */
export default function MichelsonApparatus({p,view,labelScale,path,selected,annotations,onSelect,onStart,onChange,onFinish}:Props){
  const uid='ma'+useId().replace(/:/g,''),svg=useRef<SVGSVGElement>(null),iso=view==='perspective';
  // Local magnification makes sub-micrometre translations visible. Copy uses actual mm.
  const m1=105+p.mirror1MoveUm*28,m2=105+p.baseDifferenceUm*.018+p.mirrorMoveUm*28;
  const source=-p.sourceDistanceMm*.72,lens=-p.lensDistanceMm*.75,screen=lens-45-p.focalLengthMm*.1;
  const project=(x:number,z:number,h=40):[number,number]=>iso?[228+x*.94+z*.64,188+x*.26-z*.50-h*.95]:[228+x,172-z];
  const pts=(points:number[][])=>points.map(([x,z,h=0])=>project(x,z,h).join(',')).join(' ');
  const line=(points:number[][])=>points.map(([x,z,h=40],i)=>`${i?'L':'M'}${project(x,z,h).join(' ')}`).join(' ');
  const drag=useRef<{id:number;field:keyof MichelsonParameters;start:number;point:[number,number];axis:[number,number];scale:number}|null>(null);
  const deviceAxis=(id:MichelsonDevice):[number,number]=>id==='mirror1'?iso?[.94,.26]:[1,0]:id==='source'?iso?[-.94,-.26]:[-1,0]:iso?[-.64,.50]:[0,1];
  const begin=(e:PointerEvent<SVGGElement>,id:MichelsonDevice)=>{
    if(e.button!==0)return;e.stopPropagation();e.preventDefault();onSelect(id);e.currentTarget.focus();const field=MICHELSON_DEVICE_FIELDS[id];if(!field)return;
    const ctm=svg.current!.getScreenCTM()!.inverse(),pt=new DOMPoint(e.clientX,e.clientY).matrixTransform(ctm);onStart();
    drag.current={id:e.pointerId,field,start:p[field],point:[pt.x,pt.y],axis:deviceAxis(id),scale:id==='mirror1'||id==='mirror2'?28:id==='source'?.72:.75};
    // M2 moves outward in +z, whereas source and observation lens move in -x/-z.
    if(id==='mirror2')drag.current.axis=iso?[.64,-.50]:[0,-1];
    svg.current!.setPointerCapture(e.pointerId);
  };
  const end=()=>{if(drag.current){drag.current=null;onFinish();}};
  const keyboard=(e:KeyboardEvent<SVGGElement>,id:MichelsonDevice)=>{
    const field=MICHELSON_DEVICE_FIELDS[id];if(!field||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
    e.preventDefault();onSelect(id);const f=MICHELSON_FIELDS.find(f=>f.key===field)!;onStart();onChange(field,clamp(p[field]+(['ArrowRight','ArrowUp'].includes(e.key)?1:-1)*f.step*(e.shiftKey?10:1),f.min,f.max));onFinish();
  };
  const props=(id:MichelsonDevice)=>{const field=MICHELSON_DEVICE_FIELDS[id],f=MICHELSON_FIELDS.find(f=>f.key===field);return {'data-device':id,'data-testid':`michelson-device-${id}`,className:`ma-device ${selected===id?'is-selected':''} ${field?'is-movable':''}`,role:field?'slider':'button',tabIndex:0,'aria-label':MICHELSON_DEVICE_NAMES[id],'aria-valuenow':field?p[field]:undefined,'aria-valuemin':f?.min,'aria-valuemax':f?.max,onPointerDown:(e:PointerEvent<SVGGElement>)=>begin(e,id),onKeyDown:(e:KeyboardEvent<SVGGElement>)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(id);}else keyboard(e,id);}};};
  const base=(x:number,z:number)=>iso?<g><polygon points={pts([[x-14,z-12,0],[x+14,z-12,0],[x+14,z+12,0],[x-14,z+12,0]])} fill={`url(#${uid}-metal)`} stroke="#95a7ba"/><path d={line([[x,z,3],[x,z,25]])} stroke="#71889d" strokeWidth={5}/><path d={line([[x,z,3],[x,z,25]])} stroke="#c5d2dc" strokeWidth={2}/>{[-8,8].map(k=>{const q=project(x+k,z,0);return <circle key={k} cx={q[0]} cy={q[1]} r={1.8} fill="#708397"/>;})}</g>:<rect x={project(x,z)[0]-21} y={project(x,z)[1]-14} width={42} height={28} rx={4} fill="#e7edf4" stroke="#b9c8d7"/>;
  const optic=(id:MichelsonDevice,x:number,z:number,n:'x'|'z'|'diagonal',glass=false)=>{
    const q=project(x,z),angle=n==='x'?(iso?-53:90):n==='z'?(iso?16:0):(iso?-10:-45);
    return <g {...props(id)}>{base(x,z)}<g transform={`translate(${q}) rotate(${angle})`}><rect x={-29} y={-27} width={58} height={54} fill="transparent"/><rect x={-7} y={-24} width={14} height={48} rx={5} fill={glass?`url(#${uid}-glass)`:`url(#${uid}-mirror)`} stroke={selected===id?'#387fd4':'#70879d'} strokeWidth={selected===id?2.4:1.2}/>{!glass&&<><rect x={8} y={-20} width={5} height={40} rx={2} fill="#576d82"/><path d="M-4 -17V17" stroke="#e9f8ff" strokeWidth={2}/>{[-17,17].map(v=><g key={v}><circle cx={15} cy={v} r={4.5} fill="#53697d" stroke="#c0cdd7"/><path d={`M12 ${v}h6`} stroke="#d0dce7"/></g>)}<rect x={15} y={-4} width={19} height={8} rx={2} fill="#879bad"/><path d="M28 -5v10 M31 -5v10" stroke="#3f566d"/></>}</g></g>;
  };
  const title=(id:MichelsonDevice,x:number,z:number,label:string,dx=0,dy=-35)=>{
    const q=project(x,z),compact=labelScale>1.6;
    const external:Record<MichelsonDevice,[number,number,'start'|'middle'|'end']>={source:[55,95,'start'],mirror2:[420,30,'end'],mirror1:[435,210,'end'],splitter:[28,181,'start'],compensator:[230,125,'middle'],lens:[105,276,'start'],screen:[390,313,'end']};
    const [tx,ty,anchor]=compact?external[id]:[q[0]+dx*labelScale,q[1]+dy*labelScale,'middle'] as const;
    return <g pointerEvents="none">{compact&&<path d={`M${q}L${tx} ${ty-5*labelScale}`} stroke="#9cafc0" strokeWidth={.8}/>}<text className={`ma-label ${selected===id?'is-selected':''}`} style={{fontSize:12*labelScale}} x={tx} y={ty} textAnchor={anchor}>{label}</text></g>;
  };
  const dim=(name:keyof typeof MICHELSON_QUANTITIES,a:number[],b:number[],start:number[],end:number[],label:string)=>{
    if(!annotations.includes(name))return null;
    const qa=project(a[0],a[1]),qb=project(b[0],b[1]),pa=project(start[0],start[1]),pb=project(end[0],end[1]),color=MICHELSON_QUANTITIES[name].color;
    return <g className="ma-dimension" pointerEvents="none" data-testid={`michelson-annotation-${name}`}><title>{MICHELSON_QUANTITIES[name].meaning}</title><path d={`M${pa}L${qa}M${pb}L${qb}`} stroke={color} strokeOpacity={.45} strokeDasharray="3 3"/><path d={`M${qa}L${qb}`} stroke={color}/><circle cx={qa[0]} cy={qa[1]} r={2} fill={color}/><circle cx={qb[0]} cy={qb[1]} r={2} fill={color}/><text style={{fontSize:12*labelScale}} x={(qa[0]+qb[0])/2} y={(qa[1]+qb[1])/2-(name==='arm2Mm'?24:7)*labelScale} textAnchor="middle" fill={color}>{label}</text></g>;
  };
  const micro=(key:'mirror1MoveUm'|'mirrorMoveUm')=>{
    if(!annotations.includes(key))return null;
    const first=key==='mirror1MoveUm',initial=first?105:105+p.baseDifferenceUm*.018,current=first?m1:m2,color=MICHELSON_QUANTITIES[key].color;
    const origin=first?project(initial,-112):project(76,initial),now=first?project(current,-112):project(76,current),mirrorZero=first?project(initial,0):project(0,initial),mirrorNow=first?project(current,0):project(0,current);
    const ticks=(q:[number,number])=>`M${q[0]} ${q[1]-4}V${q[1]+4}`;
    return <g className="ma-micro" pointerEvents="none" data-testid={`michelson-annotation-${key}`}><title>{MICHELSON_QUANTITIES[key].meaning} 虚线刻度为初始位置。</title><path d={`M${mirrorZero}L${origin}`} stroke={color} strokeOpacity={.45} strokeDasharray="3 3"/><path d={ticks(origin)} stroke={color} strokeDasharray="2 2"/>{p[key]!==0&&<><path d={`M${mirrorNow}L${now}`} stroke={color} strokeOpacity={.45} strokeDasharray="3 3"/><path d={`M${origin}L${now}${ticks(now)}`} stroke={color} strokeWidth={1.4}/></>}
      <text className="ma-reading" style={{fontSize:11*labelScale,fill:color}} x={first?20:425} y={300} textAnchor={first?'start':'end'}>{first?'第一镜微调 s₁':'第二镜微调 s₂'}</text>
      <text className="ma-reading" style={{fontSize:11*labelScale,fill:color}} x={first?20:425} y={318} textAnchor={first?'start':'end'}>{Number(p[key].toFixed(4))} μm</text>
    </g>;
  };
  return <svg ref={svg} className="michelson-apparatus" data-view={view} viewBox="0 0 445 330" role="group" aria-label="可操作的迈克耳孙装置：拖动两面反射镜、光源或观察透镜" onPointerMove={e=>{const d=drag.current;if(!d||d.id!==e.pointerId)return;const q=new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse()),f=MICHELSON_FIELDS.find(f=>f.key===d.field)!;const movement=((q.x-d.point[0])*d.axis[0]+(q.y-d.point[1])*d.axis[1])/(d.axis[0]**2+d.axis[1]**2)/d.scale;onChange(d.field,Number(clamp(d.start+movement,f.min,f.max).toFixed(6)));}} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
    <defs><linearGradient id={`${uid}-metal`} x2="0" y2="1"><stop stopColor="#f1f5f9"/><stop offset="1" stopColor="#bac9d6"/></linearGradient><linearGradient id={`${uid}-mirror`}><stop stopColor="#52758e"/><stop offset=".45" stopColor="#d6edf7"/><stop offset="1" stopColor="#829caf"/></linearGradient><linearGradient id={`${uid}-glass`}><stop stopColor="#c8eaf5" stopOpacity=".9"/><stop offset=".5" stopColor="#f7fcff" stopOpacity=".65"/><stop offset="1" stopColor="#8cb5ce" stopOpacity=".8"/></linearGradient>{['one','two'].map((key,i)=><marker key={key} id={`${uid}-${key}`} markerWidth={6} markerHeight={6} refX={4} refY={3} orient="auto"><path d="M0 0L5 3L0 6" fill="none" stroke={i?'#bf703f':'#357fc6'} strokeWidth={1.2}/></marker>)}</defs>
    {iso?<><polygon points={pts([[-155,-125,-7],[150,-125,-7],[150,145,-7],[-155,145,-7]])} fill="#c7d2df" stroke="#a7b8c9"/><polygon points={pts([[-155,-125,0],[150,-125,0],[150,145,0],[-155,145,0]])} fill="#edf2f6" stroke="#bdcbd9"/>{Array.from({length:12},(_,i)=>Array.from({length:10},(_,j)=>{const q=project(-140+i*25,-110+j*25,0);return <circle key={`${i}-${j}`} cx={q[0]} cy={q[1]} r={1.1} fill="#c3cfda"/>;}))}</>:<rect x={56} y={30} width={330} height={288} rx={12} fill="#f1f5f9" stroke="#d2dde8"/>}
    <path d={line([[source,0],[0,0]])} stroke="#99b4c9" strokeWidth={2} fill="none"/>
    <g opacity={path==='arm2'?.12:1} data-testid="michelson-arm1-path"><path d={line([[0,-2],[m1,-2],[m1,2],[2,2],[2,screen]])} fill="none" stroke="#357fc6" strokeWidth={2}/><path d={line([[m1*.25,-2],[m1*.43,-2]])} fill="none" stroke="#357fc6" markerEnd={`url(#${uid}-one)`}/><path d={line([[m1*.7,2],[m1*.5,2]])} fill="none" stroke="#357fc6" markerEnd={`url(#${uid}-one)`}/></g>
    <g opacity={path==='arm1'?.12:1} data-testid="michelson-arm2-path"><path d={line([[-2,0],[-2,m2],[2,m2],[2,4],[-2,4],[-2,screen]])} fill="none" stroke="#bf703f" strokeWidth={2}/><path d={line([[-2,m2*.25],[-2,m2*.43]])} fill="none" stroke="#bf703f" markerEnd={`url(#${uid}-two)`}/><path d={line([[2,m2*.7],[2,m2*.5]])} fill="none" stroke="#bf703f" markerEnd={`url(#${uid}-two)`}/></g>
    <g {...props('source')}>{base(source,0)}<g transform={`translate(${project(source,0)}) rotate(${iso?16:0})`}><rect x={-38} y={-16} width={38} height={32} rx={5} fill={`url(#${uid}-metal)`} stroke="#69839a"/><rect x={-29} y={-11} width={18} height={22} rx={2} fill="#465e74"/><ellipse cx={0} cy={0} rx={4} ry={10} fill="#83bfd4" stroke="#437e99"/><rect x={-41} y={-20} width={49} height={43} fill="transparent"/></g></g>
    {optic('mirror2',0,m2,'z')}{optic('mirror1',m1,0,'x')}{optic('compensator',m1*.55,0,'diagonal',true)}{optic('splitter',0,0,'diagonal',true)}
    <g {...props('lens')}>{base(0,lens)}<g transform={`translate(${project(0,lens)}) rotate(${iso?16:0})`}><rect x={-27} y={-26} width={54} height={52} fill="transparent"/><ellipse rx={7} ry={21} fill={`url(#${uid}-glass)`} stroke={selected==='lens'?'#387fd4':'#7999b4'} strokeWidth={2}/></g></g>
    <g {...props('screen')}>{base(0,screen)}<g transform={`translate(${project(0,screen)}) rotate(${iso?16:0})`}><rect x={-5} y={-23} width={10} height={46} rx={2} fill="#fff" stroke="#8299ad"/><line x1={-6} x2={6} y1={0} y2={0} stroke="#89a3bc"/></g></g>
    {dim('arm1Mm',[0,-105],[m1,-105],[0,0],[m1,0],'第一臂 L₁')}{dim('arm2Mm',[-85,0],[-85,m2],[0,0],[0,m2],'第二臂 L₂')}
    {dim('sourceDistanceMm',[source,70],[0,70],[source,0],[0,0],'光源距离')}
    {dim('lensDistanceMm',[82,0],[82,lens],[0,0],[0,lens],'透镜位置')}
    {dim('focalLengthMm',[-82,lens],[-82,screen],[0,lens],[0,screen],'焦距 f')}
    {title('source',source,0,'光源',-10,-27)}{title('mirror1',m1,0,'反射镜 M₁',25,-28)}{title('mirror2',0,m2,'反射镜 M₂',16,-30)}{title('splitter',0,0,'分光镜',-24,-26)}{title('compensator',m1*.55,0,'补偿板',0,-27)}{title('lens',0,lens,'透镜',24,-22)}{title('screen',0,screen,'观察屏',32,-13)}
    {micro('mirror1MoveUm')}{micro('mirrorMoveUm')}
    </svg>;
}
