import { defaultScene, parseScene, SCENE_DEFINITIONS, type SceneState } from './sceneRuntime';
export const FILM_SCENE_ID='interference-1';
export interface FilmParameters {mode:number;wavelengthNm:number;filmIndex:number;substrateIndex:number;incidentAngleDeg:number;thicknessNm:number;curvatureRadiusMm:number;gapIndex:number;centralGapNm:number;observationRadiusMm:number}
export const DEFAULT_FILM=defaultScene(FILM_SCENE_ID).parameters as unknown as FilmParameters;
export const filmState=(p:FilmParameters):SceneState=>({version:1,sceneId:FILM_SCENE_ID,parameters:{...p}});
export const parseFilm=(p:unknown)=>parseScene({version:1,sceneId:FILM_SCENE_ID,parameters:p}).parameters as unknown as FilmParameters;
const symbols:Record<string,string>={wavelengthNm:'λ',filmIndex:'n',substrateIndex:'nₛ',incidentAngleDeg:'θ₀',thicknessNm:'t',curvatureRadiusMm:'R',gapIndex:'n',centralGapNm:'t₀',observationRadiusMm:'r'};
export const FILM_FIELDS=SCENE_DEFINITIONS[FILM_SCENE_ID].parameters.filter(f=>f.key!=='mode').map(f=>({...f,key:f.key as keyof FilmParameters,symbol:symbols[f.key]}));
export const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
export const filmFmt=(n:number)=>Math.abs(n)<1e-10?'0':Number(n.toFixed(4)).toString();
export function reflectance(a:number,b:number,cycles:number){
  const c=Math.cos(2*Math.PI*(cycles%1));
  return clamp((a*a+b*b+2*a*b*c)/(1+(a*b)**2+2*a*b*c),0,1);
}
export function thinFilm(p:FilmParameters){
  const angle=p.incidentAngleDeg*Math.PI/180,sine=Math.sin(angle),cosine=Math.sqrt(1-(sine/p.filmIndex)**2),cosSubstrate=Math.sqrt(1-(sine/p.substrateIndex)**2);
  const a=(Math.cos(angle)-p.filmIndex*cosine)/(Math.cos(angle)+p.filmIndex*cosine),b=(p.filmIndex*cosine-p.substrateIndex*cosSubstrate)/(p.filmIndex*cosine+p.substrateIndex*cosSubstrate);
  const periodNm=p.wavelengthNm/(2*p.filmIndex*cosine);
  const at=(t:number)=>({thicknessNm:t,deltaNm:2*p.filmIndex*t*cosine,reflectance:reflectance(a,b,t/periodNm)});
  const extrema=[reflectance(a,b,0),reflectance(a,b,.5)],min=Math.min(...extrema),max=Math.max(...extrema);
  const current=at(p.thicknessNm),contrast=max-min;
  return {a,b,cosine,angleFilmDeg:Math.asin(sine/p.filmIndex)*180/Math.PI,periodNm,at,current,min,max,contrast,
    status:contrast<1e-12?'下表面无反射 · 膜厚不改变反射率':Math.abs(current.reflectance-min)<1e-10?'反射最弱':Math.abs(current.reflectance-max)<1e-10?'反射最强':'反射强弱随膜厚变化'};
}
export function gapThickness(p:FilmParameters,r:number){return p.centralGapNm+r*r/(p.curvatureRadiusMm+Math.sqrt(p.curvatureRadiusMm**2-r*r))*1e6;}
export function newtonRings(p:FilmParameters){
  const a=(1.52-p.gapIndex)/(1.52+p.gapIndex),maximum=4*a*a/(1+a*a)**2;
  const at=(r:number)=>{const thicknessNm=gapThickness(p,r),deltaNm=2*p.gapIndex*thicknessNm,cycles=deltaNm/p.wavelengthNm;const raw=reflectance(a,-a,cycles)/maximum,intensity=raw<1e-12?0:1-raw<1e-12?1:raw;return {thicknessNm,deltaNm,cycles,intensity,reflectance:maximum*intensity};};
  const radiusForCycles=(cycles:number)=>{const sagMm=(cycles*p.wavelengthNm/(2*p.gapIndex)-p.centralGapNm)*1e-6;if(sagMm< -1e-12||sagMm>p.curvatureRadiusMm)return null;return Math.sqrt(Math.max(0,2*p.curvatureRadiusMm*sagMm-sagMm*sagMm));};
  const current=at(p.observationRadiusMm),firstDarkRadiusMm=radiusForCycles(1);
  return {at,current,maximum,radiusForCycles,firstDarkRadiusMm,status:current.intensity===0?'暗环 · 相消干涉':current.intensity===1?'亮环 · 相长干涉':'明暗之间'};
}
export function filmTarget(p:FilmParameters,target:'bright'|'dark'){
  if(p.mode===0){const b=thinFilm(p);if(b.contrast<1e-12)throw new Error('下表面无反射，不能通过膜厚调节反射强弱。');const offset=(b.a*b.b>0)===(target==='bright')?0:.5;const maxOrder=Math.floor(1500/b.periodNm-offset+1e-10);const order=clamp(Math.round(p.thicknessNm/b.periodNm-offset),0,maxOrder);return {thicknessNm:clamp((order+offset)*b.periodNm,0,1500)};}
  const b=newtonRings(p),offset=target==='bright'?.5:0,lo=Math.ceil(b.at(0).cycles-offset-1e-10),hi=Math.floor(b.at(3).cycles-offset+1e-10);if(lo>hi)throw new Error('当前观察范围内没有对应圆环。');const radius=b.radiusForCycles(clamp(Math.round(b.current.cycles-offset),lo,hi)+offset);if(radius===null)throw new Error('目标圆环不存在。');return {observationRadiusMm:clamp(radius,0,3)};
}
export interface FilmHistory {past:FilmParameters[];present:FilmParameters;future:FilmParameters[]}
export function filmHistory(h:FilmHistory,a:{type:'commit';parameters:FilmParameters}|{type:'undo'|'redo'}):FilmHistory{
  if(a.type==='commit'){const next=parseFilm(a.parameters);if(Object.keys(next).every(k=>next[k as keyof FilmParameters]===h.present[k as keyof FilmParameters]))return h;return {past:[...h.past,h.present].slice(-80),present:next,future:[]};}
  if(a.type==='undo'&&h.past.length)return {past:h.past.slice(0,-1),present:h.past.at(-1)!,future:[h.present,...h.future]};
  if(a.type==='redo'&&h.future.length)return {past:[...h.past,h.present],present:h.future[0],future:h.future.slice(1)};
  return h;
}
