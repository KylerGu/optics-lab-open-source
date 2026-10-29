import SpatialImagePreview from './SpatialImagePreview';
import type {ImageView} from './spatialImageView';
import type {SpatialElement} from './builderModel';
import {objectPatternLines} from './spatialImaging';

/** A face-on inspection view; never scales the apparatus or optical inputs. */
export default function SpatialObjectPreview({object,warning,image,steady=false,observerKind}:{object:SpatialElement;warning?:string;image?:ImageView|null;steady?:boolean;observerKind?:'eye'|'sensor'}){
  const size=Math.hypot(object.objectWidthMm,object.objectHeightMm);
  const scale=90/size;
  const centerX=object.objectPattern==='F'?object.objectWidthMm/2:0;
  const comparison=!!image||!!observerKind;
  return <details className={`sb-object-preview ${comparison?'has-image':''}`} open>
    <summary>{comparison?'物像对照':object.name+' · 局部查看'}</summary>
    <div className="sb-object-preview-pair"><div className="sb-object-inspection">{comparison&&<span>物体 · 近看</span>}
    <svg viewBox="0 0 130 120" role="img" aria-label={`${object.name}图案放大预览，不改变实际尺寸`}>
      <g transform={`translate(65 60) rotate(${-object.rollDeg}) scale(${scale} ${-scale}) translate(${-centerX} ${-object.objectHeightMm/2})`}>
        {objectPatternLines(object.objectPattern).map((line,i)=><path key={i} d={line.map(([x,y],j)=>`${j?'L':'M'}${x*object.objectWidthMm},${y*object.objectHeightMm}`).join(' ')} fill="none" stroke="#278d78" strokeWidth="3" vectorEffect="non-scaling-stroke"/>)}
      </g>
    </svg>
    </div>{image?<SpatialImagePreview key={String(steady)} view={image} steady={steady}/>:observerKind&&<div className="sb-image-preview"><span className="sb-image-preview-label">{observerKind==='eye'?'目视':'成像'} · 近看</span><div className="sb-image-placeholder" role="img" aria-label="暂无有效成像">暂无成像</div><span aria-hidden="true">&nbsp;</span></div>}</div>
    {warning&&<p role="status" title={warning}>{warning.includes('样品尺寸或偏移过大')?'超出成像范围，请减小尺寸或偏移。':warning.includes('部分')?'部分光线无法成像。':'当前配置暂不支持成像。'}</p>}
  </details>;
}
