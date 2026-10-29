import {microscopeFocusDistance,microscopeDefocusRange} from './microscopeFocus';
import MicroscopeDetails from './MicroscopeDetails';
import {quantityColor} from './scenePresentation';
import {MicroscopeQuantityLabel,MicroscopeDimension} from './MicroscopeAnnotations';
import SceneValue, {displayNumber as numberText,sceneDisplayValue} from './SceneValue';
import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { microscopePerformance } from './microscopePerformance';
import { SCENE_DEFINITIONS,  type SceneParameter, type SceneResult, type SceneState } from './sceneRuntime';

export function microscopeFields(state:SceneState) {
  const camera=state.parameters.mode===1;
  const main=camera?['f1','tubeF','d','u','h']:['f1','f2','d','u','h'];
  const observation=camera?['adapter']:['near'];
  const field=camera?['sensorW','sensorH']:['fieldNumber'];
  const display=camera?['displayWidth']:[];
  const labels:Record<string,string>={f1:'物镜焦距 fₒ',f2:'目镜焦距 fₑ',tubeF:'管镜焦距 fₜ',d:camera?'物镜到管镜距离 d':'物镜到目镜距离 d',u:'物距 u'};
  const fields=SCENE_DEFINITIONS[state.sceneId].parameters;
  const get=(keys:string[])=>keys.map(key=>{const f=fields.find(f=>f.key===key)!;return {...f,label:labels[key]??f.label};});
  return {main:get(main),observation:get(observation),field:get(field),display:get(display)};
}

