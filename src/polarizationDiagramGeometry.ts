import { birefringence, type PolarizationRefractionParameters } from './polarizationRefraction';
export function refractionLayout(width:number,height:number){
  const w=Math.max(360,width),h=Math.max(460,height);return {w,h,cx:w/2,cy:h/2+12,r:Math.min((w-100)/2,(h-180)/2)};
}
export function crystalLayout(width:number,height:number,p:PolarizationRefractionParameters){
  const w=Math.max(360,width),h=Math.max(460,height),b=birefringence(p),L=p.thicknessMm;
  // Fixed minimum extent keeps zero walk-off readable; both axes use one mm scale.
  const extentMm=Math.max(6,Math.abs(b.signedSeparationMm)+2),scale=Math.min((w-126)/(L+L*.7),(h-210)/(2*extentMm));
  const left=w/2-L*scale/2,right=w/2+L*scale/2,cy=h/2+12;
  return {w,h,left,right,cy,scale,halfHeight:extentMm*scale,exitY:cy-b.signedSeparationMm*scale,startX:left-L*.35*scale,endX:right+L*.35*scale,axisX:w/2,axisY:cy-extentMm*.52*scale,axisRadius:Math.max(26,Math.min(42,L*scale*.25,extentMm*scale*.30))};
}
