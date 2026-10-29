import {displayNumber as numberText} from './SceneValue';
import { type SceneResult } from './sceneRuntime';
import AberrationSpotMeasure from './AberrationSpotMeasure';

export default function SceneImagePreview({preview,showNote=true,selectedRadius=null}:{preview:NonNullable<SceneResult['imagePreview']>;showNote?:boolean;selectedRadius?:number|null}){
  const spots=preview.kind==='geometric-spots';
  return <div className="os-image-preview"><h3>{spots?'观察屏光线落点':'感光面几何像点'}</h3><svg id={spots?'aberration-spot-diagram':undefined} viewBox="0 0 230 230" role="img" aria-label={spots?'球差与色差的几何光线落点':'几何弥散圆与感光面像点位置'} data-testid="scene-image-preview"><rect width="230" height="230" rx="8" fill="#172b45"/><line x1="15" x2="215" y1="115" y2="115" stroke="#68809c" strokeDasharray="4 4"/><line x1="115" x2="115" y1="15" y2="215" stroke="#68809c" strokeDasharray="4 4"/>{spots?preview.points?.map((point,i)=><circle key={i} cx={115+point.x/preview.extent*95} cy={115-point.y/preview.extent*95} r={1.1} fill={point.color} fillOpacity=".45"/>):<circle cx="115" cy={115-preview.center/preview.extent*95} r={Math.max(2,preview.diameter/2/preview.extent*95)} fill="#a7d0ff" fillOpacity=".7"/>}{selectedRadius!==null&&<AberrationSpotMeasure radius={selectedRadius} extent={preview.extent}/>}<text x="12" y="217" fill="#acc7e4">范围 ±{numberText(preview.extent)} mm</text></svg>{showNote&&<p>{preview.note}</p>}</div>;
}