export function MicroscopeControls({state,onCommit,renderField}:{state:SceneState;onCommit:(p:Record<string,number>)=>void;renderField:(p:SceneParameter)=>ReactNode}) {
  const p=state.parameters,camera=p.mode===1,fields=microscopeFields(state);
  const close=(a:number,b:number)=>Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b));
  const magnifications=camera?[10,20,40]:[10,12.5,15,20];
  const selectedMagnification=magnifications.find(n=>camera?close(p.f1,200/n)&&close(p.tubeF,200):close(p.f2,250/n)&&close(p.near,250));
  const sensorSizes=[[8.8,6.6],[13.2,8.8],[6.4,4.8]];
  const selectedSensor=sensorSizes.find(([w,h])=>close(p.sensorW,w)&&close(p.sensorH,h));
  const eyeU=p.d-p.f2>p.f1?p.f1*(p.d-p.f2)/(p.d-p.f2-p.f1):NaN;
  if(p.study===1||p.study===3){
    const get=(key:string)=>{const field=SCENE_DEFINITIONS[state.sceneId].parameters.find(f=>f.key===key)!;return key==='defocus'?{...field,min:microscopeDefocusRange(p)[0],max:microscopeDefocusRange(p)[1]}:key==='NA'?{...field,max:Math.min(1.4,p.medium)}:key==='medium'?{...field,min:Math.max(1,p.NA)}:field;};
    const focus=microscopeFocusDistance(p);
    const main=p.study===1?['NA','wavelength','separation']:['NA','wavelength','medium',...(focus===null?[]:['defocus'])];
    return <>{main.map(key=>renderField(get(key)))}<div className="os-presets">{p.study===1?<>{[['合在一起',.65],['瑞利间距',1],['分开观察',1.8]].map(([label,factor])=><button key={label} className="text-button" onClick={()=>onCommit({separation:Math.max(.05,Math.min(10,microscopePerformance(state).resolution*Number(factor)))})}>{label}</button>)}</>:<button className="text-button" disabled={focus===null} onClick={()=>onCommit({defocus:0})}>回到焦平面</button>}</div><MicroscopeDetails id={p.study===1?'resolution-medium':'depth-settings'} title={p.study===1?'介质设置':'计算设置'}>{p.study===1?renderField(get('medium')):<>{camera?renderField(get('depthCriterion')):<p>目视观察 · 仅衍射</p>}{camera&&p.depthCriterion===1&&<>{['pixel','f1','tubeF','adapter'].map(key=>renderField(get(key)))}<p className="os-microscope-control-note">对焦时相机光学放大率 {numberText(microscopePerformance(state).magnification)}×</p></>}</>}</MicroscopeDetails><p className="os-microscope-control-note">数值孔径表示物镜收集光线的能力。</p></>;
  }
  const modeSwitch=<div className="gs-plot-switch os-microscope-mode" role="group" aria-label="显微镜观察模式">{['目视观察','显微镜拍摄'].map((label,i)=><button key={label} className={p.mode===i?'active':''} aria-pressed={p.mode===i} onClick={()=>{if(p.mode===i)return;onCommit(i?{mode:1,u:p.f1}:Number.isFinite(eyeU)&&eyeU>=5&&eyeU<=100?{mode:0,u:eyeU}:{mode:0,f1:10,f2:20,d:130,u:11});}}>{label}</button>)}</div>;
  const sensorPreset=<label className="os-microscope-preset"><span>感光面预设</span><select aria-label="感光面预设" value={selectedSensor?.join(',')??''} onChange={e=>{const [sensorW,sensorH]=e.target.value.split(',').map(Number);onCommit({sensorW,sensorH});}}><option value="" disabled>自定义尺寸</option>{sensorSizes.map(([w,h])=><option key={w} value={`${w},${h}`}>{w} × {h} mm</option>)}</select></label>;
  if(p.study===2){
    const keys=camera?['sensorW','sensorH','adapter','h']:['fieldNumber','h'];
    const labels:Record<string,string>={fieldNumber:'目镜视场数 FN',sensorW:'感光面宽度 wₛ',sensorH:'感光面高度 hₛ',adapter:'转接倍率 a',h:'样品高度 h'};
    return <>{modeSwitch}{camera&&sensorPreset}{keys.map(key=>{
      const field=SCENE_DEFINITIONS[state.sceneId].parameters.find(field=>field.key===key)!;
      return renderField({...field,label:labels[key]});
    })}</>;
  }
  return <>
    {modeSwitch}
    <div className="os-microscope-parameter-group"><h4>镜组与样品</h4>
    <label className="os-microscope-preset"><span>{camera?'物镜预设':'目镜预设'}</span><select aria-label={camera?'物镜预设':'目镜预设'} value={selectedMagnification??''} onChange={e=>{const n=Number(e.target.value);if(camera)onCommit({f1:200/n,tubeF:200,u:200/n,NA:n===10?.25:n===20?.4:.65,medium:1});else {const f2=250/n,den=1/p.f1-1/p.u,v1=Math.abs(den)>1e-12?1/den:null;onCommit({f2,near:250,...(v1!==null&&v1+f2>=40&&v1+f2<=300?{d:v1+f2}:{})});}}}><option value="" disabled>自定义倍率</option>{magnifications.map(n=><option key={n} value={n}>{n}×{camera?'（200 mm 管镜）':''}</option>)}</select></label>
    {fields.main.map(renderField)}
    {camera?<button className="text-button os-microscope-focus" onClick={()=>onCommit({u:p.f1})}>对焦到感光面</button>:<div className="os-presets">{SCENE_DEFINITIONS[state.sceneId].presets.filter(s=>s.values.mode===0).map(s=><button key={s.label} className="text-button" onClick={()=>onCommit(s.values)}>{s.label}</button>)}</div>}
    </div>
    <MicroscopeDetails id={camera?'camera-settings':'eye-settings'} title={camera?'拍摄设置':'观察设置'}>{fields.observation.map(renderField)}</MicroscopeDetails>
    <MicroscopeDetails id={camera?'camera-field-settings':'eye-field-settings'} title="视场设置">
      {camera&&sensorPreset}{fields.field.map(renderField)}
    </MicroscopeDetails>
    {camera&&<MicroscopeDetails id="camera-display-settings" title="显示设置">{fields.display.map(renderField)}</MicroscopeDetails>}
  </>;
}

