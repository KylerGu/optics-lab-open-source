import {cameraLayout,moveCameraPart,type CameraDragPart} from './spatialCamera';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Aperture, ArrowDownToLine, Box, Check, ChevronDown, Copy, Focus, FolderOpen, Grid3X3, Layers, Lightbulb, Maximize2, MousePointer2, Move3D, Plus, Redo2, Rotate3D, RotateCcw, Save, ScanLine, Search, SlidersHorizontal, Sparkles, Sun, Trash2, Undo2, Upload, X } from 'lucide-react';
import type { Experiment } from './model';
import { DRAFT_KEY } from './model';
import type { BuilderConversationContext } from './researchConversation';
import InquiryComparison from './InquiryComparison';
import { sameVisualSnapshot, validateVisualActions, VISUAL_FIELDS, type ResearchVisualGuide, type VisualField } from './researchVisual';
import './inquiry-visual.css';
import './microscope-render.css';
import { spatialFourierParameters } from './spatialFourier';
import { spatialFourFParameters } from './spatialFourF';
import SpatialMeasurements from './SpatialMeasurements';
import SpatialBench, { type SpatialView } from './SpatialBench';
import { useSpatialSimulation } from './useSpatialSimulation';
import {microscopeLayout,focusMicroscope,microscopeResetBaseline,type FocusPhase} from './spatialMicroscope';
import {telescopeLayout,focusTelescope} from './spatialTelescope';
import { useLocalDebug } from './useLocalDebug';
import { BUILDER_DRAFT, BUILDER_SAVED, CATALOG, CATEGORIES, LENS_GROUPS, fromLegacy, makeSpatialElement, parseSpatial, sourceDivergenceMrad, spatialTemplate, type SpatialElement, type SpatialExperiment } from './builderModel';
import NumberInput from './BuilderNumberInput';
import LensSettings from './LensSettings';
import LensCatalog from './LensCatalog';
import {readMyLenses,saveMyLens,deleteMyLens,type SavedLens} from './lensPresets';
import { isPhysicalLens, physicalLensSurfaces as lensSurfaces, physicalLensSpan } from './physicalLensGeometry';
import { alignmentAxes, alignedPose } from './spatialAlignment';
import { BUILDER_ACTIVE_SAVED, readSavedSpatial as readSaved, type SavedSpatial as Saved } from './spatialStorage';
import {BUILDER_TABS,rememberBuilderConversations,saveBuilderTabSnapshot,initialBuilderTabs,parseBuilderTabs,serializeBuilderTabs,openBuilderTab,closeBuilderTab,builderTabDirty,type BuilderTabs,type BuilderHistory} from './builderTabs';
import {openResearchBuilderTab,type ResearchBuilderCopy} from './researchBuilderLink';
import './builder.css';
import './builderPanels.css';
import './lens-settings.css';
import './builder-readability.css';
import { useScenePanelWidth } from './useScenePanelWidth';
import './builder-resize.css';

const ICONS={object:Box,eye:Focus,sensor:ScanLine,laser:Sun,lens:Focus,'plano-convex-lens':Focus,'biconvex-lens':Focus,'plano-concave-lens':Focus,'biconcave-lens':Focus,'positive-meniscus-lens':Focus,'negative-meniscus-lens':Focus,'aspheric-convex-lens':Focus,'aspheric-concave-lens':Focus,'plano-convex-cylinder-lens':Focus,'plano-concave-cylinder-lens':Focus,'cylindrical-lens':Focus,'half-wave-plate':Layers,'quarter-wave-plate':Layers,mirror:Copy,splitter:Layers,'polarizing-splitter':Layers,screen:ScanLine,aperture:Aperture,filter:SlidersHorizontal,'right-prism':Box,'dispersion-prism':Box,polarizer:Layers,slit:SlidersHorizontal,'amplitude-grating':Grid3X3,'power-meter':Lightbulb};
function readInitial(){
  try{const raw=localStorage.getItem(BUILDER_DRAFT);if(raw)return {experiment:parseSpatial(JSON.parse(raw)),warning:null};const legacy=localStorage.getItem(DRAFT_KEY);if(legacy)return {experiment:fromLegacy(JSON.parse(legacy)),warning:null};}
  catch{return {experiment:spatialTemplate('empty'),warning:'未能读取上次草稿，原数据仍保留；可导入装置备份。'};}
  return {experiment:spatialTemplate('empty'),warning:null};
}

