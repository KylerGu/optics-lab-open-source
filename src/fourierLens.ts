import { defaultScene, parseScene, SCENE_DEFINITIONS, type SceneState } from './sceneRuntime';
import { makeSpatialElement, parseSpatial, type SpatialExperiment } from './builderModel';

export const FOURIER_ID = 'spatial-spectrum-0';
export interface FourierParameters { wavelengthNm:number; periodMm:number; waistMm:number; modulation:number; focalLengthMm:number; observationUm:number }
export const DEFAULT_FOURIER = defaultScene(FOURIER_ID).parameters as unknown as FourierParameters;
export const FOURIER_DRAFT_KEY = 'optics-scene-draft-v1-' + FOURIER_ID;
const symbols={wavelengthNm:'λ',periodMm:'d',waistMm:'w',modulation:'m',focalLengthMm:'f',observationUm:'xꜰ'};
const tones={wavelengthNm:'wavelength',periodMm:'distance',waistMm:'waist',modulation:'distance',focalLengthMm:'angle',observationUm:'screen'};
export const FOURIER_FIELDS=SCENE_DEFINITIONS[FOURIER_ID].parameters.map(f=>({...f,key:f.key as keyof FourierParameters,symbol:symbols[f.key as keyof FourierParameters],tone:tones[f.key as keyof FourierParameters]}));
export const fourierState=(p:FourierParameters):SceneState=>({version:1,sceneId:FOURIER_ID,parameters:{...p}});
export const parseFourier=(p:unknown)=>parseScene({version:1,sceneId:FOURIER_ID,parameters:p},FOURIER_ID).parameters as unknown as FourierParameters;

/** Fourier transform of a Gaussian field times a sinusoidal amplitude grating. */
export function fourierLens(p:FourierParameters) {
  const scale=p.wavelengthNm*1e-6*p.focalLengthMm;
  const spatialFrequency=1/p.periodMm,orderPositionUm=scale*spatialFrequency*1000;
  const spotRadiusUm=scale/(Math.PI*p.waistMm)*1000;
  const g=(x:number)=>Math.exp(-((x/spotRadiusUm)**2));
  const normalization=1+p.modulation*g(orderPositionUm);
  const amplitude=(xUm:number)=>(g(xUm)+p.modulation/2*(g(xUm-orderPositionUm)+g(xUm+orderPositionUm)))/normalization;
  const at=(xUm:number,yUm=0)=>{
    const value=(amplitude(xUm)*g(yUm))**2;
    return {intensity:value<1e-15?0:Math.min(1,value),frequency:xUm*.001/scale};
  };
  const inputAmplitude=(xMm:number,yMm=0)=>Math.exp(-(xMm*xMm+yMm*yMm)/(p.waistMm*p.waistMm))*(1+p.modulation*Math.cos(2*Math.PI*xMm/p.periodMm))/(1+p.modulation);
  return {at,inputAmplitude,spatialFrequency,orderPositionUm,spotRadiusUm,observation:at(p.observationUm)};
}
export interface FourierHistory {past:FourierParameters[];present:FourierParameters;future:FourierParameters[]}
export function fourierHistory(h:FourierHistory,a:{type:'commit';parameters:FourierParameters}|{type:'undo'|'redo'}):FourierHistory {
  if(a.type==='commit'){const next=parseFourier(a.parameters);if(FOURIER_FIELDS.every(f=>next[f.key]===h.present[f.key]))return h;return {past:[...h.past,h.present].slice(-80),present:next,future:[]};}
  if(a.type==='undo'&&h.past.length)return {past:h.past.slice(0,-1),present:h.past.at(-1)!,future:[h.present,...h.future]};
  if(a.type==='redo'&&h.future.length)return {past:[...h.past,h.present],present:h.future[0],future:h.future.slice(1)};
  return h;
}
export function fourierBuilderCopy(p:FourierParameters):SpatialExperiment {
  parseFourier(p);
  return parseSpatial({schemaVersion:2,name:'傅里叶变换',elements:[
    makeSpatialElement('laser',[10,60,0],{id:'fourier-input',name:'高斯光源',beamModel:'gaussian',beamRadiusMm:p.waistMm,wavelengthNm:p.wavelengthNm,waistOffsetMm:30,rayCount:101}),
    makeSpatialElement('amplitude-grating',[40,60,0],{id:'fourier-grating',name:'输入振幅条纹',gratingProfile:'sinusoidal',gratingModulation:p.modulation,gratingPeriodUm:p.periodMm*1000,gratingWidthMm:12*p.waistMm,gratingHeightMm:12*p.waistMm}),
    makeSpatialElement('lens',[40+p.focalLengthMm,60,0],{id:'fourier-lens',name:'傅里叶透镜',focalLengthMm:p.focalLengthMm,diameterMm:60}),
    makeSpatialElement('screen',[40+2*p.focalLengthMm,60,0],{id:'fourier-screen',name:'频谱屏',diameterMm:40,probeOffsetMm:p.observationUm*.001}),
  ]});
}