export function MicroscopeObservation({state,result,variant='panel'}:{state:SceneState;result:SceneResult;variant?:'panel'|'summary'|'field'}) {
  const id=useId().replace(/:/g,''),p=state.parameters,camera=p.mode===1;
  const [references,setReferences]=useState(()=>{try{return [0,1].map(mode=>localStorage.getItem(`optics-microscope-field-reference:v1:${mode}`)==='true');}catch{return [false,false];}});
  const reference=variant==='field'&&references[camera?1:0];
  const setReference=(value:boolean)=>{const mode=camera?1:0;setReferences(previous=>previous.map((item,i)=>i===mode?value:item));try{localStorage.setItem(`optics-microscope-field-reference:v1:${mode}`,String(value));}catch{/* Optional view preference. */}};
  const metric=(key:string)=>result.metrics.find(m=>m.key===key)?.value??null;
  const angular=metric('angularM'),v=metric('v'),m=camera?metric('cameraM'):angular??metric('m');
  const fw=camera?metric('fieldWidth'):metric('fieldDiameter'),fh=camera?metric('fieldHeight'):fw;
  const valid=camera?Math.abs(p.u-p.f1)<=1e-9*Math.max(1,p.f1):angular!==null&&fw!==null;
  const magnificationLabel=camera?'相机光学放大率':angular!==null?'目视放大倍数':'投影尺寸放大率';
  const orientation=m===null?'':m<0?'倒像':'正像';
  // The F target has a physical height h. Its size and orientation are determined
  // by the computed sample field, without pretending to simulate diffraction.
  // Keep the original sample on a fixed 2.5 mm field, independent of the optics.
  const scale=reference?190/2.5:fw!==null&&fh!==null?Math.min(190/fw,190/fh):1;
  const sampleSize=p.h*scale,flip=reference?1:m!==null&&m<0?-1:1;
  const bar=reference?0.5:fw!==null?10**Math.floor(Math.log10(fw/3)):0;
  const barWidth=bar*scale;
  const rectWidth=fw!==null&&(camera||reference)?fw*scale:190,rectHeight=fh!==null&&(camera||reference)?fh*scale:190;
  const left=Math.max(20,115-rectWidth/2),right=Math.min(210,115+rectWidth/2),top=Math.max(15,110-rectHeight/2),bottom=Math.min(205,110+rectHeight/2);
  const outside=reference&&(rectWidth>190||rectHeight>190);
  return <div className={`os-microscope-observation os-microscope-observation-${variant}`} data-testid="microscope-field-view">
    {variant!=='field'&&<div className="gs-spot-reading os-microscope-primary" data-testid="microscope-primary"><span>{magnificationLabel}</span><strong>{numberText(m===null?null:Math.abs(m))}<small>倍</small></strong><p>{orientation}{camera?valid?' · 已对焦':' · 未对焦':v===null?' · 最终像在无穷远':v<0?' · 最终虚像':' · 最终实像'}</p></div>}
    {variant!=='summary'&&<><h3>{reference?'原始样品示意':camera?'相机取景示意':'目视视野示意'}</h3>
    {variant==='field'&&<div className="os-microscope-field-switch os-microscope-presentation" role="group" aria-label="显微镜视场显示方式" onPointerDown={e=>e.stopPropagation()}>
      {([[false,camera?'拍摄图像':'目视观察'],[true,'原始样品']] as const).map(([value,label])=><button key={label} type="button" aria-pressed={reference===value} onClick={()=>setReference(value)}>{label}</button>)}
    </div>}
    <svg id={variant==='field'?'microscope-field-diagram':undefined} className="os-microscope-preview" viewBox="0 0 230 250" role="img" aria-label={reference?'原始样品与当前视场范围':camera?'矩形相机视场与倒置示意样品':'圆形目视视野与示意样品'} data-testid="microscope-observation" data-reference={reference} data-scale={scale} data-sample-height={p.h} data-field-width={fw??''} data-orientation={flip}>
      <defs><clipPath id={`${id}-original`}><rect x={20} y={15} width={190} height={190}/></clipPath><clipPath id={`${id}-field`}>{reference?<rect x={20} y={15} width={190} height={190}/>:camera?<rect x={115-rectWidth/2} y={110-rectHeight/2} width={rectWidth} height={rectHeight} rx={2}/>:<circle cx={115} cy={110} r={95}/>}</clipPath><pattern id={`${id}-sample`} width={Math.max(12,barWidth*2)} height={Math.max(12,barWidth*2)} patternUnits="userSpaceOnUse"><ellipse cx={Math.max(12,barWidth*2)/2} cy={Math.max(12,barWidth*2)/2} rx={Math.max(12,barWidth*2)*.24} ry={Math.max(12,barWidth*2)*.15} fill="#579c91" fillOpacity=".2" stroke="#9dd7c9" strokeOpacity=".3"/></pattern></defs>
      <rect width={230} height={250} rx={10} fill="#10213b"/>
      {valid||reference?<><g clipPath={`url(#${id}-field)`}><rect width={230} height={230} fill="#193754"/><rect width={230} height={230} fill={`url(#${id}-sample)`}/><path d="M20 110H210 M115 15V205" stroke="#7697b0" strokeOpacity=".28"/><g transform={`translate(115 110) scale(${flip})`}><path d={`M0 0 V${-sampleSize} H${sampleSize*.65} M0 ${-sampleSize*.55} H${sampleSize*.45}`} stroke="#e8c594" strokeWidth={Math.max(1,Math.min(3,sampleSize/8))} strokeLinecap="round" fill="none"/></g></g>{reference?<g clipPath={`url(#${id}-original)`} data-testid="microscope-original-field-range">{valid&&(camera?<rect x={115-rectWidth/2} y={110-rectHeight/2} width={rectWidth} height={rectHeight} fill="none" stroke="#65c9ad" strokeWidth={1.5}/>:<circle cx={115} cy={110} r={rectWidth/2} fill="none" stroke="#65c9ad" strokeWidth={1.5}/>)}</g>:camera?<rect x={115-rectWidth/2} y={110-rectHeight/2} width={rectWidth} height={rectHeight} fill="none" stroke="#7190ae"/>:<circle cx={115} cy={110} r={95} fill="none" stroke="#7190ae"/>}<line x1={22} x2={22+barWidth} y1={233} y2={233} stroke="#d7e7f2" strokeWidth={2}/><path d={`M22 229V237 M${22+barWidth} 229V237`} stroke="#d7e7f2"/><text x={22+barWidth+8} y={237} fill="#d7e7f2" fontSize={11}>{sceneDisplayValue(bar,'mm').text} {sceneDisplayValue(bar,'mm').unit}</text></>:<text x={115} y={110} textAnchor="middle" fill="#adc3d9" fontSize={12}>{camera?'请先对焦':'当前配置无法目视'}</text>}
      {valid&&variant==='field'&&(camera?<>
        <MicroscopeDimension quantity="fieldWidth" a={[left,bottom+15]} b={[right,bottom+15]} value={fw} outside={outside}/>
        <MicroscopeDimension quantity="fieldHeight" a={[right+9,top]} b={[right+9,bottom]} value={fh} outside={outside} labelOffset={[-12,0]}/>
        <MicroscopeDimension quantity="fieldDiagonal" a={[left,top]} b={[right,bottom]} value={metric('fieldDiagonal')} outside={outside} labelOffset={[-16,-14]}/>
      </>:<MicroscopeDimension quantity="fieldDiameter" a={[left,110]} b={[right,110]} value={fw} outside={outside}/>)}
    </svg></>}
    {camera&&!valid&&<p>以下为对焦时的视场。</p>}
    {variant!=='field'&&<dl className="os-microscope-fields">{(camera?['fieldWidth','fieldHeight','fieldDiagonal']:['fieldDiameter']).map(key=>{const item=result.metrics.find(m=>m.key===key);return item&&<div key={key}><dt><MicroscopeQuantityLabel label={item.label} quantity={key}/></dt><dd style={{color:quantityColor(key,'microscope')}}><SceneValue value={item.value} unit="mm"/></dd></div>;})}</dl>}
    {variant==='field'&&<p className="os-microscope-preview-note">{reference?(valid?(outside?'原始样品；当前视场超出画面。':'原始样品；绿框为当前视场。'):'同一样品的原始方向。'):'示意样品，大小对应物体高度。'}</p>}
    {variant==='field'&&camera&&<p className="os-microscope-preview-note">转接倍率 {numberText(p.adapter)}× · 感光面 {numberText(p.sensorW)} × {numberText(p.sensorH)} mm</p>}
    {variant==='summary'&&camera&&<MicroscopeDetails id="legacy-camera-display" title="显示倍率"><dl className="os-microscope-fields"><div><dt>屏幕上的尺寸倍率</dt><dd>{numberText(m===null?null:Math.abs(m)*p.displayWidth/p.sensorW)} 倍</dd></div></dl><p>按完整图像显示宽度 {numberText(p.displayWidth)} mm 估计；显示放大不增加光学细节。</p></MicroscopeDetails>}
  </div>;
}

