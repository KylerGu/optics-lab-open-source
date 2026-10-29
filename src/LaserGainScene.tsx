import SceneAssistantToggle from './SceneAssistantToggle';
import { useCallback, useEffect, useReducer, useRef, useState, type CSSProperties } from 'react';
import { BookOpen, ChevronLeft, Maximize, PanelLeftClose, PanelLeftOpen, Redo2, RotateCcw, ScanLine, Settings2, Undo2, X } from 'lucide-react';
import { DEFAULT_GAIN, GAIN_DRAFT_KEY, GAIN_FIELDS, gainHistory, laserGain, parseGain, type GainHistory, type LaserGainParameters, gainTarget } from './laserGain';
import AssistantPanel from './AssistantPanel';
import type { SceneState } from './sceneRuntime';
import LaserGainFormulaSheet from './LaserGainFormulaSheet';
import LaserGainPlot, { GAIN_LAYERS, DEFAULT_GAIN_LAYERS, type GainLayer, type GainTab } from './LaserGainPlot';
import { useScenePanelWidth } from './useScenePanelWidth';
import './gaussian-scene.css';
import './gaussian-focus.css';
import './laser-gain-scene.css';

const fmt = (v: number, digits = 4) => !Number.isFinite(v) ? '∞' : (Math.abs(v) >= 1e6 || Math.abs(v) > 0 && Math.abs(v) < .0001) ? v.toExponential(3) : Math.abs(v) > 0 && Math.abs(v) < .01 ? Number(v.toPrecision(4)).toString() : Number(v.toFixed(digits)).toString();
type Field = keyof LaserGainParameters;
function readGain() {
  try { const stored = localStorage.getItem(GAIN_DRAFT_KEY); if (stored) return parseGain(JSON.parse(stored)); } catch { /* Preserve malformed saved data until a valid edit. */ }
  return { ...DEFAULT_GAIN };
}

function QuantityLabel({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className="gain-quantity-label" title={active ? '点击隐藏图中标注' : '点击显示图中标注'} aria-label={label} aria-pressed={active} onClick={onClick}>{children}</button>;
}
function Parameter({ field, value, start, finish, change, marked, toggle }: { field: typeof GAIN_FIELDS[number]; value: number; start: () => void; finish: () => void; change: (value: number) => void; marked: boolean; toggle?: () => void }) {
  const [draft, setDraft] = useState(String(value)), [error, setError] = useState(false);
  useEffect(() => { setDraft(String(value)); setError(false); }, [value]);
  const submit = () => {
    const n = Number(draft);
    if (!draft.trim() || !Number.isFinite(n) || n < field.min || n > field.max) { setError(true); return; }
    setError(false); start(); change(n); finish();
  };
  const fraction = (value - field.min) / (field.max - field.min);
  return <div className={`gs-parameter gs-tone-${field.tone}`}>
    <div className="gain-parameter-line">{toggle ? <QuantityLabel label={field.label} active={marked} onClick={toggle}>{field.label}<i className="gs-quantity-symbol">{field.symbol}</i></QuantityLabel> : <span className="gain-quantity-text">{field.label}<i className="gs-quantity-symbol">{field.symbol}</i></span>}<div className="gs-number"><input aria-label={field.label} aria-invalid={error} type="number" min={field.min} max={field.max} step={field.step} value={draft} onChange={e => { setDraft(e.target.value); setError(false); }} onBlur={submit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} /><span>{field.unit}</span></div></div>
    <input type="range" aria-label={`${field.label}滑杆`} min={field.min} max={field.max} step={field.step} value={value}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); start(); }} onChange={e => { start(); const n = Number(e.target.value); change(n); }}
      onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onBlur={finish} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) start(); }} onKeyUp={finish}
      style={{ '--range-fill': `${fraction * 100}%` } as CSSProperties} />
    {error && <small className="gs-error" role="alert">请输入 {field.min}–{field.max} {field.unit}。</small>}
  </div>;
}

