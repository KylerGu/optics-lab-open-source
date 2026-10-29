import { telescopeOptics, telescopeField } from './telescopeModel';
import type { SceneResult } from './sceneRuntime';

// Both circles use the same displayed angular scale. This is a comparison
// window, not the field stop of an actual eyepiece.
export const TELESCOPE_COMPARISON_ANGLE = 6;
export const TELESCOPE_FIELD_RADIUS = 130;
export const TELESCOPE_TARGETS = [
  { x: .04, y: .02, label: 'A', color: '#f0b272' },
  { x: -.24, y: .15, label: 'B', color: '#a9c7ff' },
  { x: .22, y: .16, label: 'C', color: '#77d3b9' },
] as const;

export function telescopeComparison(parameters: Record<string, number>) {
  const M = telescopeOptics(parameters).M;
  if (M === null) return null;
  return {
    M,
    skyAngle: TELESCOPE_COMPARISON_ANGLE / Math.abs(M),
    selectionRadius: TELESCOPE_FIELD_RADIUS / Math.abs(M),
  };
}

export function telescopeStarPosition(x: number, y: number, M: number) {
  const scale = TELESCOPE_FIELD_RADIUS / (TELESCOPE_COMPARISON_ANGLE / 2);
  return { x: 140 + x * M * scale, y: 140 - y * M * scale };
}

// The main ray enters the centre of the objective. Its outgoing paraxial
// direction is D * theta; in an afocal telescope D is the angular magnification.
export function telescopeAngularTrend(result: SceneResult): SceneResult {
  const p = result.input.parameters, o = telescopeOptics(p);
  // Use the same small-angle output limit as the ray model, instead of
  // extending large magnifications to impossible angles beyond 90 degrees.
  const halfAngle = Math.min(3, .15 * 180 / Math.PI / Math.max(Math.abs(o.dd), 1e-12));
  return {
    ...result,
    curve: Array.from({ length: 61 }, (_, i) => {
      const angle = (i / 30 - 1) * halfAngle;
      return { x: angle, y: o.dd * angle };
    }),
    chart: {
      xLabel: '入射角 θ / °', yLabel: '出射角 θ′ / °',
      currentX: p.angle, currentY: Math.abs(p.angle)<=halfAngle?o.dd*p.angle:null,
    },
  };
}

// Draw only complete intervals, leaving room for the endpoint markers.
export function telescopeVisibleAnnotation(parameters:Record<string,number>,reference:boolean) {
  const comparison=telescopeComparison(parameters),field=telescopeField(parameters);
  if(!comparison||!field)return null;
  const scale=(reference?1:comparison.M)*TELESCOPE_FIELD_RADIUS/(TELESCOPE_COMPARISON_ANGLE/2);
  const endpoints=field.map(value=>140+value*scale).sort((a,b)=>a-b);
  if(endpoints[0]<14||endpoints[1]>266)return null;
  return {field,a:endpoints[0],b:endpoints[1],value:field[1]-field[0]};
}

// A teaching approximation: use the shared angular resolution as the FWHM
// of a Gaussian blur. This is not a full Airy-pattern convolution.
export function telescopeSampleResolution(parameters:Record<string,number>) {
  const resolution=telescopeOptics(parameters).resolution;
  const sigmaDegrees=resolution/3600/(2*Math.sqrt(2*Math.log(2)));
  const comparison=telescopeComparison(parameters);
  return {resolution,sigmaDegrees,sigmaPixels:comparison? sigmaDegrees*Math.abs(comparison.M)*TELESCOPE_FIELD_RADIUS/(TELESCOPE_COMPARISON_ANGLE/2):null};
}

// All four studies edit one instrument. Keep an already focused instrument
// focused when changing a focal length; an intentional spacing error is kept.
export function telescopeParameterChange(parameters:Record<string,number>,key:string,value:number) {
  const next={...parameters,[key]:value};
  if(['f1','f2'].includes(key)&&telescopeOptics(parameters).afocal){
    const spacing=next.f1+next.k2*next.f2;
    if(spacing>=20&&spacing<=600)next.d=spacing;
  }
  return next;
}