// Eye observation uses one shared readout list so all quantities have equal weight.
export function MicroscopeEyeResults({result}:{result:SceneResult}) {
  const metric=(key:string)=>result.metrics.find(m=>m.key===key);
  const angular=metric('angularM')?.value??null, magnification=angular??metric('m')?.value??null;
  const symbols:Record<string,string>={objectiveM:'mₒ',angularM:'M',m:'m',equivalentFocal:'F',matrixB:'B',matrixD:'D'};
  const colors:Record<string,string>={objectiveM:'#a67916',angularM:'#8a5eac',fieldDiameter:'#357fc6',m:'#bb526a',equivalentFocal:'#62748a',matrixB:'#956b45',matrixD:'#647c40'};
  const row=(key:string)=>{
    const item=metric(key);if(!item)return null;
    const label=key==='angularM'?(angular!==null?'目视放大倍数':'投影尺寸放大率'):item.label;
    const symbol=key==='angularM'&&angular===null?'|m|':symbols[key];
    const value=key==='angularM'?(magnification===null?null:Math.abs(magnification)):item.value;
    return <div key={key} style={{'--quantity-color':colors[key]??quantityColor(key,'microscope')} as CSSProperties}>
      <dt>{symbol?<>{label.replace(/ [A-Za-z].*$/,'')}<span className="gs-quantity-symbol">{symbol}</span></>:<MicroscopeQuantityLabel label={label} quantity={key}/>}</dt>
      <dd data-testid={`scene-metric-${key}`}>{key==='v'&&value===null?'无穷远':<SceneValue value={value} unit={item.unit}/>}</dd>
    </div>;
  };
  return <section className="gs-readouts os-microscope-readouts os-microscope-eye-results" aria-label="实时结果">
    <dl>{['v1','v','objectiveM','angularM','fieldDiameter'].map(row)}</dl>
    <MicroscopeDetails id="eye-ray-calculations" title="详细计算结果"><dl>{['m','equivalentFocal','matrixB','matrixD'].map(row)}</dl>
      {metric('equivalentFocal')?.note&&<p>{metric('equivalentFocal')!.note}</p>}
    </MicroscopeDetails>
    <MicroscopeDetails id={"eye-ray-explanation"} title="详细说明">
      <p>{magnification===null?'':magnification<0?'倒像。':'正像。'}{metric('v')?.value===null?'出射光平行。':metric('v')!.value!<0?'最终像为虚像。':'最终像为实像。'}</p>
      {angular!==null&&<p>倍率按明视距离 {numberText(result.input.parameters.near)} mm 计算；视野为估算值。</p>}
      {result.warnings.length>0&&<p className="os-warning">{result.warnings.map(w=>w.includes('中间实像')?'未形成常规中间实像。':w.includes('可作投影')?'当前适合投影，倍率表示像与物的尺寸比。':w.includes('超出图中范围')?'最终像在画面外，像距读数仍有效。':w.includes('近轴近似')?'光线倾角较大，计算仅供近似参考。':w).join('')}</p>}
    </MicroscopeDetails>
  </section>;
}

