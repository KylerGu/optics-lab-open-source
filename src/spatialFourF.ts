import type {SpatialExperiment,SpatialFourFResult} from './builderModel';
import {geometryFrame,dot3,sub3} from './spatialGeometry';

export function spatialFourFParameters(experiment:SpatialExperiment):SpatialFourFResult['parameters']|null{
  const groups=(kind:string)=>experiment.elements.filter(e=>e.kind===kind),sources=groups('laser'),gratings=groups('amplitude-grating'),lenses=groups('lens'),screens=groups('screen'),masks=groups('slit');
  if(sources.length!==1||gratings.length!==1||lenses.length!==2||screens.length!==1||masks.length>1||experiment.elements.length!==5+masks.length)return null;
  const source=sources[0],grating=gratings[0],screen=screens[0],mask=masks[0],{n,u,v}=geometryFrame(grating),axial=(e:typeof source)=>dot3(sub3(e.position,grating.position),n),near=(a:number,b:number)=>Math.abs(a-b)<1e-6;
  if(source.beamModel!=='gaussian'||grating.gratingProfile!=='sinusoidal')return null;
  const [l1,l2]=[...lenses].sort((a,b)=>axial(a)-axial(b)),f=l1.focalLengthMm,w=source.beamRadiusMm;
  if(w<.5||w>2||f<80||f>130||grating.gratingPeriodUm<80||grating.gratingPeriodUm>400||source.wavelengthNm<380||source.wavelengthNm>780)return null;
  for(const e of [source,l1,l2,screen,...masks]){const frame=geometryFrame(e),offset=sub3(e.position,grating.position);if(dot3(frame.n,n)<1-1e-12||e===mask&&dot3(frame.u,u)<1-1e-12||Math.abs(dot3(offset,v))>1e-6||e!==mask&&Math.abs(dot3(offset,u))>1e-6)return null;}
  if(!near(l2.focalLengthMm,f)||!near(axial(l1),f)||!near(axial(l2),3*f)||!near(axial(screen),4*f)||axial(source)>=0||!near(-axial(source),source.waistOffsetMm)||Math.min(grating.gratingWidthMm,grating.gratingHeightMm,l1.diameterMm,l2.diameterMm)<12*w-1e-6)return null;
  if(mask&&(!near(axial(mask),2*f)||mask.slitHeightMm<12*source.wavelengthNm*1e-6*f/(Math.PI*w)||mask.slitWidthMm<.01||mask.slitWidthMm>5||Math.abs(dot3(sub3(mask.position,grating.position),u))>2.2))return null;
  if(Math.abs(screen.probeOffsetMm)>Math.min(3,screen.diameterMm/2))return null;
  return {wavelengthNm:source.wavelengthNm,periodMm:grating.gratingPeriodUm*.001,waistMm:w,modulation:grating.gratingModulation,focalLengthMm:f,filterWidthUm:mask?mask.slitWidthMm*1000:200,filterOffsetUm:mask?dot3(sub3(mask.position,grating.position),u)*1000:0,filterMode:mask?(mask.slitMode==='pass'?0:1):2,observationMm:screen.probeOffsetMm};
}
