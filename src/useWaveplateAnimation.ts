import { useEffect, useRef, useState } from 'react';
export function useWaveplateAnimation(powerMw:number){
  const [playing,setPlaying]=useState(()=>!window.matchMedia('(prefers-reduced-motion: reduce)').matches),[phase,setPhase]=useState(0);
  const phaseRef=useRef(phase);phaseRef.current=phase;
  useEffect(()=>{if(!playing||powerMw===0)return;let frame=0,start:number|null=null,last=0;const initial=phaseRef.current;
    const animate=(t:number)=>{start??=t;if(t-last>=32){last=t;setPhase((initial+(t-start)/2500*2*Math.PI)%(2*Math.PI));}frame=requestAnimationFrame(animate);};
    frame=requestAnimationFrame(animate);return()=>cancelAnimationFrame(frame);
  },[playing,powerMw]);
  return {phase,playing,togglePlaying:()=>setPlaying(v=>!v)};
}
