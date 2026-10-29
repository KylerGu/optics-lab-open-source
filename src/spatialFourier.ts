import type {SpatialExperiment,SpatialFourierResult} from './builderModel';
import {geometryFrame,dot3,sub3} from './spatialGeometry';

export function spatialFourierParameters(experiment:SpatialExperiment):SpatialFourierResult['parameters']|null{
  const kinds=['laser','amplitude-grating','lens','screen'],groups=kinds.map(kind=>experiment.elements.filter(e=>e.kind===kind));
  if(experiment.elements.length!==4||groups.some(group=>group.length!==1))return null;
  const [source,grating,lens,screen]=groups.map(group=>group[0]),{n,u,v}=geometryFrame(grating),axial=(e:typeof source)=>dot3(sub3(e.position,grating.position),n),near=(a:number,b:number)=>Math.abs(a-b)<1e-6,f=lens.focalLengthMm,w=source.beamRadiusMm;
  if(source.beamModel!=='gaussian'||grating.gratingProfile!=='sinusoidal'||w<.5||w>2||f<80||f>250||grating.gratingPeriodUm<80||grating.gratingPeriodUm>400||source.wavelengthNm<380||source.wavelengthNm>780)return null;
  for(const e of [source,lens,screen]){const offset=sub3(e.position,grating.position);if(dot3(geometryFrame(e).n,n)<1-1e-12||Math.abs(dot3(offset,u))>1e-6||Math.abs(dot3(offset,v))>1e-6)return null;}
  if(!near(axial(lens),f)||!near(axial(screen),2*f)||axial(source)>=0||!near(-axial(source),source.waistOffsetMm)||Math.min(grating.gratingWidthMm,grating.gratingHeightMm,lens.diameterMm)<12*w-1e-6||Math.abs(screen.probeOffsetMm)>Math.min(3,screen.diameterMm/2))return null;
  return {wavelengthNm:source.wavelengthNm,periodMm:grating.gratingPeriodUm*.001,waistMm:w,modulation:grating.gratingModulation,focalLengthMm:f,observationUm:screen.probeOffsetMm*1000};
}
