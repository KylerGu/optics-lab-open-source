import {CAMERA_PIXEL_QUANTITIES} from './cameraPixelQuantities';
import {CAMERA_DEPTH_QUANTITIES} from './cameraDepthQuantities';
import {CAMERA_FIELD_QUANTITIES} from './cameraFieldQuantities';
import {TELESCOPE_EYE_QUANTITIES} from './telescopeEyeQuantities';
import {REFRACTION_QUANTITIES,refractionSymbol} from './refractionQuantities';
import {APERTURE_QUANTITIES} from './apertureQuantities';
import {MICROSCOPE_QUANTITIES,type MicroscopeQuantity} from './microscopeQuantities';
import AberrationQuantitySymbol from './AberrationQuantitySymbol';
import {ABERRATION_SYMBOLS} from './aberrationQuantities';
import {DOUBLE_LENS_SYMBOLS,type DoubleLensQuantity} from './doubleLensQuantities';

const symbols:Record<string,string>={reflectedAngle:'θᵣ',transmittedAngle:'θₜ',criticalAngle:'θc',r1:'r₁',r2:'r₂',exitAngle:'e',deviation:'δ',minimumDeviation:'δₛ',f:'f',v:'v',m:'m',imageHeight:'h′'};
export default function SceneQuantityLabel({label,quantity,model}:{label:string;quantity:string;model?:string}) {
  const match=label.match(/^(.*) ([|]?[A-Za-zλθδΔ][^\s]*)$/);
  const symbol=model==='camera'&&quantity in CAMERA_PIXEL_QUANTITIES?CAMERA_PIXEL_QUANTITIES[quantity].symbol:model==='camera'&&quantity in CAMERA_DEPTH_QUANTITIES?CAMERA_DEPTH_QUANTITIES[quantity].symbol:model==='camera'&&quantity in CAMERA_FIELD_QUANTITIES?CAMERA_FIELD_QUANTITIES[quantity].symbol:model==='telescope'&&quantity in TELESCOPE_EYE_QUANTITIES?TELESCOPE_EYE_QUANTITIES[quantity].symbol:model==='telescope'&&quantity==='resolution'?'θᵣ':model==='telescope'&&quantity==='starSeparation'?'Δθ':model==='telescope'&&quantity==='afocalLength'?'d₀':model==='telescope'&&quantity==='angularSpread'?'Δθ′':model==='telescope'&&quantity==='aperture'?'Dₒ':model==='telescope'&&quantity==='eyepieceDiameter'?'Dₑ':['interface','prism'].includes(model??'')&&quantity in REFRACTION_QUANTITIES?refractionSymbol(quantity as keyof typeof REFRACTION_QUANTITIES,model!):model==='aperture'&&quantity in APERTURE_QUANTITIES?APERTURE_QUANTITIES[quantity as keyof typeof APERTURE_QUANTITIES].symbol:model==='microscope'&&quantity in MICROSCOPE_QUANTITIES?MICROSCOPE_QUANTITIES[quantity as MicroscopeQuantity].symbol:model==='double-lens'&&quantity in DOUBLE_LENS_SYMBOLS?DOUBLE_LENS_SYMBOLS[quantity as DoubleLensQuantity]:match?.[2]??symbols[quantity];
  if(model==='aberration'&&ABERRATION_SYMBOLS[quantity])return <>{match?.[1]??label}<AberrationQuantitySymbol quantity={quantity}/></>;
  return <>{match?.[1]??label}{symbol&&<span className="gs-quantity-symbol">{symbol}</span>}</>;
}
