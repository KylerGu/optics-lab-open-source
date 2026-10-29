import { SCENE_DEFINITIONS, sceneKey, type SceneResult, type SceneState } from './sceneRuntime';

// The ideal adapter relays the tube-lens image. Rays and the screen are drawn
// in pre-relay coordinates so the relay does not silently change ray angles.
export function immediateCameraMicroscope(state:SceneState):SceneResult {
  const p=state.parameters,f=p.f1,ft=p.tubeF,u=p.u,h=p.h,d=p.d,relay=p.adapter;
  const b=u+d*(1-u/f),dd=1-u/f-b/ft,v=Math.abs(dd)>1e-12?-b/dd:null;
  const focused=Math.abs(u-f)<=1e-9*Math.max(1,f),magnification=-ft/f*relay,fw=p.sensorW/Math.abs(magnification),fh=p.sensorH/Math.abs(magnification);
  const sensorX=d+ft,sensorHalf=p.sensorH/relay/2,xmin=-Math.max(30,u*1.2),xmax=sensorX+Math.max(30,ft*.15);
  const segments:SceneResult['segments']=[],y2s:number[]=[],angles:number[]=[];
  for(const y1 of [h,0]){
    const t1=(y1-h)/u-y1/f,y2=y1+d*t1,t2=t1-y2/ft;
    y2s.push(y2);angles.push(Math.abs((y1-h)/u),Math.abs(t1),Math.abs(t2));
    segments.push({start:[-u,h],end:[0,y1],role:'incident',dashed:false,power:1},{start:[0,y1],end:[d,y2],role:'internal',dashed:false,power:1},{start:[d,y2],end:[sensorX,y2+ft*t2],role:'transmitted',dashed:false,power:1});
  }
  const ymax=Math.max(.5,h*2.5,sensorHalf*1.2,Math.abs(ft/f*h)*1.3,...y2s.map(y=>Math.abs(y)*1.5)),warnings:string[]=[];
  if(!focused)warnings.push('当前未对焦：物体需位于物镜前焦面。');
  if(Math.max(...angles)>.15)warnings.push('光线倾角较大，真实系统可能超出近轴近似。');
  const metric=(key:string,label:string,value:number|null,unit='',note='')=>({key,label,value,unit,note});
  const markers:SceneResult['markers']=[{x:-u,y:h,label:'物体',role:'object'}];
  if(focused)markers.push({x:sensorX,y:-ft/f*h,label:'管镜像',role:'image'});
  return {revision:sceneKey(state),input:state,modelVersion:'scene-physics-2',model:'microscope',scope:SCENE_DEFINITIONS[state.sceneId].scope,status:focused?'相机成像：倒像，已对焦':'相机成像：未对焦',warnings,segments,markers,regions:[],bounds:[xmin,xmax,-ymax,ymax],imagePreview:null,
    devices:[{kind:'lens',x:0,height:ymax*.65,label:'物镜',sign:1},{kind:'lens',x:d,height:ymax*.65,label:'管镜',sign:1},{kind:'screen',x:sensorX,height:sensorHalf,label:'管镜像面（转接前）',sign:1}],
    metrics:[metric('cameraM','相机光学放大率',magnification,'倍','对焦时的尺寸放大率；负号表示倒像'),metric('fieldWidth','水平视场',fw,'mm','对焦时对应的样品范围'),metric('fieldHeight','垂直视场',fh,'mm'),metric('fieldDiagonal','对角线视场',Math.hypot(fw,fh),'mm'),metric('objectiveM','物镜与管镜放大率',-ft/f),metric('v','最佳像面距管镜',v,'mm',v===null?'像面在无穷远':'相机固定在管镜后焦面；转接倍率只缩放像面'),metric('focusOffset','物体离焦量',u-f,'mm')],
    curve:Array.from({length:141},(_,j)=>{const a=.25+j*1.75/140;return {x:a,y:p.sensorW/(ft/f*a)};}),chart:{xLabel:'相机转接倍率 / 倍',yLabel:'水平视场 / mm',currentX:relay,currentY:fw}};
}