export function MicroscopeCameraResults({result}:{result:SceneResult}) {
  const p=result.input.parameters,metric=(key:string)=>result.metrics.find(m=>m.key===key);
  const magnification=metric('cameraM')?.value??null;
  const focused=Math.abs(p.u-p.f1)<=1e-9*Math.max(1,p.f1);
  const symbols:Record<string,string>={objectiveM:'mₒₜ',cameraM:'M',displayM:'Mₛ'};
  const colors:Record<string,string>={objectiveM:'#a67916',cameraM:'#956b45',fieldWidth:'#198e98',displayM:'#62748a'};
  const row=(key:string)=>{
    const item=key==='displayM'?{label:'屏幕尺寸倍率',value:magnification===null?null:Math.abs(magnification)*p.displayWidth/p.sensorW,unit:'倍'}:metric(key);
    if(!item)return null;
    const value=key==='cameraM'&&item.value!==null?Math.abs(item.value):item.value;
    return <div key={key} style={{'--quantity-color':colors[key]??quantityColor(key,'microscope')} as CSSProperties}>
      <dt>{symbols[key]?<>{item.label}<span className="gs-quantity-symbol">{symbols[key]}</span></>:<MicroscopeQuantityLabel label={item.label} quantity={key}/>}</dt>
      <dd data-testid={`scene-metric-${key}`}>{key==='v'&&value===null?'无穷远':<SceneValue value={value} unit={item.unit}/>}</dd>
      {key==='cameraM'&&<p className="os-metric-note" data-testid="microscope-camera-magnification-relation">对焦时：{numberText(Math.abs(metric('objectiveM')?.value??0))} × 转接 {numberText(p.adapter)} = {numberText(value)} 倍</p>}
    </div>;
  };
  return <section className="gs-readouts os-microscope-readouts os-microscope-camera-results" aria-label="实时结果">
    <dl>{['objectiveM','v','focusOffset','cameraM','fieldWidth','fieldHeight','fieldDiagonal','displayM'].map(row)}</dl>
    <MicroscopeDetails id={"camera-ray-explanation"} title="详细说明">
      <p>{magnification===null?'':magnification<0?'倒像，':'正像，'}{focused?'已对焦。':'未对焦；倍率与视场为对焦时的值。'}</p>
      {result.warnings.filter(w=>!w.includes('未对焦')).map(w=><p className="os-warning" key={w}>{w.includes('近轴近似')?'光线倾角较大，结果为近似值。':w}</p>)}
      <p>显示宽度 {numberText(p.displayWidth)} mm；放大不增加细节。</p>
    </MicroscopeDetails>
  </section>;
}

