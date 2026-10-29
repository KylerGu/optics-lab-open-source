import { useEffect, useRef, useState } from 'react';
import { validateSpatialResult, type SpatialExperiment, type SpatialResult } from './builderModel';

export function useSpatialSimulation(experiment:SpatialExperiment,enabled:boolean,live=false) {
  const key=JSON.stringify(experiment), sequence=useRef(0);
  const desired=useRef(key);desired.current=key;
  const [retryCount,setRetryCount]=useState(0);
  const [state,setState]=useState<{key:string;status:'idle'|'pending'|'ready'|'error';result:SpatialResult|null;error:string|null}>({key,status:'idle',result:null,error:null});
  useEffect(()=>{
    if(live||!enabled||!experiment.elements.some(e=>e.kind==='laser'||e.kind==='object'))return;
    const revision=++sequence.current,controller=new AbortController();
    let timeout:ReturnType<typeof setTimeout>|undefined;
    setState({key,status:'pending',result:null,error:null});
    const debounce=setTimeout(async()=>{
      timeout=setTimeout(()=>controller.abort('timeout'),10000);
      try{
        const response=await fetch('/api/spatial/simulate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,experiment:JSON.parse(key)}),signal:controller.signal});
        if(!response.ok){let message='无法连接仿真服务，请确认后台已启动。';try{const body=await response.json();if(typeof body.detail==='string')message=body.detail;}catch{/* non-JSON proxy response */}throw new Error(message);}
        const result=validateSpatialResult(await response.json(),revision,JSON.parse(key));
        if(!controller.signal.aborted&&revision===sequence.current)setState({key,status:'ready',result,error:null});
      }catch(error){if(controller.signal.aborted&&controller.signal.reason!=='timeout')return;setState({key,status:'error',result:null,error:controller.signal.reason==='timeout'?'计算超时，请重试。':error instanceof Error?error.message:'计算失败。'});}
      finally{if(timeout)clearTimeout(timeout);}
    },150);
    return ()=>{clearTimeout(debounce);if(timeout)clearTimeout(timeout);controller.abort('changed');};
  },[key,enabled,retryCount,live]);
  useEffect(()=>{
    if(!live||!enabled)return;
    let stopped=false,lastKey='',timer:ReturnType<typeof setTimeout>|undefined,timeout:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined;
    // Complete one calculation before requesting the latest position. Slow services must not
    // have every response cancelled by the next pointer event.
    const next=async()=>{
      if(stopped)return;
      const requestKey=desired.current;
      if(requestKey===lastKey){timer=setTimeout(next,60);return;}
      lastKey=requestKey;const input=JSON.parse(requestKey) as SpatialExperiment,revision=++sequence.current;
      controller=new AbortController();const request=controller;
      setState(previous=>({key:requestKey,status:'pending',result:sameApparatus(previous.result,input)?previous.result:null,error:null}));
      timeout=setTimeout(()=>request.abort('timeout'),10000);
      try{
        const response=await fetch('/api/spatial/simulate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,experiment:input}),signal:request.signal});
        if(!response.ok)throw new Error('成像计算未完成，请重试。');
        const result=validateSpatialResult(await response.json(),revision,input);
        if(!stopped&&revision===sequence.current)setState({key:requestKey,status:'ready',result,error:null});
      }catch(error){if(!stopped)setState({key:requestKey,status:'error',result:null,error:request.signal.reason==='timeout'?'计算超时，请重试。':error instanceof Error?error.message:'计算失败。'});}
      finally{if(timeout)clearTimeout(timeout);if(!stopped)timer=setTimeout(next,16);}
    };
    void next();return ()=>{stopped=true;if(timer)clearTimeout(timer);if(timeout)clearTimeout(timeout);controller?.abort('changed');};
  },[enabled,live,retryCount]);
  const retry=()=>setRetryCount(n=>n+1);
  if(!enabled||!experiment.elements.some(e=>e.kind==='laser'||e.kind==='object'))return {status:'idle' as const,result:null,error:null,retry};
  if(state.key!==key)return {status:'pending' as const,result:live&&sameApparatus(state.result,experiment)?state.result:null,error:null,retry};
  return {...state,retry};
}

function sameApparatus(result:SpatialResult|null,experiment:SpatialExperiment){
  return result?.inputSnapshot.elements.length===experiment.elements.length&&result.inputSnapshot.elements.every((e,i)=>e.id===experiment.elements[i].id&&e.kind===experiment.elements[i].kind);
}