function OpticalSettings({distant=false,probeAvailable,highlightField,element:e,onUpdate,onEditing,onSaveLens,onChooseLens,sourceWavelengths,myLenses}:{distant?:boolean;probeAvailable:boolean;highlightField?:VisualField|null;onSaveLens:()=>void;onChooseLens:()=>void;sourceWavelengths:number[];myLenses:SavedLens[];element:SpatialElement;onUpdate:(patch:Partial<SpatialElement>)=>boolean;onEditing:(editing:boolean)=>void}){
  const common={onEditing};
  if(e.kind==='object'&&e.objectMode==='distant')return <div className="sb-optical-fields">
    <NumberInput {...common} label="物体高度" value={e.objectHeightMm} unit="mm" min={.001} max={200} step={.1} onChange={objectHeightMm=>onUpdate({objectHeightMm})}/>
    <NumberInput {...common} label="物体宽度" value={e.objectWidthMm} unit="mm" min={.001} max={200} step={.1} onChange={objectWidthMm=>onUpdate({objectWidthMm})}/>
    <NumberInput {...common} label="波长" value={e.wavelengthNm} unit="nm" min={380} max={1100} step={1} onChange={wavelengthNm=>onUpdate({wavelengthNm})}/>
    <small>光线从 F 上的点出发。位置决定实际物距；移动样品后，调整目镜位置重新对焦。</small>
  </div>;
  if(e.kind==='object')return <div className="sb-optical-fields">
    <label className="sb-beam-model">图案<select aria-label="物体图案" value={e.objectPattern} onChange={event=>onUpdate({objectPattern:event.target.value as 'F'|'arrow'})}><option value="F">F</option><option value="arrow">箭头</option></select></label>
    <NumberInput {...common} label="物体高度" value={e.objectHeightMm} unit="mm" min={.001} max={200} sliderMax={Math.min(200,Math.max(1,10**Math.ceil(Math.log10(e.objectHeightMm))))} step={.001} onChange={objectHeightMm=>onUpdate({objectHeightMm})}/>
    <NumberInput {...common} label="物体宽度" value={e.objectWidthMm} unit="mm" min={.001} max={200} sliderMax={Math.min(200,Math.max(1,10**Math.ceil(Math.log10(e.objectWidthMm))))} step={.001} onChange={objectWidthMm=>onUpdate({objectWidthMm})}/>
    <NumberInput {...common} label="图案转角" value={e.rollDeg} unit="°" min={-180} max={180} step={1} onChange={rollDeg=>onUpdate({rollDeg})}/>
    <small>实际物体尺寸会改变成像；仅查看请用画布中的局部放大。</small>
  </div>;
  if(e.kind==='eye'||e.kind==='sensor')return <div className="sb-optical-fields">
    {e.kind==='sensor'?<>
      <NumberInput {...common} label="感光面宽度" value={e.sensorWidthMm} unit="mm" min={.1} max={200} step={.1} onChange={sensorWidthMm=>onUpdate({sensorWidthMm})}/>
      <NumberInput {...common} label="感光面高度" value={e.sensorHeightMm} unit="mm" min={.1} max={200} step={.1} onChange={sensorHeightMm=>onUpdate({sensorHeightMm})}/>
      <NumberInput {...common} label="理想转接倍率" value={e.adapterMagnification} unit="倍" min={.1} max={10} step={.05} onChange={adapterMagnification=>onUpdate({adapterMagnification})}/>
      <small>位置为转接前等效像面；取景尺寸按倍率折算。</small>
    </>:distant?<><NumberInput {...common} label="眼瞳直径" value={e.diameterMm} unit="mm" min={1} max={8} step={.1} onChange={diameterMm=>onUpdate({diameterMm})}/><small>移动眼睛可调整距目镜的距离和偏心量。</small></>:<>
      <NumberInput {...common} label="明视参考距离" value={e.nearDistanceMm} unit="mm" min={100} max={1000} step={1} onChange={nearDistanceMm=>onUpdate({nearDistanceMm})}/>
      <NumberInput {...common} label="目镜视场数" value={e.fieldNumberMm} unit="mm" min={1} max={100} step={.1} onChange={fieldNumberMm=>onUpdate({fieldNumberMm})}/>
      <small>观察出射方向；不作为接收实像的屏。</small>
    </>}
  </div>;
  const changePeriod=(d:number)=>onUpdate({gratingPeriodUm:d,gratingSlitUm:Math.max(.01,Math.min(50,d,e.gratingSlitUm*d/e.gratingPeriodUm)),gratingWidthMm:Math.max(e.gratingWidthMm,2*d*.001)});
  const gaussian=e.beamModel==='gaussian',divergence=sourceDivergenceMrad(e);
  if(isPhysicalLens(e.kind))return <LensSettings element={e} onUpdate={onUpdate} onEditing={onEditing} onSave={onSaveLens} onChoose={onChooseLens} wavelengths={sourceWavelengths} saved={myLenses}/>;
  return <div className="sb-optical-fields">{e.kind==='laser'?<>
    <label className="sb-beam-model">光束类型<select aria-label="光束类型" value={e.beamModel} onChange={event=>onUpdate({beamModel:event.target.value as 'parallel'|'gaussian'})}><option value="parallel">几何光束</option><option value="gaussian">高斯光束</option></select></label>
    <NumberInput {...common} label="发射功率" value={e.powerMw} unit="mW" min={0} max={1000} step={1} onChange={powerMw=>onUpdate({powerMw})}/>
    <NumberInput {...common} label="波长" value={e.wavelengthNm} unit="nm" min={380} max={1100} step={1} onChange={wavelengthNm=>onUpdate({wavelengthNm})}/>
    <NumberInput {...common} label={gaussian?'束腰半径':'光束半径'} value={e.beamRadiusMm} unit="mm" min={.01} max={20} step={.01} sliderMax={5} onChange={beamRadiusMm=>onUpdate({beamRadiusMm})}/>
    <NumberInput {...common} label="发散半角" value={divergence} unit="mrad" min={gaussian?e.wavelengthNm*.001/(Math.PI*20):0} max={gaussian?e.wavelengthNm*.001/(Math.PI*.01):100} step={gaussian?.0001:.1} onChange={value=>onUpdate(gaussian?{beamRadiusMm:Math.min(20,Math.max(.01,e.wavelengthNm*.001/(Math.PI*value)))}:{divergenceMrad:value})}/>
    {gaussian&&<><NumberInput {...common} label="束腰距光源" value={e.waistOffsetMm} unit="mm" min={-2000} max={2000} step={.1} onChange={waistOffsetMm=>onUpdate({waistOffsetMm})}/><p className="sb-parameter-hint">正值沿出射方向 · 束腰半径与发散角联动</p></>}
    <NumberInput {...common} label="光线数量" value={e.rayCount} unit="条" min={1} max={201} step={1} onChange={rayCount=>onUpdate({rayCount})}/>
    <label className="sb-beam-model">偏振状态<select aria-label="偏振状态" value={e.polarization} onChange={event=>onUpdate({polarization:event.target.value as 'linear'|'unpolarized'})}><option value="linear">线偏振</option><option value="unpolarized">未偏振</option></select></label>
    {e.polarization==='linear'&&<NumberInput {...common} label="偏振角" value={e.polarizationDeg} unit="°" min={-180} max={180} step={1} onChange={polarizationDeg=>onUpdate({polarizationDeg})}/>}
  </>:e.kind==='amplitude-grating'?<>
    <label className="sb-beam-model">振幅条纹<select aria-label="振幅条纹" value={e.gratingProfile} onChange={event=>onUpdate({gratingProfile:event.target.value as 'binary'|'sinusoidal',...(event.target.value==='binary'?{gratingPeriodUm:Math.min(50,e.gratingPeriodUm),gratingSlitUm:Math.min(e.gratingSlitUm,e.gratingPeriodUm,50)}:{})})}><option value="binary">矩形透光条纹</option><option value="sinusoidal">余弦振幅条纹</option></select></label>
    <NumberInput {...common} label="周期 d" value={e.gratingPeriodUm} unit="μm" min={1000/1200} max={e.gratingProfile==='sinusoidal'?400:50} step={.01} onChange={changePeriod}/>
    <NumberInput {...common} label="刻线密度 G" value={1000/e.gratingPeriodUm} unit="线/mm" min={e.gratingProfile==='sinusoidal'?2.5:20} max={1200} step={1} onChange={G=>changePeriod(1000/G)}/>
    {e.gratingProfile==='sinusoidal'?<NumberInput {...common} label="调制度 m" value={e.gratingModulation} unit="" min={0} max={1} step={.01} onChange={gratingModulation=>onUpdate({gratingModulation})}/>:<NumberInput {...common} label="透光条纹宽度 a" value={e.gratingSlitUm} unit="μm" min={.01} max={e.gratingPeriodUm} step={.01} onChange={gratingSlitUm=>onUpdate({gratingSlitUm})}/>}
    <NumberInput {...common} label="通光宽度 W" value={e.gratingWidthMm} unit="mm" min={Math.max(.01,2*e.gratingPeriodUm*.001)} max={50} sliderMax={5} step={.01} onChange={gratingWidthMm=>onUpdate({gratingWidthMm})}/>
    <NumberInput {...common} label="通光高度 H" value={e.gratingHeightMm} unit="mm" min={.01} max={200} step={.1} onChange={gratingHeightMm=>onUpdate({gratingHeightMm})}/>
    {e.gratingProfile==='sinusoidal'?<p className="sb-parameter-hint">m = 0 时全通 · 前后焦面可查看频谱 · 4f 可查看滤波输出</p>:<p className="sb-parameter-hint">d = 1000/G · 透光占比 a/d = {(100*e.gratingSlitUm/e.gratingPeriodUm).toFixed(1)}% · 周期数 N = {Math.floor(e.gratingWidthMm/(e.gratingPeriodUm*.001)+1e-9)}</p>}
  </>:e.kind==='slit'?<>
    <label className="sb-beam-model">滤波方式<select aria-label="滤波方式" value={e.slitMode} onChange={event=>onUpdate({slitMode:event.target.value as 'pass'|'stop'})}><option value="pass">通光狭缝</option><option value="stop">遮光挡片</option></select></label>
    <NumberInput {...common} label={e.slitMode==='stop'?'挡片宽度 a':'狭缝宽度 a'} value={e.slitWidthMm} unit="mm" min={.001} max={20} sliderMax={1} step={.001} onChange={slitWidthMm=>onUpdate({slitWidthMm})}/>
    <NumberInput {...common} label={e.slitMode==='stop'?'挡片高度':'狭缝高度'} value={e.slitHeightMm} unit="mm" min={.01} max={200} step={.1} onChange={slitHeightMm=>onUpdate({slitHeightMm})}/>
    <p className="sb-parameter-hint">4f 系统中置于公共焦面 · 转动改变滤波方向</p>
  </>:<NumberInput {...common} label={e.kind==='aperture'?'通光口径':e.kind==='screen'?'观察屏直径':e.kind==='power-meter'?'探测面直径':e.kind.endsWith('prism')?'棱镜边长':'器件直径'} value={e.diameterMm} unit="mm" min={1} max={200} step={1} onChange={diameterMm=>onUpdate({diameterMm})}/>}
    {e.kind==='screen'&&probeAvailable&&<><NumberInput {...common} label="屏上取样点位置" value={e.probeOffsetMm} unit="mm" min={-Math.min(3,e.diameterMm/2)} max={Math.min(3,e.diameterMm/2)} step={.01} onChange={probeOffsetMm=>onUpdate({probeOffsetMm})}/><p className="sb-parameter-hint">0 表示屏中心；沿屏面横向选取光强读数点，不移动观察屏。</p></>}
    {['lens','cylindrical-lens'].includes(e.kind)&&<NumberInput {...common} highlighted={highlightField==='focalLengthMm'} label="焦距" value={e.focalLengthMm} unit="mm" min={-5000} max={5000} sliderMin={-500} sliderMax={500} step={1} onChange={focalLengthMm=>onUpdate({focalLengthMm})}/>}
    {e.kind==='cylindrical-lens'&&<><NumberInput {...common} label="聚焦方向角" value={e.rollDeg} unit="°" min={-180} max={180} step={.1} onChange={rollDeg=>onUpdate({rollDeg})}/><p className="sb-parameter-hint">只沿箭头方向聚焦；正焦距会聚，负焦距发散。高斯输入经过此器件后显示几何光线。</p></>}
    {(e.kind==='splitter'||e.kind==='filter'||e.kind==='polarizer'||e.kind==='half-wave-plate'||e.kind==='quarter-wave-plate')&&<NumberInput {...common} label={e.kind==='polarizer'?'轴向透过率':'透过率'} value={Math.round(e.transmission*1000)/10} unit="%" min={0} max={100} onChange={value=>onUpdate({transmission:value/100})}/>}
    {e.kind==='polarizing-splitter'&&<><NumberInput {...common} label="p偏振透过率" value={e.pTransmission*100} unit="%" min={0} max={100} onChange={value=>onUpdate({pTransmission:value/100})}/><NumberInput {...common} label="s偏振透过率" value={e.sTransmission*100} unit="%" min={0} max={100} onChange={value=>onUpdate({sTransmission:value/100})}/><p className="sb-parameter-hint">p在入射面内，s垂直入射面；根据实际偏振分配两路功率。默认p全透、s全反，反射率为1减透过率；无吸收薄分光面近似。</p></>}
    {e.kind==='polarizer'&&<NumberInput {...common} label="透光轴角度" value={e.rollDeg} unit="°" min={-180} max={180} step={.1} onChange={rollDeg=>onUpdate({rollDeg})}/>}
    {['half-wave-plate','quarter-wave-plate'].includes(e.kind)&&<><NumberInput {...common} label="快轴角度" value={e.rollDeg} unit="°" min={-180} max={180} step={.1} onChange={rollDeg=>onUpdate({rollDeg})}/><NumberInput {...common} label="设计波长" value={e.designWavelengthNm} unit="nm" min={380} max={1100} step={1} onChange={designWavelengthNm=>onUpdate({designWavelengthNm})}/><p className="sb-parameter-hint">设计波长下半波片转动线偏振方向；四分之一波片快轴与线偏振成45°时产生圆偏振。倾斜入射及偏离设计波长采用近似。</p></>}
    {e.kind.endsWith('prism')&&<>
      <NumberInput {...common} label="棱镜厚度" value={e.prismHeightMm} unit="mm" min={1} max={200} step={1} onChange={prismHeightMm=>onUpdate({prismHeightMm})}/>
      {e.kind==='dispersion-prism'&&<NumberInput {...common} label="棱镜顶角" value={e.apexAngleDeg} unit="°" min={20} max={100} step={1} onChange={apexAngleDeg=>onUpdate({apexAngleDeg})}/>}
    </>}
    {e.kind.endsWith('prism')&&<>
      <label className="sb-beam-model">材料<select aria-label="棱镜材料" value={e.glass} onChange={event=>onUpdate({glass:event.target.value as 'bk7'|'custom'})}><option value="bk7">N-BK7 玻璃</option><option value="custom">自定义玻璃</option></select></label>
      {e.glass==='custom'?<><NumberInput {...common} label="参考折射率" value={e.refractiveIndex} unit="" min={1} max={2.5} step={.001} onChange={refractiveIndex=>onUpdate({refractiveIndex})}/><NumberInput {...common} label="阿贝数" value={e.abbeNumber} unit="" min={10} max={1000} sliderMax={100} step={.1} onChange={abbeNumber=>onUpdate({abbeNumber})}/><p className="sb-parameter-hint">阿贝数越小，不同颜色的偏折差异越大</p></>:<p className="sb-parameter-hint">折射率随光源波长自动变化</p>}
    </>}
    {e.kind==='power-meter'&&<NumberInput {...common} label="测量量程" value={e.meterRangeMw} unit="mW" min={.001} max={3000} sliderMax={100} step={.1} onChange={meterRangeMw=>onUpdate({meterRangeMw})}/>}
  </div>;
}
function IconAction({label,onClick,disabled=false,children}:{label:string;onClick:()=>void;disabled?:boolean;children:React.ReactNode}){
  return <button className="sb-icon" title={label} aria-label={label} disabled={disabled} onClick={onClick}>{children}</button>;
}
function LensIllustration({kind}:{kind:SpatialElement['kind']}){
  const e=makeSpatialElement(kind),a=physicalLensSpan(e),points:[number,number][]=[];
  for(let i=0;i<=48;i++){const rho=-a+2*a*i/48;points.push([lensSurfaces(e,Math.abs(rho))[0],rho]);}
  for(let i=48;i>=0;i--){const rho=-a+2*a*i/48;points.push([lensSurfaces(e,Math.abs(rho))[1],rho]);}
  const path=points.map(([x,y],i)=>`${i?'L':'M'}${48+x*2.4},${36+y*2.4}`).join(' ')+' Z';
  return <svg width="96" height="72" viewBox="0 0 96 72" aria-hidden="true"><path d="M8 36H88" stroke="#c1cfdf" strokeDasharray="3 3"/><path d={path} fill="#d8edfa" stroke="#6691ca" strokeWidth="1.5"/></svg>;
}
export default function BuilderWorkspace({sceneCopy,onCopyConsumed,onScenes,researchCopy=null,onResearchCopyConsumed,onResearch,onConversation,visible=true}:{sceneCopy:{id:string;experiment:Experiment}|null;onCopyConsumed:()=>void;onScenes:()=>void;researchCopy?:ResearchBuilderCopy|null;onResearchCopyConsumed?:()=>void;onResearch?:()=>void;onConversation?:(context:BuilderConversationContext)=>void;visible?:boolean}){
  const [initial]=useState(readInitial);
  const [tabsInitial]=useState(()=>{
    try{const saved=readSaved(),raw=localStorage.getItem(BUILDER_TABS),id=localStorage.getItem(BUILDER_ACTIVE_SAVED);return {state:raw?parseBuilderTabs(raw,saved):initialBuilderTabs(initial.experiment,saved.some(row=>row.id===id)?id:null,saved.find(row=>row.id===id)?.conversationId),warning:null};}
    catch{return {state:initialBuilderTabs(initial.experiment),warning:'未能恢复标签页，原草稿仍保留；可从“我的装置”重新打开。'};}
  });
  const [workspace,setWorkspace]=useState(tabsInitial.state),workspaceRef=useRef(workspace);workspaceRef.current=workspace;
  const activeTab=workspace.tabs.find(tab=>tab.id===workspace.activeId)!,history=activeTab.history,activeSavedId=activeTab.savedId;
  const [focusDraft,setFocusDraft]=useState<SpatialExperiment|null>(null),focusBase=useRef<SpatialExperiment|null>(null);
  const experiment=focusDraft??history.present,latest=useRef(experiment);latest.current=experiment;
  const changeWorkspace=(next:BuilderTabs)=>{workspaceRef.current=next;latest.current=next.tabs.find(tab=>tab.id===next.activeId)!.history.present;setWorkspace(next);};
  const setHistory=(update:(history:BuilderHistory)=>BuilderHistory)=>{const current=workspaceRef.current;changeWorkspace({...current,tabs:current.tabs.map(tab=>tab.id===current.activeId?{...tab,resetBaseline:tab.resetBaseline??tab.history.present,history:update(tab.history)}:tab)});};
  const [assistantHost,setAssistantHost]=useState<HTMLDivElement|null>(null);
  const [guide,setGuide]=useState<ResearchVisualGuide|null>(null);
  const [selectedId,setSelectedId]=useState<string|null>(null),[category,setCategory]=useState('all'),[query,setQuery]=useState(''),[lensGroup,setLensGroup]=useState('all');
  const [myLenses,setMyLenses]=useState<SavedLens[]>(()=>{try{return readMyLenses();}catch{return [];}});
  const [replacingLens,setReplacingLens]=useState<string|null>(null),[lensRevision,setLensRevision]=useState(0);
  const [renderedTabs,setRenderedTabs]=useState<Record<string,boolean>>({});
  const rendered=renderedTabs[workspace.activeId]??false;
  const setRendered=(value:boolean)=>{const id=workspaceRef.current.activeId;setRenderedTabs(current=>({...current,[id]:value}));};
  const [view,setView]=useState<SpatialView>('perspective'),[reset,setReset]=useState(0),[tool,setTool]=useState<'translate'|'rotate'>('translate');
  const [manualEditing,setEditing]=useState(false),[showGrid,setShowGrid]=useState(true),[showBeam,setShowBeam]=useState(true),[run,setRun]=useState(initial.experiment.elements.some(e=>e.kind==='laser'||e.kind==='object')),[resultsOpen,setResultsOpen]=useState(false),[assistantOpen,setAssistantOpen]=useState(false);
  const editing=manualEditing||!!focusDraft;
  const [toast,setToast]=useState<string|null>(tabsInitial.warning??initial.warning),[storageOk,setStorageOk]=useState(true);
  const [saved,setSaved]=useState<Saved[]>([]);
  const activeSaved=useRef(activeSavedId);activeSaved.current=activeSavedId;
  const [closingTab,setClosingTab]=useState<string|null>(null),closeDialog=useRef<HTMLDialogElement>(null);
  const [axisHelp,setAxisHelp]=useState(true),[snapEnabled,setSnapEnabled]=useState(true);
  const catalogDialog=useRef<HTMLDialogElement>(null),library=useRef<HTMLDialogElement>(null),file=useRef<HTMLInputElement>(null),consumed=useRef<string|null>(null);
  // Reuse the existing wave-model guards; an out-of-range saved probe must remain editable.
  const probeAvailable=useMemo(()=>{
    const candidate={...experiment,elements:experiment.elements.map(e=>e.kind==='screen'?{...e,probeOffsetMm:0}:e)};
    return !!(spatialFourierParameters(candidate)||spatialFourFParameters(candidate));
  },[experiment]);
  const liveFocus=rendered&&!!(microscopeLayout(experiment)||telescopeLayout(experiment)||cameraLayout(experiment));
  const simulation=useSpatialSimulation(experiment,visible&&run&&!manualEditing,liveFocus),result=manualEditing?null:simulation.result;
  // Keep rays, hardware and image on the same completed calculation while the next is in flight.
  const benchExperiment=liveFocus&&result?result.inputSnapshot:experiment;
  useLocalDebug('builder', {
    tabId: activeTab.id, savedId: activeSavedId, selectedId, experiment,
    result: result ? { screens: result.screens, warnings: result.warnings, chiefPaths: result.segments.filter(segment => segment.chief) } : null,
  });
  const selected=experiment.elements.find(e=>e.id===selectedId)??null;
  const axes=useMemo(()=>alignmentAxes(experiment,selectedId),[experiment,selectedId]);
  const alignment=selected?alignedPose(experiment,selected.id,axes):null;
  const commit=(input:SpatialExperiment)=>{
    try{const next=parseSpatial(input);latest.current=next;setHistory(current=>JSON.stringify(current.present)===JSON.stringify(next)?current:{past:[...current.past,current.present].slice(-60),present:next,future:[]});return true;}
    catch(error){setToast(error instanceof Error?error.message:'装置参数无效。');return false;}
  };
  const update=(id:string,patch:Partial<SpatialElement>)=>commit({...latest.current,elements:latest.current.elements.map(e=>e.id===id?{...e,...patch}:e)});
  const focus=(phase:FocusPhase,distance?:number,part?:CameraDragPart)=>{
    if(phase==='start'){focusBase.current=latest.current;setFocusDraft(latest.current);setRun(true);return;}
    if(phase==='cancel'){focusBase.current=null;setFocusDraft(null);return;}
    if(distance===undefined)return;
    const input=focusBase.current??latest.current;
    const next=part&&cameraLayout(input)?moveCameraPart(input,distance,part):telescopeLayout(input)?focusTelescope(input,distance):focusMicroscope(input,distance);
    if(phase==='change'){setFocusDraft(next);return;}
    focusBase.current=null;setFocusDraft(null);commit(next);
  };
  const undo=()=>{setHistory(current=>!current.past.length?current:{past:current.past.slice(0,-1),present:current.past.at(-1)!,future:[current.present,...current.future]});setSelectedId(null);};
  const redo=()=>{setHistory(current=>!current.future.length?current:{past:[...current.past,current.present],present:current.future[0],future:current.future.slice(1)});setSelectedId(null);};
  const finishInput=()=>{(document.activeElement as HTMLElement|null)?.blur();const invalid=document.querySelector<HTMLInputElement>('.spatial-builder input[data-invalid="true"]');if(invalid){setToast('请先修正无效参数，再切换或关闭装置。');invalid.focus();return false;}if(editing){setToast('请先完成当前器件调整。');return false;}return true;};
  const restoreDefaults=()=>{
    if(!finishInput())return;
    const tab=workspaceRef.current.tabs.find(t=>t.id===workspaceRef.current.activeId)!;
    const baseline=tab.resetBaseline??tab.history.present,recovered=microscopeResetBaseline(baseline);
    if(commit({...recovered,name:tab.history.present.name})){
      if(recovered!==baseline){
        const current=workspaceRef.current;
        changeWorkspace({...current,tabs:current.tabs.map(t=>t.id===tab.id?{...t,resetBaseline:recovered}:t)});
        setToast('已修正旧默认物距，恢复合焦位置。');
      }
      setSelectedId(null);setGuide(null);setView('perspective');setReset(n=>n+1);setShowBeam(true);
      setRun(latest.current.elements.some(e=>e.kind==='laser'||e.kind==='object'));
    }
  };
  const viewport=useRef<HTMLDivElement>(null);
  const [fullscreen,setFullscreen]=useState(false);
  useEffect(()=>{
    const sync=()=>setFullscreen(document.fullscreenElement===viewport.current);
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){if(viewport.current?.matches(':fullscreen'))void document.exitFullscreen().catch(()=>{});setFullscreen(false);}};
    document.addEventListener('fullscreenchange',sync);
    document.addEventListener('keydown',escape);
    return ()=>{document.removeEventListener('fullscreenchange',sync);document.removeEventListener('keydown',escape);};
  },[]);
  const toggleFullscreen=async()=>{
    if(fullscreen){if(document.fullscreenElement)await document.exitFullscreen();setFullscreen(false);return;}
    const target=viewport.current;if(!target)return;
    try{await target.requestFullscreen();setFullscreen(true);}catch{setFullscreen(true);}
  };
  const panelContainer=useRef<HTMLDivElement>(null);
  const [leftPanelOpen,setLeftPanelOpen]=useState(true),[rightPanelOpen,setRightPanelOpen]=useState(true);
  const hasRightPanel=assistantOpen||!!(selected&&!rendered);
  const panelLayout=useScenePanelWidth(panelContainer,hasRightPanel&&rightPanelOpen,leftPanelOpen&&!rendered,{leftKey:'optics-builder-left-width:v1',leftMin:250,leftDefault:276,resultKey:'optics-builder-right-width:v1',resultDefault:340,resultMin:240,onLeftClose:()=>setLeftPanelOpen(false),onRightClose:()=>setRightPanelOpen(false)});
  const resetTabView=()=>{setGuide(null);setSelectedId(null);setEditing(false);setRun(latest.current.elements.some(e=>e.kind==='laser'||e.kind==='object'));setShowBeam(true);setResultsOpen(false);setAssistantOpen(false);setReset(n=>n+1);};
  const openTab=(next:SpatialExperiment,savedId:string|null=null)=>{if(!finishInput())return false;try{const archive=savedId?readSaved().find(row=>row.id===savedId):undefined;let state=openBuilderTab(workspaceRef.current,next,savedId,archive?.conversationId,archive?.resetBaseline);const keys=archive?.researchKeys;if(keys?.length)state={...state,tabs:state.tabs.map(t=>t.id===state.activeId?{...t,researchKeys:[...new Set([...(t.researchKeys??[]),...keys])]}:t)};changeWorkspace(state);activeSaved.current=state.tabs.find(tab=>tab.id===state.activeId)!.savedId;resetTabView();return true;}catch(error){setToast(error instanceof Error?error.message:'无法打开装置。');return false;}};
  const openResearchObject=(copy:ResearchBuilderCopy)=>{
    if(!copy.origin)return openTab(copy.experiment);
    if(!finishInput())return false;
    try{
      const existing=readSaved(),opened=openResearchBuilderTab(workspaceRef.current,copy.experiment,copy.origin,existing);
      if(opened.saved!==existing)localStorage.setItem(BUILDER_SAVED,JSON.stringify(opened.saved));
      setSaved(opened.saved);changeWorkspace(opened.workspace);activeSaved.current=opened.workspace.tabs.find(tab=>tab.id===opened.workspace.activeId)!.savedId;resetTabView();setAssistantOpen(true);return true;
    }catch(error){setToast(error instanceof Error?error.message:'无法打开研究装置。');return false;}
  };
  const switchTab=(id:string)=>{if(id===workspaceRef.current.activeId)return true;if(!workspaceRef.current.tabs.some(tab=>tab.id===id)||!finishInput())return false;changeWorkspace({...workspaceRef.current,activeId:id});activeSaved.current=workspaceRef.current.tabs.find(tab=>tab.id===id)!.savedId;resetTabView();return true;};
  const load=(kind:'empty'|'focus'|'fold'|'split'|'imaging')=>{if(openTab(spatialTemplate(kind)))setToast(kind==='empty'?'已在新标签页创建空白光路。':'示例已在新标签页打开，可以自由修改。');};
  const remove=()=>{if(selected){commit({...experiment,elements:experiment.elements.filter(e=>e.id!==selected.id)});setSelectedId(null);}};
  const add=(item:typeof CATALOG[number])=>{
    if(!item.kind)return;
    if(replacingLens&&!isPhysicalLens(item.kind)){setToast('请为实体镜片选择实体规格。');return;}
    if(replacingLens&&isPhysicalLens(item.kind)){const old=experiment.elements.find(e=>e.id===replacingLens);if(!old)return;const replacement=makeSpatialElement(item.kind,old.position,{...item.defaults,id:old.id,name:item.name,yawDeg:old.yawDeg,pitchDeg:old.pitchDeg,rollDeg:old.rollDeg});if(commit({...experiment,elements:experiment.elements.map(e=>e.id===old.id?replacement:e)})){setSelectedId(old.id);setLensRevision(n=>n+1);catalogDialog.current?.close();}return;}
    if(experiment.elements.length>=50){setToast('最多支持 50 个器件。');return;}if(item.kind==='laser'&&experiment.elements.filter(e=>e.kind==='laser').length>=3){setToast('最多支持三个光源。');return;}
    const x=item.kind==='laser'||item.kind==='object'?60:Math.min(600,180+experiment.elements.filter(e=>e.kind!=='laser').length*70);
    const count=experiment.elements.filter(e=>e.kind===item.kind).length;
    const element=makeSpatialElement(item.kind,[x,60,0],{...item.defaults,name:`${item.name}${count?' '+(count+1):''}`.slice(0,40)});
    if(commit({...experiment,elements:[...experiment.elements,element]})){setSelectedId(element.id);setRendered(false);catalogDialog.current?.close();if(item.kind==='laser'||item.kind==='object')setRun(true);}
  };
  const save=(asCopy=false,tabId=workspaceRef.current.activeId)=>{
    if(tabId===workspaceRef.current.activeId)(document.activeElement as HTMLElement|null)?.blur();
    const invalid=document.querySelector<HTMLInputElement>('.spatial-builder input[data-invalid="true"]');
    if(tabId===workspaceRef.current.activeId&&invalid){setToast('参数无效，请先修正后再保存。');invalid.focus();return false;}
    const tab=workspaceRef.current.tabs.find(t=>t.id===tabId);if(!tab)return false;
    try{
      const existing=readSaved(),next=saveBuilderTabSnapshot(existing,tab,asCopy);
      localStorage.setItem(BUILDER_SAVED,JSON.stringify(next.saved));
      const current=workspaceRef.current;
      changeWorkspace({...current,tabs:current.tabs.map(t=>t.id===tabId?next.tab:t)});
      if(tabId===current.activeId)activeSaved.current=next.tab.savedId;
      setSaved(next.saved);setToast(!asCopy&&existing.some(row=>row.id===tab.savedId)?'已更新当前装置。':'装置已保存。');return true;
    }catch(error){setToast(error instanceof Error?error.message:'无法写入装置存档，请导出文件备份。');return false;}
  };
  const rememberConversations=()=>{
    const existing=readSaved(),next=rememberBuilderConversations(workspaceRef.current.tabs,existing);
    if(next!==existing)localStorage.setItem(BUILDER_SAVED,JSON.stringify(next));
    setSaved(next);
  };
  const finishClose=(id:string)=>{
    try{rememberConversations();}catch{setToast('未能保存装置与对话的关联，标签暂未关闭，请导出对话备份。');return;}
    const wasActive=workspaceRef.current.activeId===id;changeWorkspace(closeBuilderTab(workspaceRef.current,id));activeSaved.current=workspaceRef.current.tabs.find(tab=>tab.id===workspaceRef.current.activeId)!.savedId;if(wasActive)resetTabView();closeDialog.current?.close();setClosingTab(null);
  };
  const requestClose=(id:string)=>{if(!finishInput())return;const tab=workspaceRef.current.tabs.find(t=>t.id===id);if(!tab)return;try{const rows=readSaved();setSaved(rows);if(builderTabDirty(tab,rows))setClosingTab(id);else finishClose(id);}catch{setToast('无法检查装置存档，请先导出备份。');}};
  const download=(value:unknown,name:string)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=name.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_')+'.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const importFile=async(input:File)=>{try{if(input.size>1024*1024)throw new Error('装置文件不能超过 1 MB。');const raw=JSON.parse(await input.text());const next=raw.schemaVersion===1?fromLegacy(raw):parseSpatial(raw);if(openTab(next))setToast('装置已在新标签页导入。');}catch(error){setToast(error instanceof Error?error.message:'装置导入失败。');}};
  useEffect(()=>{
    if(sceneCopy&&consumed.current!==sceneCopy.id&&openTab(fromLegacy(sceneCopy.experiment))){consumed.current=sceneCopy.id;setToast('场景装置已复制到新标签页，可以独立修改。');onCopyConsumed();}
  },[sceneCopy]);
  useEffect(()=>{
    if(researchCopy&&consumed.current!==researchCopy.id&&openResearchObject(researchCopy)){
      consumed.current=researchCopy.id;
      if(researchCopy.guide){
        const next=researchCopy.guide;
        try{
          validateVisualActions([next.action],[{id:next.action.objectId,experiment:next.snapshot}]);
          if(!sameVisualSnapshot(latest.current,next.snapshot))throw new Error('搭建页装置已变化。请回探究区更新装置后重新提问，未应用旧讲解定位。');
          setGuide(structuredClone(next));setSelectedId(next.action.elementId);setRendered(false);setTool('translate');setRun(true);setShowBeam(true);
        }catch(error){setToast(error instanceof Error?error.message:'无法定位该讲解。');}
      }
      onResearchCopyConsumed?.();
    }
  },[researchCopy]);
  useEffect(()=>{
    onConversation?.({tab:activeTab,selectedElementId:experiment.elements.some(e=>e.id===selectedId)?selectedId:null,editing,host:assistantHost,
      locate:(next)=>{
        if(workspaceRef.current.activeId!==activeTab.id||!sameVisualSnapshot(latest.current,next.snapshot)){setToast('装置参数已变化，请按当前光路重新获取定位说明。');return;}
        setGuide(structuredClone(next));setSelectedId(next.action.elementId);setRendered(false);setTool('translate');setRun(true);setShowBeam(true);
      },
      apply:(next,expected)=>{
        (document.activeElement as HTMLElement|null)?.blur();
        if(workspaceRef.current.activeId!==activeTab.id||editing||JSON.stringify(latest.current)!==JSON.stringify(expected)||document.querySelector('.spatial-builder input[data-invalid="true"]'))return false;
        if(!commit(next))return false;
        setRun(true);setShowBeam(true);return true;
      },
      bind:(key,baseline)=>{
        const state=workspaceRef.current;
        if(state.activeId!==activeTab.id)return;
        changeWorkspace({...state,tabs:state.tabs.map(t=>t.id===activeTab.id?{...t,researchKeys:[...new Set([...(t.researchKeys??[]),key])],researchContext:{key,baseline:structuredClone(baseline)}}:t)});
      }
    });
  },[activeTab,selectedId,editing,assistantHost,onConversation]);
  useEffect(()=>{try{rememberConversations();}catch{setToast('未能保存装置与对话的关联，原记录保留，请导出备份。');}},[workspace]);
  useEffect(()=>{if(initial.warning&&experiment===initial.experiment)return;try{localStorage.setItem(BUILDER_DRAFT,JSON.stringify(experiment));setStorageOk(true);}catch{setStorageOk(false);}},[experiment]);
  useEffect(()=>{if(tabsInitial.warning&&workspace===tabsInitial.state)return;try{localStorage.setItem(BUILDER_TABS,serializeBuilderTabs(workspace));}catch{setStorageOk(false);}},[workspace]);
  useEffect(()=>{try{if(activeSavedId)localStorage.setItem(BUILDER_ACTIVE_SAVED,activeSavedId);else localStorage.removeItem(BUILDER_ACTIVE_SAVED);}catch{setStorageOk(false);}},[activeSavedId]);
  useEffect(()=>{if(closingTab)closeDialog.current?.showModal();},[closingTab]);
  useEffect(()=>{document.getElementById('sb-tab-'+workspace.activeId)?.scrollIntoView({block:'nearest',inline:'nearest'});},[workspace.activeId]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(null),4200);return()=>clearTimeout(timer);},[toast]);
  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      if(!visible||library.current?.open||catalogDialog.current?.open||closeDialog.current?.open||editing)return;
      const textFocused=event.target instanceof HTMLElement&&(['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)||event.target.isContentEditable);
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();save();}
      if(textFocused||rendered)return;
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();event.shiftKey?redo():undo();}
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y'){event.preventDefault();redo();}
      if(event.key==='Delete')remove();if(event.key==='Escape')setSelectedId(null);
    };
    window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);
  });
  const items=CATALOG.filter(item=>item.kind&&(category==='all'||item.category===category)&&(category!=='lens'||lensGroup==='all'||item.lensGroup===lensGroup)&&(!query.trim()||`${item.name}${item.hint}`.toLowerCase().includes(query.trim().toLowerCase())));
  const calculate=()=>{setRun(true);setResultsOpen(true);simulation.retry();};
  const screenCount=experiment.elements.filter(e=>['screen','power-meter','sensor'].includes(e.kind)).length;
  const alignSelected=()=>{if(selected&&alignment&&update(selected.id,alignment)){setRun(true);setShowBeam(true);setToast('已对齐入射光轴，可撤销恢复。');}};
  const lightIssue=experiment.elements.some(e=>e.kind==='object')||!experiment.elements.some(e=>e.kind==='laser')?null:!showBeam?'光线显示已关闭':experiment.elements.filter(e=>e.kind==='laser').every(e=>e.powerMw===0)?'光源功率为 0，调高功率即可出光':result&&screenCount&&!result.screens.some(s=>s.hits>0)&&!((result.fourF??result.fourier)?.capturedPowerMw)?'光线未到达探测器，请检查位置或对齐光轴':null;
  const savedStatus=activeSavedId?(JSON.stringify(saved.find(row=>row.id===activeSavedId)?.experiment)===JSON.stringify(experiment)?'装置已保存':'存档待更新'):'草稿已保存';
  const pendingClose=workspace.tabs.find(tab=>tab.id===closingTab);
  return <main className={`spatial-builder ${rendered?'sb-rendered':''}`} aria-label="光路搭建">
    <div className="sb-document-strip"><div className="sb-document-tabs" aria-label="打开的装置"><div role="tablist" aria-label="装置标签页">{workspace.tabs.map(tab=><div key={tab.id} className={`sb-document-tab ${tab.id===workspace.activeId?'active':''}`}><button id={'sb-tab-'+tab.id} role="tab" aria-selected={tab.id===workspace.activeId} aria-controls="sb-device-workspace" tabIndex={tab.id===workspace.activeId?0:-1} onClick={()=>switchTab(tab.id)} onKeyDown={event=>{const index=workspace.tabs.findIndex(t=>t.id===tab.id);const next=event.key==='ArrowRight'?workspace.tabs[(index+1)%workspace.tabs.length]:event.key==='ArrowLeft'?workspace.tabs[(index+workspace.tabs.length-1)%workspace.tabs.length]:event.key==='Home'?workspace.tabs[0]:event.key==='End'?workspace.tabs.at(-1):null;if(next){event.preventDefault();if(switchTab(next.id))document.getElementById('sb-tab-'+next.id)?.focus();}}} title={tab.history.present.name}><Box size={14}/><span>{tab.history.present.name}</span>{builderTabDirty(tab,saved)&&<i className="sb-unsaved-dot" aria-label="未保存修改" title="未保存修改"/>}</button><button className="sb-tab-close" aria-label={'关闭装置 '+tab.history.present.name} title="关闭装置" onClick={()=>requestClose(tab.id)}><X size={14}/></button></div>)}</div><button className="sb-new-tab" aria-label="新建装置标签页" title="新建装置" onClick={()=>load('empty')}><Plus size={17}/></button></div><div className="sb-project-actions"><button onClick={()=>load('empty')}><Plus size={15}/>空白新建</button><button onClick={onScenes}><FolderOpen size={15}/>从场景复制</button><span className="sb-separator"/><IconAction label="打开我的装置" onClick={()=>{try{setSaved(readSaved());library.current?.showModal();}catch{setToast('无法读取装置存档。');}}}><FolderOpen size={17}/></IconAction><details className="sb-file-menu"><summary aria-label="装置操作"><ArrowDownToLine size={17}/></summary><div><label className="sb-rename">装置名称<input aria-label="光路名称" maxLength={80} key={experiment.name} defaultValue={experiment.name} onBlur={event=>{const name=event.target.value.trim();if(name)commit({...experiment,name});else event.target.value=experiment.name;}} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}}/></label><button onClick={()=>file.current?.click()}><Upload size={14}/>导入装置</button><button onClick={()=>download(latest.current,latest.current.name)}><ArrowDownToLine size={14}/>导出装置</button><button disabled={editing} onClick={()=>save(true)}><Copy size={14}/>另存为副本</button></div></details><span className="sb-autosave" title={storageOk?savedStatus:'存储不可用，请导出备份'}>{storageOk?<Check size={12}/>:<Upload size={12}/>} {storageOk?savedStatus:'请导出备份'}</span><button className="sb-save" disabled={editing} onClick={()=>save()}><Save size={14}/>保存装置</button></div></div>
    <div ref={panelContainer} id="sb-device-workspace" role="tabpanel" aria-labelledby={'sb-tab-'+workspace.activeId} className={`sb-body sb-resizable-body ${panelLayout.resizing?"sb-panel-resizing":""} ${selected&&!rendered&&!assistantOpen?'has-inspector':''} ${assistantOpen?'has-builder-assistant':''}`}>
      <aside hidden={!leftPanelOpen||rendered} style={{width:panelLayout.width}} className="sb-library" aria-label="当前装置">
        <div className="sb-library-heading"><h2>当前装置 <span>{experiment.elements.length}</span></h2><button className="sb-add-device" onClick={()=>{setReplacingLens(null);catalogDialog.current?.showModal();}}><Plus size={14}/>添加器材</button></div>
        <div className="sb-device-list" data-navigation-scroll="builder-devices">{experiment.elements.length?experiment.elements.map((e,index)=>{const Icon=ICONS[e.kind];return <button key={e.id} disabled={editing} onClick={()=>setSelectedId(e.id)} aria-pressed={selectedId===e.id} className={selectedId===e.id?'active':''}><span>{String(index+1).padStart(2,'0')}</span><Icon size={16}/><strong>{e.name}</strong></button>;}):<p>点击“添加器材”开始搭建</p>}</div>
        {selected?<section className="sb-optical-panel" aria-label="光学参数" key={selected.id}>
          <div className="sb-optical-heading"><h2>光学参数</h2><span>{selected.kind==='laser'?'光源':selected.name}</span></div>
          <div className="sb-selected-title"><span>{(() => {const Icon=ICONS[selected.kind];return <Icon size={20}/>;})()}</span><input key={selected.name} aria-label="器件名称" maxLength={40} defaultValue={selected.name} onBlur={event=>{if(event.target.value.trim())update(selected.id,{name:event.target.value.trim()});else event.target.value=selected.name;}} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}}/></div>
          <OpticalSettings distant={experiment.elements.some(e=>e.kind==='object'&&e.objectMode==='distant')} probeAvailable={probeAvailable} key={selected.id+":"+lensRevision} element={selected} highlightField={guide?.action.elementId===selected.id?guide.action.field:null} onUpdate={patch=>update(selected.id,patch)} onEditing={setEditing} sourceWavelengths={experiment.elements.filter(e=>e.kind==='laser').map(e=>e.wavelengthNm)} myLenses={myLenses} onChooseLens={()=>{setReplacingLens(selected.id);setCategory('lens');setLensGroup('all');setQuery('');catalogDialog.current?.showModal();}} onSaveLens={()=>{(document.activeElement as HTMLElement|null)?.blur();if(document.querySelector('.spatial-builder input[data-invalid="true"]')){setToast('请先修正无效参数。');return;}try{setMyLenses(saveMyLens(latest.current.elements.find(e=>e.id===selected.id)!));setToast('已保存到我的镜片。');}catch(error){setToast(error instanceof Error?error.message:'镜片保存失败。');}}}/>
          {selected.kind==='power-meter'&&<div className="sb-meter-reading" aria-label="功率计读数"><span>当前读数</span><strong>{result?.screens.find(s=>s.elementId===selected.id)?.overRange?'超量程':result?.screens.find(s=>s.elementId===selected.id)?.readingMw!==undefined?`${(result.screens.find(s=>s.elementId===selected.id)?.readingMw??0).toFixed(4)} mW`:'运行仿真后显示'}</strong><small>几何采样 · 有限探测面</small></div>}
          <div className="sb-inspector-bottom"><button onClick={()=>{const clone={...selected,id:crypto.randomUUID(),name:selected.name.slice(0,35)+' 副本',position:[selected.position[0],selected.position[1],Math.min(1000,selected.position[2]+50)] as [number,number,number]};if(commit({...experiment,elements:[...experiment.elements,clone]}))setSelectedId(clone.id);}}><Copy size={14}/>复制器件</button><button onClick={remove}><Trash2 size={14}/>删除</button></div>
        </section>:<div className="sb-selection-hint"><SlidersHorizontal size={20}/><p>选择装置中的器件<br/>在这里调整光学参数</p></div>}
      </aside>
      {leftPanelOpen&&!rendered&&<div className="sb-panel-resizer" {...panelLayout.separator} aria-label="调整当前装置栏宽度"/>}
      <section className="sb-stage" aria-label="三维光路工作区">
        <div className="sb-stage-toolbar"><div className="sb-tool-group"><IconAction label={leftPanelOpen&&!rendered?'收起当前装置栏':'展开当前装置栏'} onClick={()=>{setLeftPanelOpen(rendered||!leftPanelOpen);if(rendered)setRendered(false);}}><SlidersHorizontal size={17}/></IconAction><IconAction label={rightPanelOpen&&hasRightPanel?'收起右侧面板':'展开右侧面板'} disabled={!hasRightPanel} onClick={()=>setRightPanelOpen(v=>!v)}><Box size={17}/></IconAction><IconAction label="撤销" disabled={!history.past.length||editing} onClick={undo}><Undo2 size={17}/></IconAction><IconAction label="重做" disabled={!history.future.length||editing} onClick={redo}><Redo2 size={17}/></IconAction><button className="sb-tool" title="恢复复制或打开时的器材和参数，可撤销" disabled={editing} onClick={restoreDefaults}><RotateCcw size={16}/><span>恢复默认</span></button>{!rendered&&<><span className="sb-separator"/><button className={`sb-tool ${tool==='translate'?'active':''}`} aria-pressed={tool==='translate'} onClick={()=>setTool('translate')}><Move3D size={16}/><span>移动</span></button><button className={`sb-tool ${tool==='rotate'?'active':''}`} aria-pressed={tool==='rotate'} onClick={()=>setTool('rotate')}><Rotate3D size={16}/><span>旋转</span></button></>}</div>
          <div className="sb-mode-switch"><button aria-pressed={!rendered} className={!rendered?'active':''} onClick={()=>setRendered(false)}><Box size={14}/>搭建</button><button aria-pressed={rendered} className={rendered?'active':''} onClick={()=>{setRendered(true);setSelectedId(null);setRun(true);setAssistantOpen(false);}}><Sparkles size={14}/>光路渲染</button></div>
          <div className="sb-tool-group"><select aria-label="载入光路示例" value="" onChange={event=>{if(event.target.value)load(event.target.value as 'focus'|'fold'|'split'|'imaging');}}><option value="" disabled>光路示例</option><option value="imaging">物体成像</option><option value="focus">单透镜聚焦</option><option value="fold">立体折转</option><option value="split">双路分光</option></select><button className={`sb-ai-toggle ${assistantOpen?'active':''}`} title="描述实验目标，让 AI 帮你设计和搭建光路" aria-expanded={assistantOpen} aria-controls="sb-ai-assistant" onClick={()=>{setAssistantOpen(v=>!v);setRightPanelOpen(true);setRendered(false);}}><Sparkles size={19}/><span>AI 助手</span></button><button className="sb-run" disabled={!experiment.elements.some(e=>e.kind==='laser'||e.kind==='object')||editing} onClick={calculate}><Lightbulb size={15}/><span>运行仿真</span></button></div>
        </div>
        {guide&&<div className="sb-inquiry-guide" aria-label="探究讲解定位"><div><strong>{guide.action.kind==='compare'?'边调边看':guide.action.kind==='adjust'?'参数定位':'器件定位'} · {guide.snapshot.elements.find(e=>e.id===guide.action.elementId)?.name}{guide.action.field&&' · '+VISUAL_FIELDS[guide.action.field]}</strong><p>{guide.action.explanation}</p></div><div><button disabled={!experiment.elements.some(e=>e.id===guide.action.elementId&&e.kind===guide.snapshot.elements.find(b=>b.id===guide.action.elementId)?.kind)||editing} onClick={()=>{setSelectedId(guide.action.elementId);setRendered(false);setAssistantOpen(false);}}>定位器件</button>{onResearch&&<button onClick={onResearch}>返回探究</button>}<button onClick={()=>setGuide(null)} aria-label="关闭讲解定位">关闭</button></div></div>}
        <div ref={viewport} className={`sb-viewport ${fullscreen?'sb-viewport-fullscreen':''}`}>
          <SpatialBench visible={visible} experiment={benchExperiment} selectedId={selectedId} rendered={rendered} result={result} view={view} reset={reset} tool={tool} showGrid={showGrid} showBeam={showBeam} axes={axes} showAxes={axisHelp&&!rendered&&!!selected} snapEnabled={snapEnabled} onSelect={setSelectedId} onEditing={setEditing} onTransform={update} onFocus={focus}/>
          <div className="sb-canvas-status"><span className="sb-space-badge">{rendered?'光路渲染':'三维搭建'}</span>{run&&<span className={`sb-compute-status ${simulation.status==='error'?'error':''}`}>{manualEditing?'松开后更新':simulation.status==='ready'?'光路已更新':simulation.status==='pending'?'计算中…':simulation.status==='error'?'计算未完成':'请添加光源'}</span>}</div>
          {lightIssue&&<div className="sb-light-hint" role="status"><Sun size={14}/><span>{lightIssue}</span>{!showBeam?<button onClick={()=>setShowBeam(true)}>显示光线</button>:experiment.elements.filter(e=>e.kind==='laser').every(e=>e.powerMw===0)?<button onClick={()=>setSelectedId(experiment.elements.find(e=>e.kind==='laser')!.id)}>选择光源</button>:alignment?<button onClick={alignSelected}>对齐所选器件</button>:<button onClick={()=>setSelectedId(result?.screens.find(s=>s.hits===0)?.elementId??null)}>选择观察屏</button>}</div>}
          {!experiment.elements.length&&<div className="sb-empty"><div className="sb-empty-icon"><Focus size={37} strokeWidth={1}/></div><h1>从一束光开始</h1><p>点击“添加器材”，搭建你的三维光路</p><div><button onClick={()=>add(CATALOG.find(item=>item.id==='laser-green')!)}><Plus size={14}/>添加光源</button><button onClick={()=>load('fold')}>体验立体折转<Move3D size={14}/></button></div></div>}
          {simulation.status==='error'&&<div className="sb-simulation-error" role="alert">{simulation.error}<button onClick={simulation.retry}>重试</button></div>}
          <div className="sb-view-controls">{([['perspective','透视'],['top','顶视'],['side','侧视']] as const).map(([value,label])=><button key={value} className={view===value?'active':''} aria-pressed={view===value} onClick={()=>setView(value)}>{label}</button>)}<span/><IconAction label={fullscreen?"退出全屏":"全屏显示"} onClick={()=>void toggleFullscreen()}><Maximize2 size={15}/></IconAction></div>
          <div className="sb-display-controls"><button className={showGrid?'active':''} aria-pressed={showGrid} title="显示网格" aria-label="显示网格" onClick={()=>setShowGrid(v=>!v)}><Grid3X3 size={15}/></button><button className={showBeam?'active':''} aria-pressed={showBeam} title="显示光线" aria-label="显示光线" onClick={()=>setShowBeam(v=>!v)}><Sun size={16}/></button></div>
        </div>
        {guide?.action.kind==='compare'&&<InquiryComparison guide={guide} experiment={experiment} result={result} pending={editing||simulation.status==='pending'||simulation.status==='idle'} error={simulation.error} retry={simulation.retry}/>}
        <div className="sb-statusbar"><span><MousePointer2 size={12}/>{rendered?(liveFocus?(cameraLayout(experiment)?'拖动镜筒或感光面调焦':telescopeLayout(experiment)?'拖动目镜筒或调焦环调焦':'拖动旋钮或载物台调焦'):'左键拖动旋转'):selected?'拖动彩色坐标轴调整器件':'点击选择 · 左键旋转'} · 右键拖动平移 · 滚轮围绕鼠标缩放</span><button onClick={()=>setResultsOpen(v=>!v)} aria-expanded={resultsOpen}>{experiment.elements.length} 个器件<span>·</span>{screenCount} 个探测器{run&&<><span>·</span>查看仿真</>}<ChevronDown size={13}/></button></div>
        {resultsOpen&&<section className="sb-results" aria-label="仿真结果"><div className="sb-results-heading"><h2>仿真结果</h2><div>{result&&<button onClick={()=>download(result,experiment.name+'-仿真结果')}><ArrowDownToLine size={14}/>导出</button>}<IconAction label="关闭仿真结果" onClick={()=>setResultsOpen(false)}><X size={16}/></IconAction></div></div>
          {!run?<p>搭建完成后，点击“运行仿真”查看当前装置的光线与观察屏结果。</p>:!result?<p>{editing?'调整器件后重新计算。':simulation.error??(simulation.status==='idle'?'请先添加光源。':'正在追踪当前光路…')}</p>:<><SpatialMeasurements result={result} onSelect={id=>{setSelectedId(id);setRendered(false);}}/></>}
        </section>}
      </section>
      {hasRightPanel&&rightPanelOpen&&<div className="sb-panel-resizer" {...panelLayout.results.separator} aria-label="调整右侧面板宽度"/>}
      <div className="sb-right-panel" hidden={!hasRightPanel||!rightPanelOpen} style={{width:panelLayout.results.width}}>
      {selected&&!rendered&&!assistantOpen&&<aside className="sb-inspector" aria-label="空间调整"><div className="sb-inspector-heading"><h2>空间调整</h2><IconAction label="关闭器件参数" onClick={()=>setRightPanelOpen(false)}><X size={16}/></IconAction></div><p className="sb-pose-name">{selected.name}</p>
        <div className="sb-alignment-tools"><button className="sb-align" disabled={!alignment||editing} onClick={alignSelected}><Focus size={15}/>一键对齐光轴</button><div><label><input type="checkbox" checked={axisHelp} onChange={event=>setAxisHelp(event.target.checked)}/>光轴基准线</label><label title="拖动到光轴 6 mm 内自动吸附，旋转到对齐方向 2° 内自动匹配"><input type="checkbox" checked={snapEnabled} onChange={event=>setSnapEnabled(event.target.checked)}/>拖动吸附</label></div></div>
        <fieldset><legend>空间位置</legend><div className="sb-position-fields">{(['X · 前后','Y · 高度','Z · 左右'] as const).map((label,index)=><NumberInput key={selected.id+label} highlighted={guide?.action.elementId===selected.id&&guide.action.field===['x','y','z'][index]} label={label} value={selected.position[index]} unit="mm" min={-1000} max={1000} sliderMin={index===1?0:-500} sliderMax={index===1?500:800} step={1} onEditing={setEditing} onChange={value=>{const position=[...selected.position] as [number,number,number];position[index]=value;return update(selected.id,{position});}}/>)}</div></fieldset>
        <fieldset><legend>器件朝向</legend><div className="sb-angle-fields"><NumberInput key={selected.id+'yaw'} label="水平转角" value={selected.yawDeg} unit="°" min={-180} max={180} step={1} onEditing={setEditing} onChange={yawDeg=>update(selected.id,{yawDeg})}/><NumberInput key={selected.id+'pitch'} label="俯仰角" value={selected.pitchDeg} unit="°" min={-90} max={90} step={1} onEditing={setEditing} onChange={pitchDeg=>update(selected.id,{pitchDeg})}/></div>{(selected.kind.endsWith('prism')||['slit','amplitude-grating','plano-convex-cylinder-lens','plano-concave-cylinder-lens','cylindrical-lens','polarizer','half-wave-plate','quarter-wave-plate'].includes(selected.kind))&&<NumberInput key={selected.id+'roll'} label={selected.kind==='amplitude-grating'?'条纹方向角 φ':'轴向转角'} value={selected.rollDeg} unit="°" min={-180} max={180} step={.1} onEditing={setEditing} onChange={rollDeg=>update(selected.id,{rollDeg})}/>}</fieldset>
      </aside>}
      {assistantOpen&&<aside id="sb-ai-assistant" className="sb-assistant"><IconAction label="关闭AI助手" onClick={()=>setAssistantOpen(false)}><X size={17}/></IconAction><div ref={setAssistantHost} className="sb-conversation-host"/></aside>}
      </div>
    </div>
    <input type="file" accept=".json,application/json" ref={file} hidden onChange={event=>{const input=event.target.files?.[0];if(input)void importFile(input);event.target.value='';}}/>
    <dialog ref={catalogDialog} className="sb-catalog-dialog" aria-labelledby="sb-add-title" onClose={()=>setReplacingLens(null)}><div className="sb-catalog-heading"><div><h2 id="sb-add-title">{replacingLens?'更换镜片规格':'添加器材'}</h2><span>{replacingLens?'替换选中镜片，保留位置和朝向':'选择后加入当前装置'}</span></div><IconAction label="关闭器材选择" onClick={()=>catalogDialog.current?.close()}><X size={18}/></IconAction></div>
        <label className="sb-search"><Search size={15}/><input aria-label="搜索器材" placeholder="搜索器材" value={query} onChange={event=>setQuery(event.target.value)}/>{query&&<button aria-label="清空搜索" onClick={()=>setQuery('')}><X size={13}/></button>}</label>
        <div className="sb-categories" aria-label="器材分类">{CATEGORIES.filter(item=>item.id==='all'||CATALOG.some(device=>device.kind&&device.category===item.id)).map(item=><button key={item.id} className={category===item.id?'active':''} aria-pressed={category===item.id} onClick={()=>setCategory(item.id)}>{item.name}</button>)}</div>
        {category==='lens'&&<div className="sb-categories" aria-label="透镜分类">{LENS_GROUPS.map(item=><button key={item.id} className={lensGroup===item.id?'active':''} aria-pressed={lensGroup===item.id} onClick={()=>setLensGroup(item.id)}>{item.name}</button>)}</div>}
        <div hidden={category==='lens'}><div className="sb-catalog" data-navigation-scroll="builder-catalog">{items.length?items.map(item=>{const Icon=item.kind?ICONS[item.kind]:item.category==='prism'?Box:item.category==='mount'?Grid3X3:Aperture;return <button className={`sb-item ${item.kind??'pending'}`} key={item.id} disabled={!item.kind} title={item.hint} aria-label={item.kind?`添加${item.name}`:item.name+'：'+item.hint} onClick={()=>add(item)}><div className="sb-item-illustration">{item.kind&&isPhysicalLens(item.kind)?<LensIllustration kind={item.kind}/>:<Icon size={30} strokeWidth={1.35}/>}{item.kind&&<Plus size={12} className="sb-item-plus"/>}</div><strong>{item.name}</strong><small>{item.kind?item.hint:item.category==='mount'?'渲染时自动显示':'待支持'}</small></button>;}):<p className="sb-no-items">没有找到对应器材</p>}</div></div>
      {category==='lens'&&<LensCatalog key={replacingLens??'add'} group={lensGroup} query={query} saved={myLenses} onAdd={add} onDelete={id=>{try{setMyLenses(deleteMyLens(id));setToast('镜片规格已移除，当前装置仍保留。');}catch{setToast('无法读取我的镜片，原存档仍保留。');}}}/>}
    </dialog>
    <dialog ref={library} className="sb-library-dialog"><div><h2>我的装置</h2><IconAction label="关闭我的装置" onClick={()=>library.current?.close()}><X size={18}/></IconAction></div>{saved.length?saved.map(row=><article key={row.id}><button onClick={()=>{if(openTab(row.experiment,row.id))library.current?.close();}}><strong>{row.experiment.name}{workspace.tabs.some(tab=>tab.savedId===row.id)&&<span className="sb-current-save">{activeSavedId===row.id?'当前':'已打开'}</span>}</strong><small>{row.experiment.elements.length} 个器件 · {new Date(row.savedAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}</small></button><IconAction label={'删除存档 '+row.experiment.name} onClick={()=>{try{const next=saved.filter(s=>s.id!==row.id);localStorage.setItem(BUILDER_SAVED,JSON.stringify(next));setSaved(next);changeWorkspace({...workspaceRef.current,tabs:workspaceRef.current.tabs.map(tab=>tab.savedId===row.id?{...tab,savedId:null}:tab)});if(row.id===activeSaved.current)activeSaved.current=null;}catch{setToast('无法删除存档。');}}}><Trash2 size={16}/></IconAction></article>):<p>还没有保存的装置。</p>}</dialog>
    <dialog ref={closeDialog} className="sb-close-dialog" aria-labelledby="sb-close-title" onClose={()=>setClosingTab(null)}><h2 id="sb-close-title">保存装置后再关闭？</h2><p>“{pendingClose?.history.present.name}”有未保存的修改。</p><div><button className="sb-close-cancel" onClick={()=>closeDialog.current?.close()}>取消</button><button className="sb-close-discard" onClick={()=>{if(closingTab)finishClose(closingTab);}}>不保存</button><button className="sb-close-save" onClick={()=>{if(closingTab&&save(false,closingTab))finishClose(closingTab);}}>保存并关闭</button></div></dialog>
    {toast&&<div className="sb-toast" role="status"><Check size={15}/>{toast}<button aria-label="关闭提示" onClick={()=>setToast(null)}><X size={14}/></button></div>}
  </main>;
}
