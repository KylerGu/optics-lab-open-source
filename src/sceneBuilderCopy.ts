import { makeSpatialElement, parseSpatial, type SpatialElement, type SpatialExperiment } from './builderModel';
import { SCENE_DEFINITIONS, type SceneResult, type SceneState } from './sceneRuntime';

export function sceneBuilderCopy(state:SceneState,result:SceneResult):{experiment:SpatialExperiment|null;note:string} {
  const p=state.parameters,model=result.model;
  if(model==='camera'){
    if(p.study!==0)return {experiment:null,note:'请在成像光路页复制相机装置；其他专题保留在原场景。'};
    const elements=[
      makeSpatialElement('object',[-p.u,60,0],{name:'样品 F',objectMode:'finite',objectPattern:'F',objectHeightMm:p.h,objectWidthMm:p.h*.65,wavelengthNm:p.wavelength}),
      makeSpatialElement('lens',[0,60,0],{name:'相机镜头',focalLengthMm:p.f,diameterMm:p.aperture}),
      makeSpatialElement('sensor',[p.sensor,60,0],{name:'相机感光面',sensorWidthMm:p.sensorW,sensorHeightMm:p.sensorH,adapterMagnification:1}),
    ];
    try{return {experiment:parseSpatial({schemaVersion:2,name:'相机成像 · 器件副本',elements}),note:'保留 F 样品、物距、样品高度、焦距、光圈开口和感光面位置与尺寸。镜头有效口径代表光圈，按当前设置观察倒像、离焦和裁切。'};}
    catch{return {experiment:null,note:'当前尺寸或位置超出搭建范围，暂时不能完整复制。'};}
  }
  if(model==='microscope'){
    if(p.study!==0)return {experiment:null,note:'目前仅复制成像光路；分辨率、视场专题和景深保留在原场景。'};
    const camera=p.mode===1;
    const elements=[
      makeSpatialElement('object',[-p.u,60,0],{name:'样品',objectPattern:'F',objectHeightMm:p.h,objectWidthMm:p.h*.65}),
      makeSpatialElement('lens',[0,60,0],{name:'物镜',focalLengthMm:p.f1}),
      makeSpatialElement('lens',[p.d,60,0],{name:camera?'管镜':'目镜',focalLengthMm:camera?p.tubeF:p.f2}),
      camera?makeSpatialElement('sensor',[p.d+p.tubeF,60,0],{name:'相机感光面',sensorWidthMm:p.sensorW,sensorHeightMm:p.sensorH,adapterMagnification:p.adapter})
        :makeSpatialElement('eye',[p.d,60,0],{name:'目镜处观察',nearDistanceMm:p.near,fieldNumberMm:p.fieldNumber}),
    ];
    try{return {experiment:parseSpatial({schemaVersion:2,name:'显微镜成像 · 器件副本',elements,presentation:{kind:'microscope',objectId:elements[0].id,objectiveId:elements[1].id,relayId:elements[2].id,observerId:elements[3].id}}),note:camera?'保留样品 F、物距、尺寸、镜片焦距与间距、感光面及转接倍率。转接为理想像面缩放，位置按转接前等效像面表示；不复制真实转接镜结构。':'保留样品 F、物距、尺寸、物镜、目镜和目镜处观察方式；保留明视距离与视场数。采用理想薄透镜，不含真实眼球与照明。'};}
    catch{return {experiment:null,note:'当前尺寸或位置超出搭建范围，暂时不能完整复制。'};}
  }
  if(model==='interface')return {experiment:null,note:'光路搭建目前没有无限平面介质界面，暂时不能完整复制反射与折射场景。'};
  if(model==='mirror')return {experiment:null,note:'光路搭建目前只有平面反射镜，不能代替此场景的球面镜。'};
  if(model==='aberration')return {experiment:null,note:'此场景使用有厚度的球面透镜；光路搭建中的理想薄透镜不能复现球差与色差，暂时不能完整复制。'};
  if(model==='prism')return {experiment:null,note:'此场景的两介质单条主光线，与搭建器中的实体棱镜光束模型不同，暂时不能完整复制。'};
  if(model==='telescope'){
    const u=1000,compensation=p.f1*p.f1/(u-p.f1),spacing=p.d+compensation,height=u*.6*Math.PI/180;
    const elements=[
      makeSpatialElement('object',[-u,60,0],{name:'远处样品 F',objectMode:'distant',angularHeightDeg:.6,wavelengthNm:p.wavelength,objectHeightMm:height,objectWidthMm:height*.6}),
      makeSpatialElement('lens',[0,60,0],{name:'物镜',focalLengthMm:p.f1,diameterMm:p.aperture}),
      makeSpatialElement('lens',[spacing,60,0],{name:'目镜',focalLengthMm:p.f2*p.k2,diameterMm:p.eyepieceDiameter}),
      makeSpatialElement('eye',[spacing+p.eyeDistance,60+p.eyeOffset,0],{name:'目视观察',diameterMm:p.eyeDiameter}),
    ];
    try{return {experiment:parseSpatial({schemaVersion:2,name:'望远镜成像 · 器件副本',elements}),note:'F 放在物镜前 1000 mm，光线从实际物点出发。保留焦距、口径、波长和眼睛相对位置；镜间距按有限物距补偿，保留原来的离焦量。目视效果由进入眼瞳的光线计算，倍率随实际物距变化。'};}
    catch{return {experiment:null,note:'当前器件位置或尺寸超出搭建范围，暂时不能完整复制。'};}
  }
  const elements:SpatialElement[]=[];
  const sourceX=-(p.u??100);
  if(model==='lens'||model==='double-lens')elements.push(makeSpatialElement('object',[sourceX,60,0],{name:'物体',objectPattern:'arrow',objectHeightMm:p.h,objectWidthMm:p.h*.6}));
  else elements.push(makeSpatialElement('laser',[sourceX,60,0],{pitchDeg:0,name:'场景光源',beamRadiusMm:Math.min(20,Math.max(.01,(p.aperture??p.lensD??8)/2)),wavelengthNm:p.wavelength??532,rayCount:9}));
  if(model==='lens')elements.push(makeSpatialElement('lens',[0,60,0],{focalLengthMm:p.f*p.kind}));
  else if(model==='aperture')elements.push(makeSpatialElement('lens',[0,60,0],{focalLengthMm:p.f,diameterMm:p.aperture??p.lensD}));
  else {
    elements.push(makeSpatialElement('lens',[0,60,0],{name:'第一片透镜',focalLengthMm:p.f1*(p.k1??1),diameterMm:p.aperture??40}));
    elements.push(makeSpatialElement('lens',[p.d,60,0],{name:'第二片透镜',focalLengthMm:p.f2*(p.k2??1),diameterMm:p.aperture??40}));
  }
  if(model==='aperture')elements.push(makeSpatialElement('aperture',[p.z,60,0],{diameterMm:p.stopD}));
  const distance=result.metrics.find(m=>m.key==='v')?.value;
  if(distance!==null&&distance!==undefined&&distance>0)elements.push(makeSpatialElement('screen',[(p.d??0)+distance,60,0],{diameterMm:60}));
  try {
    const experiment=parseSpatial({schemaVersion:2,name:SCENE_DEFINITIONS[state.sceneId].title+' · 器件副本',elements});
    return {experiment,note:model==='lens'||model==='double-lens'?'保留物体位置、尺寸和透镜参数；实像可用观察屏接收，虚像与无穷远像通过光线和成像读数观察。':'将复制透镜的焦距、间距，以及可用的光阑和观察屏。搭建器使用激光光束；场景中的物体高度、目视放大率和物像示意保留在原场景中，副本用于继续搭建光路。'};
  }catch{return {experiment:null,note:'当前器件位置或尺寸超出了光路搭建的范围，暂时不能完整复制。'};}
}
