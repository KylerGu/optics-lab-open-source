import {CAMERA_FIELD_ANNOTATIONS,CAMERA_FIELD_QUANTITIES} from './cameraFieldQuantities';
import {CAMERA_DEPTH_ANNOTATIONS,CAMERA_DEPTH_QUANTITIES} from './cameraDepthQuantities';
import {CAMERA_PIXEL_ANNOTATIONS,CAMERA_PIXEL_QUANTITIES} from './cameraPixelQuantities';

const RAY_ANNOTATIONS=['f','u','h','sensor','aperture','v','blurDiameter','sensorH'];
export const cameraAnnotationKeys=(study:number):readonly string[]=>[RAY_ANNOTATIONS,CAMERA_FIELD_ANNOTATIONS,CAMERA_DEPTH_ANNOTATIONS,CAMERA_PIXEL_ANNOTATIONS][study]??[];
export const cameraStudyQuantities=(study:number):Record<string,{label:string;symbol:string;color:string}>=>[{},CAMERA_FIELD_QUANTITIES,CAMERA_DEPTH_QUANTITIES,CAMERA_PIXEL_QUANTITIES][study]??{};
export const cameraAnnotationVisible=(study:number,key:string,fieldMode:'sample'|'sensor')=>study!==1||(['sensorW','sensorH'].includes(key)?fieldMode==='sensor':fieldMode==='sample');
