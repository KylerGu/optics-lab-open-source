import { useEffect, useRef, useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import { OpticsKnowledgeCard, FieldSymbol } from './OpticsKnowledge';
import { OPTICS_FORMULAS } from './opticsKnowledgeModel';
import { SCENE_DEFINITIONS, type SceneResult, type SceneState } from './sceneRuntime';
import AberrationSymbolDefinitions from './AberrationSymbolDefinitions';

export default function SceneFormulaSheet({state,result,onClose}:{state:SceneState;result?:SceneResult;onClose:()=>void}) {
  const study=state.parameters.study??0;
  const telescopeTopics=study===2?['telescope-resolution']:study===3?['telescope-pupil-position','telescope-pupil-diameter','telescope-angular']:['telescope-angular','system-focal'];
  const cameraTopics=study===0?['thin-lens','camera-defocus']:study===1?['camera-field']:study===2?['camera-depth','camera-defocus']:['camera-diffraction','camera-sampling'];
  const topics=OPTICS_FORMULAS.filter(f=>(state.sceneId!=='interference-1'||f.diagram===(state.parameters.mode===0?'thin-film':'newton-rings'))&&(state.sceneId!=='instruments-2'||cameraTopics.includes(f.id))&&(state.sceneId!=='instruments-1'||telescopeTopics.includes(f.id))&&SCENE_DEFINITIONS[state.sceneId].formulas.includes(f.id)&&(state.sceneId!=='instruments-0'||(study===1?f.id==='microscope-resolution':study===3?f.id==='microscope-depth':study===2&&state.parameters.mode===0?f.id==='microscope-eye-field':!['microscope-resolution','microscope-depth'].includes(f.id)&&(state.parameters.mode===1?f.diagram==='microscope-camera':f.diagram!=='microscope-camera'))));
  if(state.sceneId==='instruments-1')topics.sort((a,b)=>telescopeTopics.indexOf(a.id)-telescopeTopics.indexOf(b.id));
  const [selected,setSelected]=useState(topics[0].id);
  const dialog=useRef<HTMLDialogElement>(null),content=useRef<HTMLDivElement>(null);
  useEffect(()=>{dialog.current?.showModal();},[]);
  useEffect(()=>{content.current?.scrollTo({top:0});},[selected]);
  return <dialog ref={dialog} className="fk-sheet os-formula-sheet" aria-label={SCENE_DEFINITIONS[state.sceneId].title+'相关公式'} onClose={onClose} onClick={e=>{if(e.target!==e.currentTarget)return;const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.currentTarget.close();}}>
    <div className="fk-sheet-grip"/><header className="fk-sheet-heading"><h2><BookOpen size={18}/>相关公式</h2><button className="icon-button" aria-label="关闭相关公式" autoFocus onClick={()=>dialog.current?.close()}><X size={20}/></button></header>
    <div className="fk-sheet-body"><nav className="fk-topic-nav" aria-label="选择知识点">{topics.map(f=><button key={f.id} className={selected===f.id?'active':''} aria-pressed={selected===f.id} onClick={()=>setSelected(f.id)}><span>{f.title}</span><small>{f.fields.map((p,index)=><span key={p.key}>{index>0?' · ':null}{p.symbol?<FieldSymbol field={p}/>:p.label.split(' ').at(-1)}</span>)}</small></button>)}</nav><div className="fk-sheet-content" ref={content} data-navigation-scroll="scene-formula-sheet">{state.sceneId==='aberrations-1'&&<AberrationSymbolDefinitions/>}<OpticsKnowledgeCard key={selected} id={selected} state={state} result={result}/></div></div>
  </dialog>;
}