export function MicroscopeFieldResults({result}:{result:SceneResult}) {
  const p=result.input.parameters,camera=p.mode===1;
  const metric=(key:string)=>result.metrics.find(m=>m.key===key)?.value??null;
  const angular=metric('angularM'),magnification=camera?metric('cameraM'):angular??metric('m');
  const focused=Math.abs(p.u-p.f1)<=1e-9*Math.max(1,p.f1);
  return <section className="gs-readouts os-microscope-readouts os-microscope-field-results" aria-label="实时结果">
    <dl><div style={{'--quantity-color':camera?'#956b45':'#8a5eac'} as CSSProperties}>
      <dt>{camera?'相机光学放大倍数':angular!==null?'目视放大倍数':'投影尺寸放大率'}<span className="gs-quantity-symbol">{camera?'|M|':angular!==null?'M':'|m|'}</span></dt>
      <dd data-testid="scene-metric-field-magnification"><SceneValue value={magnification===null?null:Math.abs(magnification)} unit="倍"/></dd>
    </div>{(camera?['fieldWidth','fieldHeight']:['fieldDiameter']).map(key=>{
      const item=result.metrics.find(m=>m.key===key);return item&&<div key={key} style={{'--quantity-color':quantityColor(key,'microscope')} as CSSProperties}>
        <dt><MicroscopeQuantityLabel label={item.label} quantity={key}/></dt><dd data-testid={`scene-metric-${key}`}><SceneValue value={item.value} unit={item.unit}/></dd>
      </div>;
    })}</dl>
    <MicroscopeDetails id={`field-explanation-${camera?'camera':'eye'}`} title="详细说明">
      <p>{magnification===null?'':magnification<0?'倒像。':'正像。'}{camera?(focused?'已对焦。':'未对焦；视场为对焦时的范围。'):metric('fieldDiameter')===null?'当前配置无法目视。':'视野为估算范围。'}</p>
      {result.warnings.filter(w=>!w.includes('未对焦')).map(w=><p className="os-warning" key={w}>{w.includes('近轴近似')?'光线倾角较大，结果为近似值。':w.includes('中间实像')?'未形成常规中间实像。':w.includes('可作投影')?'当前适合投影。':w}</p>)}
    </MicroscopeDetails>
  </section>;
}
