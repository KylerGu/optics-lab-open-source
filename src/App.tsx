import { SceneAssistantControls } from './SceneAssistantToggle';
import PolarizationRefractionScene from './PolarizationRefractionScene';
import WaveplateScene from './WaveplateScene';
import MalusScene from './MalusScene';
import FourFScene from './FourFScene';
import FourierLensScene from './FourierLensScene';
import CourseCenter from './CourseCenter';
import BuilderWorkspace from './BuilderWorkspace';
import ResearchWorkspace from './ResearchWorkspace';
import GaussianScene from './GaussianScene';
import GaussianFocusScene from './GaussianFocusScene';
import GaussianExpanderScene from './GaussianExpanderScene';
import ResonatorScene from './ResonatorScene';
import LaserGainScene from './LaserGainScene';
import WaveSuperpositionScene from './WaveSuperpositionScene';
import FiberModesScene from './FiberModesScene';
import FiberCouplingScene from './FiberCouplingScene';
import PointSourceScene from './PointSourceScene';
import IlluminationScene from './IlluminationScene';
import YoungDoubleSlitScene from './YoungDoubleSlitScene';
import SingleSlitScene from './SingleSlitScene';
import CircularDiffractionScene from './CircularDiffractionScene';
import MichelsonScene from './MichelsonScene';
import FilmInterferenceScene from './FilmInterferenceScene';
import OpticsScene from './OpticsScene';
import FormulaLibrary from './FormulaKnowledge';
import { useEffect, useState } from 'react';
import { BookOpen, Box, Check, FlaskConical, Focus, X } from 'lucide-react';
import type { BuilderConversationContext } from './researchConversation';
import type { ResearchBuilderCopy } from './researchBuilderLink';
import { usePageNavigation } from './navigation';
import { parseExperiment, type Experiment } from './model';
import './teaching.css';

