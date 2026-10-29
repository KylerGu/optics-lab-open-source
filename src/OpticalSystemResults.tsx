import './aberration-results.css';
import type {ApertureQuantity} from './apertureQuantities';
import { useEffect, useRef } from 'react';
import ApertureReadouts from './ApertureReadouts';
import AberrationReadouts from './AberrationReadouts';
import { AberrationFocalReadouts } from './AberrationAnnotations';
import type { AberrationQuantity } from './aberrationQuantities';
import SceneImagePreview from './SceneImagePreview';
import type { SceneResult, SceneState } from './sceneRuntime';

export default function OpticalSystemResults({state,result,selected,onSelect,apertureSelected,onApertureToggle}:{apertureSelected:ReadonlySet<ApertureQuantity>;onApertureToggle:(key:ApertureQuantity)=>void;state:SceneState;result:SceneResult;selected:AberrationQuantity|null;onSelect:(key:AberrationQuantity|null)=>void}) {
  const aperture=result.model==='aperture',spot=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(selected==='rmsRadius')spot.current?.scrollIntoView({block:'nearest'});},[selected]);
  return <div className={`os-system-results${aperture?' os-lens-results':' os-aberration-results'}`}>
    <section className="gs-readouts os-system-readouts" aria-label="实时结果">{!aperture&&<h3>实时结果</h3>}
      {aperture?<ApertureReadouts result={result} selected={apertureSelected} onToggle={onApertureToggle}/>:<>
        <div className="os-aberration-main"><AberrationReadouts result={result} selected={selected} onSelect={onSelect} keys={['longitudinalSA','chromaticShift','rmsRadius']}/></div>
        <details className="os-microscope-details os-system-extra"><summary>更多结果</summary>
          <AberrationReadouts result={result} selected={selected} onSelect={onSelect} keys={['index','thickness','effectiveFocal','backFocal','marginalFocus']}/>
          <AberrationFocalReadouts state={state} selected={selected} onSelect={onSelect}/>
        </details>
      </>}
    </section>
    {!aperture&&result.imagePreview&&<div ref={spot}><SceneImagePreview preview={result.imagePreview} showNote={false} selectedRadius={selected==='rmsRadius'?result.metrics.find(m=>m.key==='rmsRadius')?.value??null:null}/></div>}
    {aperture&&result.warnings.map(w=><p className="os-warning" key={w}>{w}</p>)}
  </div>;
}
