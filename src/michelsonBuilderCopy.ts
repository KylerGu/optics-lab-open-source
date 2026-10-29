import { makeSpatialElement, parseSpatial, type SpatialExperiment } from './builderModel';
import { michelson, type MichelsonParameters } from './michelson';

// Millimetre coordinates, independent of the scene's magnified illustration.
export function michelsonBuilderCopy(p:MichelsonParameters):SpatialExperiment {
  const b=michelson(p),x=260,y=60,z=0;
  return parseSpatial({schemaVersion:2,name:'迈克耳孙干涉仪 · 器件副本',elements:[
    makeSpatialElement('laser',[x-p.sourceDistanceMm,y,z],{id:'michelson-source',name:'入射光源',wavelengthNm:p.wavelengthNm,beamRadiusMm:6,rayCount:9}),
    makeSpatialElement('splitter',[x,y,z],{id:'michelson-splitter',name:'分光镜 BS',yawDeg:-45,transmission:.5,diameterMm:30}),
    makeSpatialElement('mirror',[x+b.arm1Mm,y,z],{id:'michelson-mirror1',name:'第一反射镜 M₁',diameterMm:30}),
    makeSpatialElement('mirror',[x,y,z+b.arm2Mm],{id:'michelson-mirror2',name:'第二反射镜 M₂',yawDeg:90,diameterMm:30}),
    makeSpatialElement('filter',[x+b.arm1Mm*.55,y,z],{id:'michelson-compensator',name:'补偿板 C（理想透过片）',yawDeg:-45,transmission:1,diameterMm:30}),
    makeSpatialElement('lens',[x,y,z-p.lensDistanceMm],{id:'michelson-lens',name:'观察透镜',yawDeg:90,focalLengthMm:p.focalLengthMm,diameterMm:40}),
    makeSpatialElement('screen',[x,y,z-p.lensDistanceMm-p.focalLengthMm],{id:'michelson-screen',name:'焦平面观察屏',yawDeg:90,diameterMm:30}),
  ]});
}
