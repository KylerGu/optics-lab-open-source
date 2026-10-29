import type {Vec3} from './builderModel';

export interface ImageStage {
  visible:boolean; lensId:string; kind:'real'|'virtual'|'infinity'; distanceMm:number|null; magnification:number|null;
  heightMm:number|null; position:Vec3|null; paths:Vec3[][];
}
export interface ObjectImageResult {
  distantView?:{paths:number[][][];referencePaths:number[][][];center:number[];referenceCenter:number[];pupilCount:number;magnification:number;focused:boolean;objectDistanceMm:number;sigmaDegrees:number;strokeDegrees:number};
  objectId:string; objectPaths:Vec3[][]; stages:ImageStage[];
  segments:{start:Vec3;end:Vec3;point:number;dashed:boolean}[];
  observations:{elementId:string;kind:'eye'|'sensor'|'screen';focused:boolean;defocusMm:number|null;
    magnification:number|null;angularMagnification:number|null;fieldDiameterMm:number|null;
    adapterMagnification:number;widthMm:number;heightMm:number;hits:{x:number;y:number;point:number}[]}[];
  warnings:string[];
}
export const objectPatternLines=(pattern:'F'|'arrow',centered=false):number[][][]=>(pattern==='F'
  ?[[[0,0],[0,1],[1,1]],[[0,.55],[.45/.65,.55]]]
  :[[[0,0],[0,1]],[[-.5,.65],[0,1],[.5,.65]]]).map(path=>path.map(([x,y])=>[x-(centered?.5:0),y-(centered?.5:0)]));

export function validateImaging(value:unknown,objectIds:string[],elementIds:string[]):asserts value is ObjectImageResult[]{
  const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v);
  const nullable=(v:unknown)=>v===null||finite(v);
  const vector=(v:unknown)=>Array.isArray(v)&&v.length===3&&v.every(finite);
  const paths=(v:unknown)=>Array.isArray(v)&&v.every(p=>Array.isArray(p)&&p.every(vector));
  if(!Array.isArray(value)||value.length!==objectIds.length)throw new Error('物体成像结果不完整。');
  const seen=new Set();
  for(const r of value){
    if(!r||!objectIds.includes(r.objectId)||seen.has(r.objectId)||!paths(r.objectPaths)||!Array.isArray(r.warnings)||!r.warnings.every((w:unknown)=>typeof w==='string')||!Array.isArray(r.stages)||!Array.isArray(r.segments)||!Array.isArray(r.observations))throw new Error('物体成像结果无效。');
    seen.add(r.objectId);
    if(r.distantView!==undefined){
      const v=r.distantView,angularPaths=(p:unknown)=>Array.isArray(p)&&p.every(line=>Array.isArray(line)&&line.every(point=>Array.isArray(point)&&point.length===2&&point.every(finite)));
      if(!v||!angularPaths(v.paths)||!angularPaths(v.referencePaths)||!angularPaths([[v.center,v.referenceCenter]])||typeof v.focused!=='boolean'||![v.pupilCount,v.magnification,v.objectDistanceMm,v.sigmaDegrees,v.strokeDegrees].every(finite)||v.pupilCount<1||v.objectDistanceMm<=0||v.sigmaDegrees<0||v.strokeDegrees<=0)throw new Error('远处物体目视光线无效。');
    }
    for(const s of r.stages)if(!elementIds.includes(s.lensId)||!['real','virtual','infinity'].includes(s.kind)||![s.distanceMm,s.magnification,s.heightMm].every(nullable)||!(s.position===null||vector(s.position))||!paths(s.paths)||(s.kind==='infinity')!==(s.distanceMm===null))throw new Error('物像关系无效。');
    for(const s of r.segments)if(!vector(s.start)||!vector(s.end)||!Number.isInteger(s.point)||typeof s.dashed!=='boolean')throw new Error('物体光线无效。');
    for(const o of r.observations)if(!elementIds.includes(o.elementId)||!['screen','sensor','eye'].includes(o.kind)||typeof o.focused!=='boolean'||![o.defocusMm,o.magnification,o.angularMagnification,o.fieldDiameterMm].every(nullable)||![o.adapterMagnification,o.widthMm,o.heightMm].every(finite)||!Array.isArray(o.hits)||!o.hits.every((h:{x:number;y:number;point:number})=>finite(h.x)&&finite(h.y)&&Number.isInteger(h.point)))throw new Error('成像观察结果无效。');
  }
}