export default function LaserGainScene({ onDirectory, assistantOpen, onCloseAssistant }: { onDirectory: () => void; assistantOpen: boolean; onCloseAssistant: () => void }) {
  const [initial] = useState(readGain);
  const [history, dispatch] = useReducer(gainHistory, { past: [], present: initial, future: [] } as GainHistory);
  const [preview, setPreview] = useState<LaserGainParameters | null>(null);
  const p = preview ?? history.present;
  const latest = useRef(p); latest.current = p;
  const pending = useRef<LaserGainParameters | null>(null), gesture = useRef(false), raf = useRef<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(true), [resultsOpen, setResultsOpen] = useState(true), [formulaOpen, setFormulaOpen] = useState(false);
  const [annotations, setAnnotations] = useState<GainLayer[]>(() => { try { const a = JSON.parse(localStorage.getItem('optics-gain-annotations:v1') ?? 'null'); if (Array.isArray(a)) return a.filter((k): k is GainLayer => GAIN_LAYERS.includes(k)); } catch { /* Use defaults. */ } return [...DEFAULT_GAIN_LAYERS]; });
  const annotated = (key: GainLayer) => annotations.includes(key);
  const toggleAnnotation = (key: GainLayer) => setAnnotations(layers => layers.includes(key) ? layers.filter(k => k !== key) : [...layers, key]);
  const quantityLabel = (key: GainLayer, label: string, symbol?: string) => <QuantityLabel label={label} active={annotated(key)} onClick={() => toggleAnnotation(key)}>{label}{symbol && <i className="gs-quantity-symbol">{symbol}</i>}</QuantityLabel>;
  useEffect(() => { try { localStorage.setItem('optics-gain-annotations:v1', JSON.stringify(annotations)); } catch { /* Labels remain usable without storage. */ } }, [annotations]);
  const [tab, setTab] = useState<GainTab>('output'), [resetView, setResetView] = useState(0);
  const [notice, setNotice] = useState(''), [saveFailed, setSaveFailed] = useState(false);
  const root = useRef<HTMLElement>(null), workspace = useRef<HTMLDivElement>(null);
  const layout = useScenePanelWidth(workspace, resultsOpen, panelOpen,{onLeftClose:()=>setPanelOpen(false),onRightClose:()=>setResultsOpen(false)});
  const start = useCallback(() => { gesture.current = true; }, []);
  const change = useCallback((field: Field, value: number) => {
    const next = { ...latest.current, [field]: value };
    latest.current = next; pending.current = next;
    if (raf.current === null) raf.current = requestAnimationFrame(() => { raf.current = null; setPreview(pending.current); });
  }, []);
  const finish = useCallback(() => {
    if (!gesture.current) return;
    gesture.current = false;
    if (raf.current !== null) { cancelAnimationFrame(raf.current); raf.current = null; }
    if (pending.current) dispatch({ type: 'commit', parameters: pending.current });
    pending.current = null; setPreview(null);
  }, []);
  useEffect(() => () => { if (raf.current !== null) cancelAnimationFrame(raf.current); }, []);
  useEffect(() => { try { localStorage.setItem(GAIN_DRAFT_KEY, JSON.stringify(history.present)); setSaveFailed(false); } catch { setSaveFailed(true); } }, [history.present]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as Element)?.closest('input,textarea,select,[contenteditable=true]') || document.querySelector('dialog[open]')) return;
      if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) { e.preventDefault(); finish(); dispatch({ type: e.key.toLowerCase() === 'y' || e.shiftKey ? 'redo' : 'undo' }); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [finish]);
  const b = laserGain(p);
  const applyAssistant = (state: SceneState) => {
    if (state.sceneId !== 'laser-gain-0' || gesture.current || document.activeElement?.matches('.laser-gain-scene .gs-parameter input')) return false;
    try { dispatch({ type: 'commit', parameters: parseGain(state.parameters) }); return true; } catch { return false; }
  };
  const restoreAssistant = (before: SceneState, after: SceneState) => {
    if (gesture.current || JSON.stringify(parseGain(after.parameters)) !== JSON.stringify(latest.current)) return false;
    const previous = history.past.at(-1);
    if (previous && GAIN_FIELDS.every(f => previous[f.key] === before.parameters[f.key])) { dispatch({ type: 'undo' }); return true; }
    return applyAssistant(before);
  };
  const reading = (label: string, value: number | null, unit: string, key: GainLayer | undefined, symbol?: string) => <div className="gs-primary-reading"><small>{key && value !== null ? quantityLabel(key, label, symbol) : <>{label}{symbol && <i className="gs-quantity-symbol">{symbol}</i>}</>}</small><strong data-testid={`gain-reading-${key ?? label}`}>{value === null ? '—' : fmt(value)}{unit && value !== null && <span>{unit}</span>}</strong></div>;
  const target = (above: boolean) => { finish(); const gain = gainTarget(latest.current, above); if (gain !== null) dispatch({ type: 'commit', parameters: { ...latest.current, smallSignalGain: gain } }); };
  const markable = (field: keyof LaserGainParameters) => field === 'lengthMm' || field === 'smallSignalGain' && (tab === 'saturation' || b.outputIntensity !== null) || field === 'probeIntensity' && tab === 'saturation';
  return <section ref={root} className={`gaussian-scene gaussian-focus-scene laser-gain-scene ${layout.resizing ? 'gs-panel-resizing' : ''}`} aria-label="激光阈值与增益场景">
    <div className="gs-heading"><div className="gs-title"><button className="icon-button" aria-label="返回仿真场景库" onClick={onDirectory}><ChevronLeft size={20}/></button><h1>激光阈值与增益</h1></div><div className="gs-heading-actions"><SceneAssistantToggle/><button className="outline-button" aria-haspopup="dialog" aria-expanded={formulaOpen} onClick={() => { finish(); setFormulaOpen(true); }}><BookOpen size={15}/>相关公式</button><button className="icon-button" aria-label="全屏查看场景" onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : root.current?.requestFullscreen())?.catch(() => setNotice('浏览器未开启全屏。'))}><Maximize size={18}/></button></div></div>
    <div className="gs-workspace" ref={workspace}>
      {panelOpen && <><aside className="gs-sidebar" style={{ width: layout.width }} aria-label="增益参数"><div className="gs-sidebar-title"><h2><Settings2 size={16}/>参数调节</h2><button className="icon-button" aria-label="收起左侧参数" onClick={() => setPanelOpen(false)}><PanelLeftClose size={17}/></button></div><div className="gs-sidebar-scroll">
        {[{ title: '增益介质', keys: ['lengthMm', 'smallSignalGain', 'lossPerM'] }, { title: '腔镜', keys: ['firstReflectivityPct', 'secondReflectivityPct'] }, ...(tab === 'saturation' ? [{ title: '饱和试算', keys: ['probeIntensity'] }] : [])].map(section => <section key={section.title}><h3>{section.title}</h3>{GAIN_FIELDS.filter(f => section.keys.includes(f.key)).map(f => <Parameter key={f.key} field={f} value={p[f.key]} start={start} finish={finish} change={n => change(f.key, n)} marked={annotated(f.key as GainLayer)} toggle={markable(f.key) ? () => toggleAnnotation(f.key as GainLayer) : undefined}/>)}{section.keys.includes('smallSignalGain') && <div className="gain-targets"><button className="text-button" disabled={gainTarget(p) === null || b.atThreshold} title={b.lossless ? '理想无损模型无法确定有限稳态' : b.thresholdGain > 50 ? '阈值超出增益可调范围' : '只调整小信号增益到阈值'} onClick={() => target(false)}>调到阈值</button><button className="text-button" disabled={gainTarget(p, true) === null} title="只调整小信号增益到阈值的1.2倍" onClick={() => target(true)}>调到阈值以上</button></div>}</section>)}
      </div><div className="gs-sidebar-footer"><button className="text-button" onClick={() => { finish(); dispatch({ type: 'commit', parameters: DEFAULT_GAIN }); setResetView(n => n + 1); setAnnotations([...DEFAULT_GAIN_LAYERS]); }}><RotateCcw size={14}/>恢复默认</button><span>{saveFailed ? '本机保存不可用' : '已自动保存'}</span></div></aside><div className="gs-panel-resizer" {...layout.separator}/></>}
      <main className="gs-visual"><div className="gs-toolbar"><div className="gs-toolbar-left">{!panelOpen && <button className="icon-button" aria-label="展开左侧参数" onClick={() => setPanelOpen(true)}><PanelLeftOpen size={17}/></button>}<div className="gain-tabs" role="tablist" aria-label="选择增益视图"><button role="tab" aria-selected={tab === 'output'} onClick={() => { finish(); setTab('output'); }}>阈值与输出</button><button role="tab" aria-selected={tab === 'saturation'} onClick={() => { finish(); setTab('saturation'); }}>增益饱和</button></div></div><div className="gs-toolbar-right"><button className="icon-button" aria-label="撤销增益参数" disabled={!history.past.length} onClick={() => { finish(); dispatch({ type: 'undo' }); }}><Undo2 size={16}/></button><button className="icon-button" aria-label="重做增益参数" disabled={!history.future.length} onClick={() => { finish(); dispatch({ type: 'redo' }); }}><Redo2 size={16}/></button>{!resultsOpen && <button className="gs-spot-toggle" aria-label="展开增益结果" onClick={() => setResultsOpen(true)}><ScanLine size={15}/>结果</button>}</div></div>
        <div className="gain-cavity"><svg viewBox="0 0 700 108" role="img" aria-label="增益介质填满两镜之间的等效线性腔示意，箭头仅表示往返方向" data-testid="gain-cavity"><path d="M55 44H645" stroke="#bccbd9" strokeDasharray="4 5"/><rect x={70} y={26} width={560} height={36} rx={5} fill="#e8f3ef" stroke="#a8c8ba"/><path d="M70 13V76 M630 13V76" stroke="#638eb3" strokeWidth={4}/><path d="M99 37H602L595 32 M602 37L595 42 M602 51H99L106 46 M99 51L106 56" fill="none" stroke="#be945f" strokeWidth={1.6}/><text x={70} y={13} textAnchor="middle">M₁</text><text x={630} y={13} textAnchor="middle">M₂</text><text x={350} y={21} textAnchor="middle">增益介质</text>{annotated('lengthMm') && <g data-testid="gain-annotation-lengthMm"><path d="M70 83V93 M70 88H630 M630 83V93" fill="none" stroke="#638eb3"/><text x={350} y={104} textAnchor="middle">L = {fmt(p.lengthMm, 2)} mm</text></g>}</svg></div>
        <LaserGainPlot parameters={p} tab={tab} layers={annotations} resetView={resetView} start={start} change={change} finish={finish}/>
      </main>
      {resultsOpen && <><div className="gs-panel-resizer" {...layout.results.separator}/><aside className="gs-sidebar gfocus-results" style={{ width: layout.results.width }} aria-label="增益结果"><div className="gs-sidebar-title"><h2>阈值与增益结果</h2><button className="icon-button" aria-label="收起增益结果" onClick={() => setResultsOpen(false)}><X size={17}/></button></div><div className="gs-sidebar-scroll">
        <section className="gain-status"><p className={`gain-state ${b.above && !b.lossless ? 'is-above' : 'is-below'}`} data-testid="gain-status">{b.status}</p>{reading('阈值增益', b.thresholdGain, 'm⁻¹', 'thresholdGain', 'gₜₕ')}{reading('小信号往返倍率', b.roundTrip, '×', undefined, 'Q₀')}</section>
        <section className="gs-readouts gfocus-main-readouts">{reading('稳态相对光强', b.steadyIntensity, '', tab === 'saturation' && b.above && !b.lossless ? 'steadyIntensity' : undefined, 'I / Iₛ')}{reading('相对出射光强', b.outputIntensity, '', tab === 'output' ? 'outputIntensity' : undefined, 'Iₒᵤₜ / Iₛ')}{p.secondReflectivityPct === 100 && !b.lossless && <p className="gfocus-result-note">输出镜全反射</p>}{b.lossless && <p className="gfocus-result-note">无损模型不确定有限稳态光强</p>}</section>
        <section className="gain-secondary"><div><span>稳态增益 <i>g</i></span><strong data-testid="gain-steady-gain">{b.steadyGain === null ? '—' : fmt(b.steadyGain)}{b.steadyGain !== null && <small> m⁻¹</small>}</strong></div><div><span>增益余量 <i>g₀ − gₜₕ</i></span><strong data-testid="gain-margin">{fmt(b.margin)}<small> m⁻¹</small></strong></div>{tab === 'saturation' && <div><span>试算增益 <i>g(I)</i></span><strong data-testid="gain-probe-gain">{fmt(b.probeGain)}<small> m⁻¹</small></strong></div>}</section>
      </div></aside></>}
    </div><div className="gs-model-strip"><span>横纵比例不同</span></div>
    {formulaOpen && <LaserGainFormulaSheet parameters={p} onClose={() => setFormulaOpen(false)}/>}
    {assistantOpen && <aside className="gs-drawer gs-assistant" aria-label="场景AI助手"><button className="gs-assistant-close icon-button" aria-label="关闭场景AI助手" onClick={onCloseAssistant}><X size={18}/></button><AssistantPanel sceneState={{ version: 1, sceneId: 'laser-gain-0', parameters: { ...p } }} editing={gesture.current || preview !== null} onApplyScene={applyAssistant} onRestoreScene={restoreAssistant}/></aside>}
    {notice && <div className="gs-notice" role="status">{notice}<button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={15}/></button></div>}
  </section>;
}
