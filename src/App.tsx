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
import FormulaQuickPalette from './FormulaQuickPalette';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import ModelSettingsDialog, { ModelSettingsButton, ModelSettingsContext } from './ModelSettingsDialog';
import { BookOpen, Box, Calculator, Check, Columns2, FlaskConical, Focus, X } from 'lucide-react';
import type { BuilderConversationContext } from './researchConversation';
import type { ResearchBuilderCopy } from './researchBuilderLink';
import type { ResearchBuilderOrigin } from './researchBuilderIdentity';
import type { FormulaPresetRequest } from './researchFormulaLinks';
import type { ResearchVisualGuide } from './researchVisual';
import { usePageNavigation } from './navigation';
import { parseExperiment, type Experiment } from './model';
import type { SpatialExperiment } from './builderModel';
import {
  DEFAULT_SPLIT_RATIO,
  clampSplitRatio,
  readSplitRatio,
  readStudioViewMode,
  resolveLabLayout,
  saveSplitRatio,
  saveStudioViewMode,
  type StudioViewMode,
} from './studioSplit';
import './teaching.css';

export default function App() {
  const { route, workspaceRoutes, resumeWorkspace, navigate, backTo } = usePageNavigation();
  const surface = route.area === 'formulas' ? 'formulas' : route.area === 'builder' || route.area === 'research' ? 'lab' : 'courses';
  const [studioViewMode, setStudioViewMode] = useState<StudioViewMode>(readStudioViewMode);
  const [splitRatio, setSplitRatio] = useState<number>(readSplitRatio);
  const [isNarrowViewport, setIsNarrowViewport] = useState<boolean>(() => {
    try {
      return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(max-width: 960px)').matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(max-width: 960px)');
    const sync = () => setIsNarrowViewport(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  useEffect(() => {
    saveSplitRatio(splitRatio);
  }, [splitRatio]);
  const selectStudioViewMode = useCallback((mode: StudioViewMode) => {
    setStudioViewMode(mode);
    saveStudioViewMode(mode);
    if (isNarrowViewport) {
      if (mode === 'builder') navigate({ area: 'builder' });
      else if (mode === 'research') navigate({ area: 'research' });
    }
  }, [isNarrowViewport, navigate]);
  const effectiveViewMode: StudioViewMode =
    isNarrowViewport && studioViewMode === 'split'
      ? route.area === 'research'
        ? 'research'
        : 'builder'
      : studioViewMode;
  const labLayout = resolveLabLayout(route.area, effectiveViewMode);
  const labLayoutSplitRef = useRef(labLayout.split);
  labLayoutSplitRef.current = labLayout.split;

  const [builderOpened, setBuilderOpened] = useState(labLayout.showBuilder);
  const [builderConversation, setBuilderConversation] = useState<BuilderConversationContext | null>(null);
  useEffect(() => {
    if (labLayout.showBuilder) setBuilderOpened(true);
  }, [labLayout.showBuilder]);

  const sceneRoute = surface === 'courses' ? route : workspaceRoutes.scenes;
  const formulaRoute = surface === 'formulas' ? route : workspaceRoutes.formulas;
  const scene = sceneRoute?.area === 'gaussian' ? 'gaussian' : null;
  const [toast, setToast] = useState<string | null>(null);
  const [sceneCopy, setSceneCopy] = useState<{id:string;experiment:Experiment}|null>(null);
  const [researchCopy, setResearchCopy] = useState<ResearchBuilderCopy|null>(null);
  const [builderReturnDraft, setBuilderReturnDraft] = useState<{id:string;text:string}|null>(null);
  const [formulaPreset, setFormulaPreset] = useState<FormulaPresetRequest|null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const splitShellRef = useRef<HTMLDivElement>(null);
  const splitDragRef = useRef<{ pointerId: number } | null>(null);
  const [isSplitDragging, setIsSplitDragging] = useState(false);

  const openModelSettings = useCallback(() => setSettingsOpen(true), []);
  const focusResearchPrompt = useCallback(() => {
    const prompt = document.getElementById('research-prompt') as HTMLTextAreaElement | null;
    if (!prompt) return;
    prompt.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    prompt.focus();
  }, []);
  const openDirectory = () => {navigate({area:'scenes'});setAssistantOpen(false);};
  const openGaussian = () => {navigate({area:'gaussian'});setAssistantOpen(false);};
  const openBuilder = () => {
    if (studioViewMode === 'research') {
      selectStudioViewMode(isNarrowViewport ? 'builder' : 'split');
    }
    navigate({area:'builder'});
    setAssistantOpen(false);
  };
  const openResearch = (handoffDraft?: string) => {
    if (handoffDraft) setBuilderReturnDraft({ id: crypto.randomUUID(), text: handoffDraft });
    setAssistantOpen(false);
    if (labLayoutSplitRef.current) {
      if (!handoffDraft) focusResearchPrompt();
      return;
    }
    if (studioViewMode === 'builder') {
      selectStudioViewMode('research');
    }
    navigate({area:'research'});
  };
  const handleOpenBuilderFromResearch = useCallback(
    (input?: SpatialExperiment, origin?: ResearchBuilderOrigin, guide?: ResearchVisualGuide) => {
      if (input) {
        setResearchCopy({
          id: crypto.randomUUID(),
          experiment: input,
          ...(origin ? { origin } : {}),
          ...(guide ? { guide } : {}),
        });
      }
      if (labLayoutSplitRef.current) {
        return;
      }
      if (studioViewMode === 'research') {
        selectStudioViewMode(isNarrowViewport ? 'builder' : 'split');
      }
      navigate({ area: 'builder' });
      setAssistantOpen(false);
    },
    [isNarrowViewport, navigate, selectStudioViewMode, studioViewMode],
  );
  const syncBuiltApparatus = useCallback((experiment: SpatialExperiment, origin?: ResearchBuilderOrigin) => {
    if (!labLayoutSplitRef.current) return;
    setResearchCopy({ id: crypto.randomUUID(), experiment: structuredClone(experiment), ...(origin ? { origin } : {}) });
  }, []);
  const openFormulaPreset = useCallback((preset: Omit<FormulaPresetRequest, 'id'>) => {
    const request: FormulaPresetRequest = { ...preset, id: crypto.randomUUID() };
    setFormulaPreset(request);
    setAssistantOpen(false);
    if (surface === 'lab') {
      setPaletteOpen(true);
      return;
    }
    navigate({ area: 'formulas', ...(preset.formulaId ? { formula: preset.formulaId } : {}), ...(preset.knowledgeId ? { knowledge: preset.knowledgeId } : {}) });
  }, [navigate, surface]);
  const copyScene = (next: Experiment) => {
    try {setSceneCopy({id:crypto.randomUUID(),experiment:parseExperiment(next)});openBuilder();}
    catch (error) {setToast(error instanceof Error ? error.message : '装置参数无效。');}
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        (event.key.toLowerCase() === 'f' || event.code === 'KeyF')
      ) {
        if (!paletteOpen && document.querySelector('dialog[open]')) return;
        event.preventDefault();
        setPaletteOpen(open => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [paletteOpen]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000); return () => clearTimeout(timer);
  }, [toast]);

  return <ModelSettingsContext.Provider value={openModelSettings}><div className={`app-shell ${surface === 'courses' ? 'is-scenes-area' : 'is-optical-area'}${route.area === 'research' ? ' is-inquiry-area' : ''}`}>
    <header className="topbar">
      <a className="brand" href="#" onClick={event=>{event.preventDefault();openDirectory();}} aria-label="光学智研首页"><div className="brand-mark"><Focus size={26}/></div><strong>光学智研</strong></a>
      <nav className="mode-switch" aria-label="工作区域">
        <button className={surface==='courses'?'active':''} onClick={() => resumeWorkspace('scenes')} aria-pressed={surface==='courses'}><BookOpen size={15}/>仿真场景库</button>
        <button className={surface==='formulas'?'active':''} onClick={() => resumeWorkspace('formulas')} aria-pressed={surface==='formulas'}><BookOpen size={15}/>公式库</button>
        <span className="mode-switch-divider is-split-option" aria-hidden="true"/>
        <button type="button" className={`is-split-option${surface==='lab'&&labLayout.split?' active':''}`} onClick={() => {selectStudioViewMode('split');if(surface!=='lab')resumeWorkspace('research');setAssistantOpen(false);}} aria-pressed={surface==='lab'&&labLayout.split}><Columns2 size={15}/>同屏工作台</button>
        <button className={surface==='lab'&&!labLayout.split&&labLayout.showBuilder?'active':''} onClick={() => {selectStudioViewMode('builder');navigate({area:'builder'});setAssistantOpen(false);}} aria-pressed={surface==='lab'&&!labLayout.split&&labLayout.showBuilder}><Box size={15}/>光路搭建</button>
        <button className={surface==='lab'&&!labLayout.split&&labLayout.showResearch?'active':''} onClick={() => {selectStudioViewMode('research');navigate({area:'research'});setAssistantOpen(false);}} aria-pressed={surface==='lab'&&!labLayout.split&&labLayout.showResearch}><FlaskConical size={15}/>实验探究工作区</button>
      </nav>
      <div className="topbar-right">
        <button
          type="button"
          className={`formula-quick-trigger${paletteOpen ? ' active' : ''}`}
          title="公式与物理计算速查 (Alt+F)"
          aria-keyshortcuts="Alt+F"
          aria-expanded={paletteOpen}
          onClick={() => setPaletteOpen(open => !open)}
        >
          <Calculator size={15} aria-hidden="true"/>
          <span>公式速查</span>
        </button>
        <ModelSettingsButton onClick={openModelSettings}/>
      </div>
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
    {formulaRoute && <div style={{display:surface === 'formulas' ? 'contents' : 'none'}}><FormulaLibrary route={formulaRoute} preset={formulaPreset} onNavigate={navigate} onBack={backTo} onOpenGaussian={openGaussian} /></div>}
    <div
      ref={splitShellRef}
      hidden={surface !== 'lab'}
      className={`studio-split-shell${labLayout.split ? ' is-split-active' : ''}${isSplitDragging ? ' is-resizing' : ''}`}
      style={labLayout.split ? ({ '--studio-split-ratio': splitRatio } as CSSProperties) : undefined}
    >
      <div className="studio-split-pane studio-split-builder" hidden={!labLayout.showBuilder}>
        {(builderOpened || labLayout.showBuilder) && (
          <BuilderWorkspace
            visible={labLayout.showBuilder}
            studioMode={labLayout.split}
            onConversation={setBuilderConversation}
            sceneCopy={sceneCopy}
            onCopyConsumed={() => setSceneCopy(null)}
            researchCopy={researchCopy}
            onResearchCopyConsumed={() => setResearchCopy(null)}
            onResearch={openResearch}
            onOpenFormula={openFormulaPreset}
            onScenes={openDirectory}
          />
        )}
      </div>
      {labLayout.split && (
        <div
          className="studio-split-resizer"
          role="separator"
          aria-label="调整三维光路与实验探究分栏比例"
          aria-orientation="vertical"
          aria-valuemin={28}
          aria-valuemax={68}
          aria-valuenow={Math.round(splitRatio * 100)}
          tabIndex={0}
          title="拖动调整左右分栏比例，双击恢复默认比例"
          onPointerDown={event => {
            if (event.button !== 0 || splitDragRef.current) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            splitDragRef.current = { pointerId: event.pointerId };
            setIsSplitDragging(true);
          }}
          onPointerMove={event => {
            const drag = splitDragRef.current;
            const shell = splitShellRef.current;
            if (!drag || drag.pointerId !== event.pointerId || !shell) return;
            const rect = shell.getBoundingClientRect();
            if (rect.width > 0) setSplitRatio(clampSplitRatio((rect.right - event.clientX) / rect.width));
          }}
          onPointerUp={event => {
            if (splitDragRef.current?.pointerId !== event.pointerId) return;
            splitDragRef.current = null;
            setIsSplitDragging(false);
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onPointerCancel={event => {
            if (splitDragRef.current?.pointerId !== event.pointerId) return;
            splitDragRef.current = null;
            setIsSplitDragging(false);
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onLostPointerCapture={() => {
            splitDragRef.current = null;
            setIsSplitDragging(false);
          }}
          onDoubleClick={() => setSplitRatio(DEFAULT_SPLIT_RATIO)}
          onKeyDown={event => {
            const step = event.shiftKey ? 0.05 : 0.02;
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              setSplitRatio(r => clampSplitRatio(r + step));
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              setSplitRatio(r => clampSplitRatio(r - step));
            } else if (event.key === 'Home') {
              event.preventDefault();
              setSplitRatio(clampSplitRatio(1));
            } else if (event.key === 'End') {
              event.preventDefault();
              setSplitRatio(clampSplitRatio(0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              setSplitRatio(DEFAULT_SPLIT_RATIO);
            }
          }}
        />
      )}
      <div className="studio-split-pane studio-split-research" hidden={!labLayout.showResearch}>
        <ResearchWorkspace
          builderContext={builderConversation}
          inBuilder={!labLayout.split && labLayout.showBuilder}
          studioSplit={labLayout.split}
          visible={labLayout.showResearch}
          builderReturnDraft={builderReturnDraft}
          onConsumeBuilderReturnDraft={() => setBuilderReturnDraft(null)}
          onOpenFormula={openFormulaPreset}
          onOpenBuilder={handleOpenBuilderFromResearch}
          onSyncBuiltApparatus={labLayout.split ? syncBuiltApparatus : undefined}
        />
      </div>
    </div>
    {toast && <div className="toast" role="status"><Check size={17}/><span>{toast}</span><button aria-label="关闭通知" onClick={()=>setToast(null)}><X size={14}/></button></div>}
  </div>
  <FormulaQuickPalette
    open={paletteOpen}
    preset={formulaPreset}
    onClose={() => setPaletteOpen(false)}
    onOpenFullLibrary={(formulaId, knowledgeId) => {
      setPaletteOpen(false);
      navigate({
        area: 'formulas',
        ...(formulaId ? { formula: formulaId } : {}),
        ...(knowledgeId ? { knowledge: knowledgeId } : {}),
      });
    }}
  />
  <ModelSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} /></ModelSettingsContext.Provider>;
}
