// Ideal incoherent circular-pupil MTF. Frequency and cutoff use lp/mm.
export function cameraContrast(frequency:number,cutoff:number) {
  const r=Math.abs(frequency)/cutoff;
  return r>=1?0:2/Math.PI*(Math.acos(r)-r*Math.sqrt(1-r*r));
}

// Exact area average over a square pixel for a horizontal sinusoidal target.
// Position, pitch and period use µm. Sampling above Nyquist is intentionally
// retained: an aliased pattern must not be presented as resolved detail.
export function cameraStripe(position:number,period:number,contrast:number,pitch=0) {
  const a=Math.PI*pitch/period,sinc=a===0?1:Math.sin(a)/a;
  return .5+.45*contrast*sinc*Math.cos(2*Math.PI*position/period);
}

// A synthetic E target on an infinite bright background, in sensor mm.
function target(x:number,y:number,shape:'E'|'F') {
  const spine=x>=-.11&&x<=-.08&&Math.abs(y)<=.09;
  const bars=x>=-.11&&x<=.08&&((shape==='E'&&Math.abs(y-.075)<=.015)||Math.abs(y)<=.015||Math.abs(y+.075)<=.015);
  return spine||bars ? .12 : .94;
}
// Signed integral from (0,0) to (x,y) in a unit disc. Integrating its
// circular boundary gives exact rectangle/disc overlap without noisy samples.
function discIntegral(x:number,y:number) {
  const sign=Math.sign(x)*Math.sign(y),a=Math.min(1,Math.abs(x)),b=Math.min(1,Math.abs(y)),t=Math.sqrt(1-b*b);
  if(a<=t)return sign*a*b;
  const primitive=(s:number)=>.5*(s*Math.sqrt(Math.max(0,1-s*s))+Math.asin(s));
  return sign*(t*b+primitive(a)-primitive(t));
}
const TARGET_RECTS=[[-.11,-.08,-.09,.09],[-.08,.08,-.09,-.06],[-.08,.08,-.015,.015],[-.08,.08,.06,.09]];
export function cameraTarget(x:number,y:number,diameter:number,shape:'E'|'F'='E') {
  if(diameter<1e-9)return target(x,y,shape);
  const radius=diameter/2;
  let area=0;
  for(const [left,right,top,bottom] of (shape==='F'?TARGET_RECTS.slice(0,3):TARGET_RECTS)) {
    if(left>x+radius||right<x-radius||top>y+radius||bottom<y-radius)continue;
    area+=discIntegral((right-x)/radius,(bottom-y)/radius)-discIntegral((left-x)/radius,(bottom-y)/radius)-discIntegral((right-x)/radius,(top-y)/radius)+discIntegral((left-x)/radius,(top-y)/radius);
  }
  return .94-.82*Math.max(0,Math.min(1,area/Math.PI));
}
