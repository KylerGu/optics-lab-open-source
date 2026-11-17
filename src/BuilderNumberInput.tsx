import {useEffect,useRef,useState} from 'react';
export default function NumberInput({highlighted=false,label,value,unit,min,max,step=.1,precision,sliderMin=min,sliderMax=max,onChange,onEditing,onDrag}:{highlighted?:boolean;label:string;value:number;unit:string;min:number;max:number;step?:number;precision?:number;sliderMin?:number;sliderMax?:number;onChange:(value:number)=>boolean;onEditing?:(editing:boolean)=>void;onDrag?:(active:boolean,commit?:boolean)=>void}){
  const effectivePrecision=precision??Math.max(1,Math.min(4,Math.ceil(-Math.log10(Math.max(step,1e-6))-1e-9)));
  const format=(n:number)=>String(Number(n.toFixed(effectivePrecision)));
  const [draft,setDraft]=useState(format(value)),[error,setError]=useState(false);
  const pending=useRef(draft),dragging=useRef(false),numberField=useRef<HTMLInputElement>(null);
  useEffect(()=>{setDraft(format(value));pending.current=format(value);setError(false);numberField.current?.removeAttribute('data-invalid');},[value]);
  useEffect(()=>{if(highlighted){numberField.current?.focus({preventScroll:true});numberField.current?.scrollIntoView({block:'nearest'});}},[highlighted]);
  const change=(text:string)=>{pending.current=text;setDraft(text);setError(false);};
  const commit=()=>{if(pending.current===format(value)){setError(false);return true;}const n=Number(pending.current);if(!pending.current.trim()||!Number.isFinite(n)||n<min||n>max||!onChange(n)){change(format(value));setError(true);return false;}setError(false);return true;};
  const finish=()=>{
    if(!dragging.current)return;
    dragging.current=false;
    if(onDrag){
      const n=Number(pending.current);
      if(pending.current!==format(value)&&pending.current.trim()&&Number.isFinite(n)&&n>=min&&n<=max)onChange(n);
      onDrag(false,true);
    }else{
      commit();
      onEditing?.(false);
    }
  };
  return <div className={`sb-number${highlighted?' sb-guided-field':''}`}><label><span>{label}</span><div><input ref={numberField} aria-label={label} aria-invalid={error} type="number" min={min} max={max} step={step} value={draft} onChange={event=>{event.currentTarget.removeAttribute('data-invalid');change(event.target.value);}} onBlur={event=>event.currentTarget.setAttribute('data-invalid',String(!commit()))} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}}/><small>{unit}</small></div></label><input className="sb-range" aria-label={label+'滑杆'} type="range" min={sliderMin} max={sliderMax} step={step} value={Math.min(sliderMax,Math.max(sliderMin,Number(draft)||0))} onPointerDown={event=>{dragging.current=true;event.currentTarget.setPointerCapture(event.pointerId);if(onDrag)onDrag(true);else onEditing?.(true);}} onChange={event=>{const formatted=format(Number(event.target.value));change(formatted);if(onDrag||!dragging.current)onChange(Number(formatted));}} onPointerUp={finish} onPointerCancel={()=>{if(!dragging.current)return;dragging.current=false;change(format(value));if(onDrag)onDrag(false,false);else onEditing?.(false);}} onLostPointerCapture={finish} onBlur={finish}/>{error&&<small className="sb-field-error">请输入 {format(min)} 至 {format(max)} {unit} 的有效值</small>}</div>;
}
