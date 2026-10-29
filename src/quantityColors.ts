import type { CSSProperties } from 'react';

// A quantity keeps its color in controls, numeric readings and geometry.
export const FIBER_COLORS: Record<string,string> = {
  coreIndex:'#357fc6', claddingIndex:'#8b5bb5', radiusUm:'#177f8d', wavelengthNm:'#ba5260',
  angleDeg:'#b97829', acceptanceDeg:'#278752', criticalDeg:'#a05488', internalDeg:'#6073b5',
  incidenceDeg:'#a05e3f', na:'#527c38', v:'#776a39', cutoffNm:'#905b66',
};
export const COUPLING_COLORS: Record<string,string> = {
  wavelengthNm:'#ba5260', beamRadiusUm:'#b97829', modeRadiusUm:'#278752', offsetUm:'#357fc6',
  tiltDeg:'#8b5bb5', powerMw:'#177f8d', efficiencyPct:'#278752', coupledPowerMw:'#527c38',
  lossDb:'#a05488', sizePct:'#b97829', positionPct:'#357fc6', anglePct:'#8b5bb5',
};
export const MALUS_COLORS: Record<string,string> = {
  powerMw:'#b97829', inputAngleDeg:'#357fc6', axisAngleDeg:'#8b5bb5',
  relativeAngleDeg:'#177f8d', outputPowerMw:'#278752', transmissionPct:'#ba5260',
};
export const WAVEPLATE_COLORS:Record<string,string>={
  powerMw:'#b97829',inputAngleDeg:'#357fc6',axisAngleDeg:'#8b5bb5',plateType:'#667f9a',
  phaseDeg:'#ba5260',outputPowerMw:'#278752',majorAngleDeg:'#8b7632',axisRatio:'#177f8d',
  s1:'#6073b5',s2:'#a05488',s3:'#527c38',
};
export const quantityStyle=(color:string):CSSProperties=>({'--quantity-color':color} as CSSProperties);
export const REFRACTION_COLORS:Record<string,string>={
  n1:'#357fc6',n2:'#8b5bb5',angleDeg:'#b97829',brewsterDeg:'#776a39',transmissionDeg:'#177f8d',criticalDeg:'#a05488',
  rsPct:'#ba5260',rpPct:'#278752',reflectancePct:'#95634b',transmissionPct:'#6073b5',
  ordinaryIndex:'#357fc6',extraordinaryIndex:'#8b5bb5',axisAngleDeg:'#b97829',thicknessMm:'#177f8d',
  effectiveIndex:'#278752',walkoffDeg:'#a05488',separationMm:'#ba5260',
};
