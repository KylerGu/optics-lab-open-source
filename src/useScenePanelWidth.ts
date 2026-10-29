import { useEffect, useRef, useState, type RefObject, type PointerEvent, type KeyboardEvent } from 'react';

const LEFT_KEY='optics-scene-panel-width:v1',RIGHT_KEY='optics-scene-result-width:v1';
const clamp=(n:number,min:number,max:number)=>Math.min(max,Math.max(min,n));
function readWidth(key:string,min:number,max:number,fallback:number){
  try{const n=Number(localStorage.getItem(key));return n>=min&&n<=max?n:fallback;}catch{return fallback;}
}

export function useScenePanelWidth(container:RefObject<HTMLDivElement|null>,resultsOpen:boolean,panelOpen:boolean,options?:{resultKey?:string;resultDefault?:number;resultMin?:number;leftKey?:string;leftMin?:number;leftDefault?:number;onLeftClose?:()=>void;onRightClose?:()=>void}) {
  const leftMin=options?.leftMin??280,leftKey=options?.leftKey??LEFT_KEY;
  const resultKey=options?.resultKey??RIGHT_KEY,resultMin=options?.resultMin??220;
  const [leftPreferred,setLeftPreferred]=useState(()=>readWidth(leftKey,leftMin,480,options?.leftDefault??320));
  const [rightPreferred,setRightPreferred]=useState(()=>readWidth(resultKey,resultMin,520,options?.resultDefault??280));
  const [available,setAvailable]=useState(1200),[resizing,setResizing]=useState(false);
  const drag=useRef<{id:number;x:number;width:number;side:'left'|'right'}|null>(null);
  useEffect(()=>{
    const el=container.current;if(!el)return;
    const measure=()=>{const css=getComputedStyle(el);el.clientWidth&&setAvailable(el.clientWidth-parseFloat(css.paddingLeft)-parseFloat(css.paddingRight));};
    measure();const observer=new ResizeObserver(measure);observer.observe(el);return()=>observer.disconnect();
  },[container]);
  useEffect(()=>{try{localStorage.setItem(leftKey,String(leftPreferred));localStorage.setItem(resultKey,String(rightPreferred));}catch{/* Optional view preferences. */}},[leftPreferred,rightPreferred,resultKey,leftKey]);

  // Reserve room for the diagram and both handles. Narrow windows shrink the
  // displayed widths without overwriting the user's preferred desktop widths.
  const gaps=(panelOpen?16:0)+(resultsOpen?16:0)+2;
  const plotMin=Math.min(360,Math.max(0,available-(panelOpen?leftMin:0)-(resultsOpen?resultMin:0)-gaps));
  const leftCapacity=Math.max(leftMin,Math.min(480,available-(resultsOpen?resultMin:0)-gaps-plotMin));
  const width=clamp(leftPreferred,leftMin,leftCapacity);
  const rightMax=Math.max(resultMin,Math.min(520,available-(panelOpen?width:0)-gaps-plotMin));
  const rightWidth=clamp(rightPreferred,resultMin,rightMax);
  const leftMax=Math.max(leftMin,Math.min(480,available-(resultsOpen?rightWidth:0)-gaps-plotMin));
  const separator=(side:'left'|'right',value:number,min:number,max:number)=>{
    const close=side==='left'?options?.onLeftClose:options?.onRightClose;
    const adjust=(n:number)=>{
      if(close&&n<min*.6){drag.current=null;setResizing(false);close();return;}
      (side==='left'?setLeftPreferred:setRightPreferred)(clamp(Math.round(n),min,max));
    };
    const finish=(e:PointerEvent<HTMLDivElement>)=>{if(drag.current?.id!==e.pointerId)return;drag.current=null;setResizing(false);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);};
    return {role:'separator',tabIndex:0,'aria-label':side==='left'?'调整左侧参数面板宽度':'调整结果与趋势面板宽度','aria-orientation':'vertical' as const,title:'拖动调整宽度，继续拖窄可收起；双击恢复默认宽度','aria-valuemin':close?0:min,'aria-valuemax':max,'aria-valuenow':value,
      onPointerDown:(e:PointerEvent<HTMLDivElement>)=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.focus();drag.current={id:e.pointerId,x:e.clientX,width:value,side};e.currentTarget.setPointerCapture(e.pointerId);setResizing(true);},
      onPointerMove:(e:PointerEvent<HTMLDivElement>)=>{const d=drag.current;if(d?.id===e.pointerId&&d.side===side)adjust(d.width+(e.clientX-d.x)*(side==='left'?1:-1));},
      onPointerUp:finish,onPointerCancel:finish,onLostPointerCapture:finish,
      onDoubleClick:()=>adjust(side==='left'?(options?.leftDefault??320):(options?.resultDefault??280)),
      onKeyDown:(e:KeyboardEvent<HTMLDivElement>)=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();adjust(e.key==='Home'?(close?0:min):e.key==='End'?max:value===min&&(e.key==='ArrowRight'?16:-16)*(side==='left'?1:-1)<0&&close?0:value+(e.key==='ArrowRight'?16:-16)*(side==='left'?1:-1));}};
  };
  return {width,resizing,separator:separator('left',width,leftMin,leftMax),results:{width:rightWidth,separator:separator('right',rightWidth,resultMin,rightMax)}};
}