export default function App() {
  const { route, workspaceRoutes, resumeWorkspace, navigate, backTo } = usePageNavigation();
  const [builderOpened, setBuilderOpened] = useState(route.area === 'builder');
  const [builderConversation, setBuilderConversation] = useState<BuilderConversationContext | null>(null);
  useEffect(() => { if (route.area === 'builder') setBuilderOpened(true); }, [route.area]);
  const surface = route.area === 'formulas' ? 'formulas' : route.area === 'builder' || route.area === 'research' ? 'lab' : 'courses';
  const sceneRoute = surface === 'courses' ? route : workspaceRoutes.scenes;
  const formulaRoute = surface === 'formulas' ? route : workspaceRoutes.formulas;
  const scene = sceneRoute?.area === 'gaussian' ? 'gaussian' : null;
  const [toast, setToast] = useState<string | null>(null);
  const [sceneCopy, setSceneCopy] = useState<{id:string;experiment:Experiment}|null>(null);
  const [researchCopy, setResearchCopy] = useState<ResearchBuilderCopy|null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const openDirectory = () => {navigate({area:'scenes'});setAssistantOpen(false);};
  const openGaussian = () => {navigate({area:'gaussian'});setAssistantOpen(false);};
  const openBuilder = () => {navigate({area:'builder'});setAssistantOpen(false);};
  const openResearch = () => {navigate({area:'research'});setAssistantOpen(false);};
  const copyScene = (next: Experiment) => {
    try {setSceneCopy({id:crypto.randomUUID(),experiment:parseExperiment(next)});openBuilder();}
    catch (error) {setToast(error instanceof Error ? error.message : '装置参数无效。');}
  };
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000); return () => clearTimeout(timer);
  }, [toast]);

  return <div className={`app-shell ${surface === 'courses' ? 'is-scenes-area' : 'is-optical-area'}${route.area === 'research' ? ' is-inquiry-area' : ''}`}>
    <header className="topbar">
      <a className="brand" href="#" onClick={event=>{event.preventDefault();openDirectory();}} aria-label="光学智研首页"><div className="brand-mark"><Focus size={26}/></div><div><strong>光学智研<span>OPTICS LAB</span></strong><small>让光学探索，从一个想法开始</small></div></a>
      <nav className="mode-switch" aria-label="工作区域">
        <button className={surface==='courses'?'active':''} onClick={() => resumeWorkspace('scenes')} aria-pressed={surface==='courses'}><BookOpen size={15}/>仿真场景库</button>
        <button className={surface==='formulas'?'active':''} onClick={() => resumeWorkspace('formulas')} aria-pressed={surface==='formulas'}><BookOpen size={15}/>公式库</button>
        <button className={route.area==='builder'?'active':''} onClick={() => resumeWorkspace('builder')} aria-pressed={route.area==='builder'}><Box size={15}/>光路搭建</button>
        <button className={route.area==='research'?'active':''} onClick={() => resumeWorkspace('research')} aria-pressed={route.area==='research'}><FlaskConical size={15}/>实验探究工作区</button>
      </nav>
    </header>
    {sceneRoute && <SceneAssistantControls.Provider value={{open:assistantOpen,toggle:()=>setAssistantOpen(value=>!value)}}><div className="scenes-area" style={{display:surface === 'courses' ? undefined : 'none'}}>{scene === 'gaussian'
      ? <GaussianScene formulaId={sceneRoute.formula ?? null} onFormula={id => id ? navigate({area:'gaussian',formula:id},!!sceneRoute.formula) : backTo({area:'gaussian'})} assistantOpen={assistantOpen} onCloseAssistant={() => setAssistantOpen(false)} onDirectory={() => backTo({area:'scenes'})} onExplore={copyScene} />
      : sceneRoute.area === 'gaussian-focus' ? <GaussianFocusScene assistantOpen={assistantOpen} onCloseAssistant={() => setAssistantOpen(false)} onDirectory={() => backTo({area:'scenes'})} onExplore={copyScene}/>
      : sceneRoute.area === 'scene' && sceneRoute.sceneId === 'interference-1' ? <FilmInterferenceScene assistantOpen={assistantOpen} onCloseAssistant={() => setAssistantOpen(false)} onDirectory={() => backTo({area:'scenes'})}/>
      : sceneRoute.area === 'scene' && sceneRoute.sceneId === 'interference-2' ? <MichelsonScene assistantOpen={assistantOpen} onCloseAssistant={() => setAssistantOpen(false)} onDirectory={() => backTo({area:'scenes'})} onCopy={next=>{setResearchCopy({id:crypto.randomUUID(),experiment:next});openBuilder();}}/>
      : sceneRoute.area === 'scene' && sceneRoute.sceneId === 'spatial-spectrum-0' ? <FourierLensScene assistantOpen={assistantOpen} onCloseAssistant={() => setAssistantOpen(false)} onDirectory={() => backTo({area:'scenes'})} onCopy={next=>{setResearchCopy({id:crypto.randomUUID(),experiment:next});openBuilder();}}/>
      : sceneRoute.area === 'scene' && sceneRoute.sceneId === 'spatial-spectrum-1' ? <FourFScene assistantOpen={assistantOpen} onCloseAssistant={() => setAssistantOpen(false)} onDirectory={() => backTo({area:'scenes'})} onCopy={next=>{setResearchCopy({id:crypto.randomUUID(),experiment:next});openBuilder();}}/>
      : sceneRoute.area === 'scene' && sceneRoute.sceneId === 'diffraction-1' ? <CircularDiffractionScene assistantOpen={assistantOpen} onCloseAssistant={() => setAssistantOpen(false)} onDirectory={() => backTo({area:'scenes'})} onCopy={next=>{setResearchCopy({id:crypto.randomUUID(),experiment:next});openBuilder();}}/>
      : sceneRoute.area === 'scene' && sceneRoute.sceneId === 'diffraction-0' ? <SingleSlitScene assistantOpen={assistantOpen} onCloseAssistant={() => setAssistantOpen(false)} onDirectory={() => backTo({area:'scenes'})} onCopy={next=>{setResearchCopy({id:crypto.randomUUID(),experiment:next});openBuilder();}}/>
      : sceneRoute.area === 'scene' && sceneRoute.sceneId === 'interference-0' ? <YoungDoubleSlitScene assistantOpen={assistantOpen} onCloseAssistant={() => setAssistantOpen(false)} onDirectory={() => backTo({area:'scenes'})}/>
      : sceneRoute.area === 'scene' && sceneRoute.sceneId === 'polarization-2' ? <PolarizationRefractionScene assistantOpen={assistantOpen} onCloseAssistant={() => setAssistantOpen(false)} onDirectory={() => backTo({area:'scenes'})}/>
      : sceneRoute.area === 'scene' && sceneRoute.sceneId === 'polarization-1' ? <WaveplateScene assistantOpen={assistantOpen} onCloseAssistant={() => setAssistantOpen(false)} onDirectory={() => backTo({area:'scenes'})} onCopy={next=>{setResearchCopy({id:crypto.randomUUID(),experiment:next});openBuilder();}}/>
      : sceneRoute.area === 'scene' && sceneRoute.sceneId === 'polarization-0' ? <MalusScene assistantOpen={assistantOpen} onCloseAssistant={() => setAssistantOpen(false)} onDirectory={() => backTo({area:'scenes'})} onCopy={next=>{setResearchCopy({id:crypto.randomUUID(),experiment:next});openBuilder();}}/>
      : sceneRoute.area === 'scene' && sceneRoute.sceneId === 'fiber-modes-1' ? <FiberCouplingScene assistantOpen={assistantOpen} onCloseAssistant={() => setAssistantOpen(false)} onDirectory={() => backTo({area:'scenes'})}/>
      : sceneRoute.area === 'scene' && sceneRoute.sceneId === 'fiber-modes-0' ? <FiberModesScene assistantOpen={assistantOpen} onCloseAssistant={() => setAssistantOpen(false)} onDirectory={() => backTo({area:'scenes'})}/>
      : sceneRoute.area === 'scene' && sceneRoute.sceneId === 'photometric-quantities-0' ? <IlluminationScene assistantOpen={assistantOpen} onCloseAssistant={() => setAssistantOpen(false)} onDirectory={() => backTo({area:'scenes'})}/>
      : sceneRoute.area === 'scene' && sceneRoute.sceneId === 'radiometric-quantities-0' ? <PointSourceScene assistantOpen={assistantOpen} onCloseAssistant={() => setAssistantOpen(false)} onDirectory={() => backTo({area:'scenes'})}/>
      : sceneRoute.area === 'scene' && sceneRoute.sceneId === 'wave-fields-1' ? <WaveSuperpositionScene assistantOpen={assistantOpen} onCloseAssistant={() => setAssistantOpen(false)} onDirectory={() => backTo({area:'scenes'})}/>
      : sceneRoute.area === 'scene' && sceneRoute.sceneId === 'laser-gain-0' ? <LaserGainScene assistantOpen={assistantOpen} onCloseAssistant={() => setAssistantOpen(false)} onDirectory={() => backTo({area:'scenes'})}/>
      : sceneRoute.area === 'scene' && sceneRoute.sceneId === 'resonators-0' ? <ResonatorScene assistantOpen={assistantOpen} onCloseAssistant={() => setAssistantOpen(false)} onDirectory={() => backTo({area:'scenes'})}/>
      : sceneRoute.area === 'scene' && sceneRoute.sceneId === 'beam-transformation-1' ? <GaussianExpanderScene assistantOpen={assistantOpen} onCloseAssistant={() => setAssistantOpen(false)} onDirectory={() => backTo({area:'scenes'})} onExplore={copyScene}/>
      : sceneRoute.area === 'scene' && sceneRoute.sceneId ? <OpticsScene key={sceneRoute.sceneId} sceneId={sceneRoute.sceneId} onCopy={next=>{setResearchCopy({id:crypto.randomUUID(),experiment:next});openBuilder();}} assistantOpen={assistantOpen} onCloseAssistant={()=>setAssistantOpen(false)} onDirectory={()=>backTo({area:'scenes'})}/> : <CourseCenter route={sceneRoute} onNavigate={navigate} onOpenGaussian={openGaussian} />}</div></SceneAssistantControls.Provider>}
    {formulaRoute && <div style={{display:surface === 'formulas' ? 'contents' : 'none'}}><FormulaLibrary route={formulaRoute} onNavigate={navigate} onBack={backTo} onOpenGaussian={openGaussian} /></div>}
    {(builderOpened || route.area === 'builder') && <div style={{display:route.area === 'builder'?'contents':'none'}}><BuilderWorkspace visible={route.area === 'builder'} onConversation={setBuilderConversation} sceneCopy={sceneCopy} onCopyConsumed={()=>setSceneCopy(null)} researchCopy={researchCopy} onResearchCopyConsumed={()=>setResearchCopy(null)} onResearch={openResearch} onScenes={openDirectory}/></div>}
    <div style={{display: route.area === 'research' ? 'contents' : 'none'}}><ResearchWorkspace builderContext={builderConversation} inBuilder={route.area === 'builder'} visible={route.area === 'research'} onOpenBuilder={(input,origin,guide)=>{if(input)setResearchCopy({id:crypto.randomUUID(),experiment:input,...(origin?{origin}:{}),...(guide?{guide}:{})});openBuilder();}}/></div>
    {toast && <div className="toast" role="status"><Check size={17}/><span>{toast}</span><button aria-label="关闭通知" onClick={()=>setToast(null)}><X size={14}/></button></div>}
  </div>;
}
