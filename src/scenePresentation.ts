import {CAMERA_PIXEL_QUANTITIES} from './cameraPixelQuantities';
import {CAMERA_DEPTH_QUANTITIES} from './cameraDepthQuantities';
import {CAMERA_FIELD_QUANTITIES} from './cameraFieldQuantities';
import {TELESCOPE_EYE_QUANTITIES} from './telescopeEyeQuantities';
import {REFRACTION_QUANTITIES} from './refractionQuantities';
import {APERTURE_QUANTITIES} from './apertureQuantities';
import {MIRROR_QUANTITIES,type MirrorQuantity} from './mirrorQuantities';
import {MICROSCOPE_QUANTITIES,type MicroscopeQuantity} from './microscopeQuantities';
import {ABERRATION_SYMBOLS} from './aberrationQuantities';

export const QUANTITY_COLORS = {
  incident:'#c16b37', reflected:'#8a5eac', transmitted:'#26836a', index:'#357fc6', distance:'#62748a', focal:'#357fc6', image:'#26836a', power:'#8a5eac', wavelength:'#357fc6', aperture:'#c16b37',
};
export function quantityColor(key:string,model?:string) {
  if(model==='camera'&&key in CAMERA_PIXEL_QUANTITIES)return CAMERA_PIXEL_QUANTITIES[key].color;
  if(model==='camera'&&key in CAMERA_DEPTH_QUANTITIES)return CAMERA_DEPTH_QUANTITIES[key].color;
  if(model==='camera'&&key in CAMERA_FIELD_QUANTITIES)return CAMERA_FIELD_QUANTITIES[key].color;
  if(['interface','prism'].includes(model??'')&&key in REFRACTION_QUANTITIES)return REFRACTION_QUANTITIES[key as keyof typeof REFRACTION_QUANTITIES].color;
  if(model==='aperture'&&key in APERTURE_QUANTITIES)return APERTURE_QUANTITIES[key as keyof typeof APERTURE_QUANTITIES].color;
  if(model==='mirror'&&key in MIRROR_QUANTITIES)return MIRROR_QUANTITIES[key as MirrorQuantity].color;
  if(model==='microscope'&&key in MICROSCOPE_QUANTITIES)return MICROSCOPE_QUANTITIES[key as MicroscopeQuantity].color;
  if(model==='aberration'&&ABERRATION_SYMBOLS[key])return ABERRATION_SYMBOLS[key].color;
  if(model==='telescope'&&key in TELESCOPE_EYE_QUANTITIES)return TELESCOPE_EYE_QUANTITIES[key].color;
  if(model==='telescope'&&key==='wavelength')return '#8a5eac';
  if(model==='telescope'&&key==='starSeparation')return '#26836a';
  if(model==='telescope'&&key==='afocalLength')return '#9a7630';
  if(model==='telescope'&&key==='angularSpread')return '#bf5279';
  if(model==='telescope'&&key==='eyepieceDiameter')return '#147f96';
  if(model==='telescope'&&key==='f2')return QUANTITY_COLORS.reflected;
  if(model==='double-lens'&&key==='v1')return '#347ac0';
  if(model==='double-lens'&&key==='equivalentFocal')return QUANTITY_COLORS.focal;
  if(key==='R'&&(model==='mirror'||model==='aberration'))return QUANTITY_COLORS.focal;
  if (['angle','r1','u','h','objectHeight'].includes(key)) return QUANTITY_COLORS.incident;
  if (['reflectedAngle','R','r2','deviation','minimumDeviation','m','angularM','pupilPosition','objectiveM','cameraM','adapter'].includes(key)) return QUANTITY_COLORS.reflected;
  if (['n2','transmittedAngle','exitAngle','centralAngle','T','v','imageHeight','imageDistance','blurDiameter','fieldWidth','fieldHeight','fieldDiagonal','fieldDiameter','visibleField','acceptedLight','pupilDiameter'].includes(key)) return QUANTITY_COLORS.transmitted;
  if (['resolution','airyDiameter','diffractionCutoff','NA','wavelength'].includes(key)) return QUANTITY_COLORS.index;
  if (['defocus','separation','pixel','starSeparation','eyeDistance','eyeOffset','eyeDiameter'].includes(key)) return QUANTITY_COLORS.incident;
  if (['coc','depth','nearDepth','farDepth','halfDepth','diffractionDepth','geometricDepth'].includes(key)) return QUANTITY_COLORS.transmitted;
  if (key==='tubeF') return QUANTITY_COLORS.focal;
  if (key==='sensorW'||key==='sensorH') return QUANTITY_COLORS.aperture;
  if (/diameter|aperture|stopD|lensD/i.test(key)) return QUANTITY_COLORS.aperture;
  if (/^(n|n1|outside|f|f1|f2|R|wavelength|index|effectiveFocal|backFocal)/.test(key)) return QUANTITY_COLORS.index;
  return QUANTITY_COLORS.distance;
}
