import { brewster,birefringence,type PolarizationRefractionParameters } from './polarizationRefraction';
import { waveplate, type WaveplateParameters } from './waveplate';
import { malus, type MalusParameters } from './malus';
import { fiberCoupling, type CouplingParameters } from './fiberCoupling';
import { fiberModes, type FiberParameters } from './fiberModes';
import { illuminanceAt, type IlluminationParameters } from './illumination';
import { fourF, type FourFParameters } from './fourF';
import { fourierLens, type FourierParameters } from './fourierLens';
import formulas from './opticsFormulas.json';
import { circularDiffraction, type CircularParameters } from './circularDiffraction';
import { singleSlit, type SlitParameters } from './singleSlit';
import { michelson, type MichelsonParameters } from './michelson';
import { thinFilm, newtonRings, type FilmParameters } from './filmInterference';
import { youngDoubleSlit, type YoungParameters } from './youngDoubleSlit';
import { waveSuperposition, type WaveParameters } from './waveSuperposition';
import type { SceneResult, SceneState } from './sceneRuntime';
export interface OpticsFormula {id:string;title:string;categoryId:string;latex:string;question:string;meaning:string;conditions:string;application:string;diagram:string;sceneId:string;reference?:string;targets?:string[];inputs?:Record<string,string[]>;fields:{key:string;label:string;symbol?:string;unit:string;min:number;max:number;default:number;options?:{value:number;label:string}[]}[]}
export const OPTICS_FORMULAS=formulas as OpticsFormula[];
export function opticsValues(formula:OpticsFormula,state?:SceneState,result?:SceneResult):Record<string,number>{
  const values=Object.fromEntries(formula.fields.map(f=>[f.key,f.default]));
  if(!state)return values;
  const p=state.parameters;
  if(formula.diagram==='brewster'){const b=brewster(p as unknown as PolarizationRefractionParameters);return {...values,n1:p.n1,n2:p.n2,thetaB:b.brewsterDeg??values.thetaB};}
  if(formula.diagram==='birefringence'){const b=birefringence(p as unknown as PolarizationRefractionParameters);return {...values,no:p.ordinaryIndex,ne:p.extraordinaryIndex,gamma:p.axisAngleDeg,L:p.thicknessMm,d:b.separationMm};}
  if(formula.diagram==='waveplate'){const b=waveplate(p as unknown as WaveplateParameters);return {...values,alpha:p.inputAngleDeg,beta:p.axisAngleDeg,delta:b.phaseDeg,S3:b.s3??values.S3};}
  if(formula.diagram==='malus') {
    const b=malus(p as unknown as MalusParameters);
    return {...values,Pin:p.powerMw,theta:b.relativeAngleDeg,Pout:b.outputPowerMw};
  }
  if(formula.diagram==='fiber-coupling') {
    const b=fiberCoupling(p as unknown as CouplingParameters);
    return {...values,w:p.beamRadiusUm,wf:p.modeRadiusUm,d:p.offsetUm,theta:p.tiltDeg,lambda:p.wavelengthNm,eta:b.efficiencyPct,Pin:p.powerMw,Pout:b.coupledPowerMw};
  }
  if(formula.diagram==='fiber-modes') {
    const b=fiberModes(p as unknown as FiberParameters);
    return {...values,n1:p.coreIndex,n2:p.claddingIndex,a:p.radiusUm,lambda:p.wavelengthNm,NA:b.na??NaN,V:b.v??NaN,lambdaC:b.cutoffNm??NaN};
  }
  if(formula.diagram==='four-f') {
    const b=fourF(p as unknown as FourFParameters);
    return {...values,lambda:p.wavelengthNm,d:p.periodMm,w:p.waistMm,m:p.modulation,f:p.focalLengthMm,a:p.filterWidthUm,c:p.filterOffsetUm,mode:p.filterMode,x:p.observationMm,L:4*p.focalLengthMm,nu:b.cutoffFrequency,J:b.observation};
  }
  if(formula.diagram==='fourier-lens') {
    const b=fourierLens(p as unknown as FourierParameters);
    return {...values,lambda:p.wavelengthNm,d:p.periodMm,w:p.waistMm,m:p.modulation,f:p.focalLengthMm,xF:p.observationUm,x1:b.orderPositionUm,wF:b.spotRadiusUm,J:b.observation.intensity};
  }
  if(formula.diagram==='circular-diffraction') {
    const b=circularDiffraction(p as unknown as CircularParameters);
    return {...values,lambda:p.wavelengthNm,D:p.apertureDiameterMm,f:p.focalLengthMm,r:p.observationRadiusUm,dA:b.airyDiameterUm,J:b.observation.intensity,theta:b.observation.thetaDeg};
  }
  if(formula.diagram==='single-slit') {
    const b=singleSlit(p as unknown as SlitParameters);
    return {...values,lambda:p.wavelengthNm,a:p.slitWidthMm,L:p.screenDistanceM,y:p.observationMm,w:b.centralWidthMm,J:b.observation.intensity,theta:b.observation.thetaDeg};
  }
  if(formula.diagram==='thin-film') {
    const b=thinFilm(p as unknown as FilmParameters);
    return {...values,n:p.filmIndex,ns:p.substrateIndex,theta0:p.incidentAngleDeg,theta:b.angleFilmDeg,t:p.thicknessNm,lambda:p.wavelengthNm,delta:b.current.deltaNm,reflectance:b.current.reflectance*100};
  }
  if(formula.diagram==='newton-rings') {
    const b=newtonRings(p as unknown as FilmParameters);
    return {...values,R:p.curvatureRadiusMm,r:p.observationRadiusMm,t0:p.centralGapNm,t:b.current.thicknessNm,n:p.gapIndex,lambda:p.wavelengthNm,r1:b.firstDarkRadiusMm??NaN};
  }
  if(formula.diagram==='michelson') {
    const b=michelson(p as unknown as MichelsonParameters);
    return {...values,lambda:p.wavelengthNm,D:p.baseDifferenceUm,s:b.netMoveUm,f:p.focalLengthMm,r:p.observationRadiusMm,delta:b.observation.deltaUm,J:b.observation.intensity,N:b.fringeShift};
  }
  if(formula.diagram==='young-double-slit') {
    const b=youngDoubleSlit(p as unknown as YoungParameters);
    return {...values,lambda:p.wavelengthNm,d:p.slitDistanceMm,L:p.screenDistanceM,y:p.observationMm,delta:b.observation.deltaUm,s:b.spacingApproxMm,J:b.observation.intensity};
  }
  if(formula.diagram==='illumination-map') { const b=illuminanceAt(p as unknown as IlluminationParameters); return {...values,I0:p.intensityCd,beta:p.halfAngleDeg,E:b.value,r:b.distance,alpha:b.alphaDeg,gamma:b.incidenceDeg}; }
  if(formula.diagram==='point-source') return {...values,I:p.intensityCd,r:p.distanceM,E:p.intensityCd/p.distanceM**2};
  if(formula.diagram==='wave-superposition') {
    const b=waveSuperposition(p as unknown as WaveParameters);
    return {...values,A1:p.amplitude1,A2:p.amplitude2,phi:p.phaseDeg,lambda:p.wavelengthNm,z:p.observationUm,A:b.amplitude,I:b.intensity,E:b.observation.sum};
  }
  const metric=(key:string,fallback:number)=>{const found=result?.metrics.find(m=>m.key===key);return found ? found.value??NaN : fallback;};
  if(formula.id==='camera-field')return {...values,S:p.sensorW,u:p.u,s:p.sensor,f:p.f,W:p.sensorW*p.u/p.sensor};
  if(formula.id==='camera-depth')return {...values,f:p.f,s:p.sensor,a:p.aperture,c0:p.coc,un:metric('nearDepth',NaN),uf:metric('farDepth',NaN)};
  if(formula.id==='camera-diffraction')return {...values,lambda:p.wavelength/1000,v:metric('v',NaN),a:p.aperture,dA:metric('airyDiameter',NaN)};
  if(formula.id==='camera-sampling')return {...values,p:p.pixel,u:p.u,s:p.sensor,nu:500/p.pixel,e:p.pixel*p.u/p.sensor};
  if(formula.id==='telescope-resolution')return {...values,lambda:p.wavelength,D:p.aperture,r:1.22*p.wavelength/1e6/p.aperture*180/Math.PI*3600};
  if(formula.id==='telescope-pupil-position'){const fe=p.f2*p.k2;return {...values,fe,d:p.d,q:Math.abs(p.d-fe)>1e-12?fe*p.d/(p.d-fe):NaN};}
  if(formula.id==='telescope-pupil-diameter'){const fe=p.f2*p.k2,valid=Math.abs(p.d-p.f1-fe)<1e-8;return {...values,D:p.aperture,M:valid?p.f1/Math.abs(fe):NaN,Dp:valid?p.aperture*Math.abs(fe)/p.f1:NaN};}
  if(formula.id==='microscope-eye-field'){const v1=Math.abs(1/p.f1-1/p.u)>1e-12?1/(1/p.f1-1/p.u):NaN,M=Math.abs(v1/p.u),valid=result?result.metrics.find(m=>m.key==='fieldDiameter')?.value!=null:v1>0&&v1<p.d;return {...values,S:p.fieldNumber,M:valid?M:NaN,L:valid?p.fieldNumber/M:NaN};}
  if(formula.id==='microscope-resolution')return {...values,lambda:p.wavelength/1000,NA:p.NA,r:.61*p.wavelength/1000/p.NA};
  if(formula.id==='microscope-depth'){const M=p.tubeF/p.f1*p.adapter,e=p.depthCriterion===1?p.pixel:0;return {...values,n:p.medium,lambda:p.wavelength/1000,NA:p.NA,e,M,D:p.medium*p.wavelength/1000/(p.NA*p.NA)+p.medium*e/(M*p.NA)};}
  if(formula.diagram==='microscope-camera')return {...values,fo:p.f1,ft:p.tubeF,a:p.adapter,M:p.tubeF/p.f1*p.adapter,S:p.sensorW,L:p.sensorW/(p.tubeF/p.f1*p.adapter)};
  if(formula.id==='thin-lens'&&state.sceneId==='instruments-0')return {...values,f:p.f1,u:p.u,v:metric('v1',Math.abs(1/p.f1-1/p.u)>1e-12?1/(1/p.f1-1/p.u):NaN)};
  if(formula.diagram==='aperture')return {...values,f:p.f,u:p.u,z:p.z,up:Math.abs(p.z),Ds:p.stopD,Dp:p.z===0?p.stopD:Math.abs(p.f/(Math.abs(p.z)-p.f))*p.stopD,Dl:Math.abs(1+p.z/p.u-p.z/p.f)<1e-12?NaN:p.stopD/Math.abs(1+p.z/p.u-p.z/p.f)};
  if(formula.diagram==='aberration')return {...values,A:p.A,B:p.B,wavelength:p.wavelength,n:metric('index',NaN),R:p.R,t:metric('thickness',NaN),F:metric('effectiveFocal',NaN),bfl:metric('backFocal',NaN)};
  if(formula.id==='snell-law'&&p.A!==undefined){const n=metric('index',NaN),i=Math.asin(p.diameter/(2*p.R))*180/Math.PI;return {...values,n1:1,n2:n,i,t:Math.asin(Math.sin(i*Math.PI/180)/n)*180/Math.PI};}
  if(formula.diagram==='interface')return {...values,n1:p.n1??p.outside,n2:p.n2??p.n,i:p.angle,r:p.angle,t:metric('transmittedAngle',metric('r1',values.t)),c:metric('criticalAngle',values.c),R:metric('R',values.R)};
  if(formula.diagram==='prism')return {...values,n:p.n,n0:p.outside,A:p.apex,delta:metric('minimumDeviation',values.delta)};
  if (['lens','mirror','double-lens','camera','microscope','telescope'].includes(formula.diagram)) {
    const signedF = p.R !== undefined ? p.R*p.kind/2 : p.f !== undefined ? p.f*(p.kind??1) : p.f1*(p.k1??1);
    const signedF1=p.f1*(p.k1??1),signedF2=p.f2*(p.k2??1);
    return {...values,f:signedF,R:p.R!==undefined?p.R*p.kind:values.R,u:p.u??values.u,v:metric('v',values.v),m:metric('m',values.m),f1:signedF1,f2:signedF2,d:p.d??values.d,F:metric('equivalentFocal',values.F),B:metric('matrixB',values.B),D:metric('matrixD',values.D),mo:metric('objectiveM',values.mo),near:p.near??values.near,fe:signedF2,fo:p.f1??values.fo,M:metric('angularM',values.M),a:p.aperture??values.a,s:p.sensor??values.s,c:metric('blurDiameter',values.c)};
  }
  return values;
}
