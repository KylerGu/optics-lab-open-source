import {useEffect,useState} from 'react';
import {microscopeFocusBounds,type MicroscopeLayout} from './spatialMicroscope';

export default function MicroscopeFocusReadout({layout,onChange}:{layout:MicroscopeLayout;onChange:(distance:number)=>void}){
  const format=(n:number)=>String(Number(n.toFixed(5)));
  const [draft,setDraft]=useState(format(layout.objectDistance));
  useEffect(()=>setDraft(format(layout.objectDistance)),[layout.objectDistance]);
  const {min,max}=microscopeFocusBounds(layout);
  const commit=()=>{const n=Number(draft);if(draft.trim()&&Number.isFinite(n)&&n>=min&&n<=max&&Math.abs(n-layout.objectDistance)>1e-7)onChange(n);else setDraft(format(layout.objectDistance));};
  return <label className="sb-microscope-focus" title="拖动旋钮或载物台调焦，也可直接输入物距"><span>物距</span><input style={{width:`${Math.min(10,Math.max(3,draft.length+.5))}ch`}} aria-label="显微镜物距" type="number" min={min} max={max} step="0.001" value={draft} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape'){setDraft(format(layout.objectDistance));e.stopPropagation();}}}/><small>mm</small></label>;
}
