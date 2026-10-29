import SceneAssistantToggle from './SceneAssistantToggle';
import { useCallback, useEffect, useId, useReducer, useRef, useState, type PointerEvent as ReactPointerEvent, type CSSProperties } from 'react';
import { BookOpen, ChevronLeft, Copy, Maximize, Minus, PanelLeftClose, PanelLeftOpen, Plus, Redo2, RotateCcw, ScanLine, Settings2, Sparkles, Undo2, X } from 'lucide-react';
import AssistantPanel from './AssistantPanel';
import { FormulaSheet } from './FormulaKnowledge';
import type { FormulaId } from './formulaCatalog';
import { historyReducer, parseExperiment, type Experiment, type History } from './model';
import { GAUSSIAN_DRAFT_KEY, gaussianBeam, gaussianElements, makeGaussianScene } from './gaussianBeam';
import { experimentKey } from './simulation';
import { useScenePanelWidth } from './useScenePanelWidth';

const display = (value: number, digits = 3) => Number(value.toFixed(digits)).toString();
const displayCurvature = (value: number) => !Number.isFinite(value) ? '∞' : value >= 1e6 ? value.toExponential(3) : display(value);
const beamRegions = {
  near: { title: '近场束腰区', condition: <>d ≤ z<sub>R</sub></>, meaning: '光束较接近平行，能量集中在较小的光斑内。' },
  transition: { title: '过渡区', condition: <>z<sub>R</sub> &lt; d &lt; 3z<sub>R</sub></>, meaning: '光束逐渐展开，能量分布到更大的光斑上，中心光强降低。' },
  far: { title: '远场近似区', condition: <>d ≥ 3z<sub>R</sub></>, meaning: '光束近似按固定发散角展开，光斑半径随传播距离成比例增大。' },
};
type Field = 'wavelengthNm' | 'waistMm' | 'sourcePosition' | 'screenPosition';
type BeamView = { startMm: number; spanMm: number; radiusMm: number };

function frameBeam(experiment: Experiment): BeamView {
  const { laser, screen } = gaussianElements(experiment);
  const beam = gaussianBeam(laser, screen);
  // Reserve the complete parameter travel so a dragged point visibly moves,
  // instead of every screen movement being cancelled by a camera rescale.
  const endMm = Math.max(600 * 1.08, laser.positionMm + beam.rayleighMm * 1.3, screen.positionMm * 1.05);
  const startMm = -Math.max(600 * .54, beam.rayleighMm * 1.3);
  return { startMm, spanMm: endMm - startMm, radiusMm: Math.max(beam.radiusAt(startMm), beam.radiusAt(endMm)) * 1.24 };
}

function readScene() {
  try {
    const saved = localStorage.getItem(GAUSSIAN_DRAFT_KEY);
    if (saved) { const experiment = parseExperiment(JSON.parse(saved)); gaussianElements(experiment); return experiment; }
  } catch { /* A malformed scene never replaces the separate optical-bench draft. */ }
  return makeGaussianScene();
}

function LiveParameter({ label, symbol, tone, value, unit, min, max, step, logarithmic = false, onChange, onStart, onFinish, hint }: {
  label: string; symbol: string; value: number; unit: string; min: number; max: number; step: number; logarithmic?: boolean;
  tone?: string;
  onChange: (value: number) => void; onStart: () => void; onFinish: () => void; hint?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState(false);
  useEffect(() => { setDraft(String(value)); setError(false); }, [value]);
  const submit = () => {
    const parsed = Number(draft);
    if (!draft.trim() || !Number.isFinite(parsed) || parsed < min || parsed > max) { setError(true); setDraft(String(value)); return; }
    setError(false); onStart(); onChange(parsed); onFinish();
  };
  const rangeValue = logarithmic ? Math.log(value / min) / Math.log(max / min) * 1000 : value;
  return <div className={`gs-parameter ${tone ? `gs-tone-${tone}` : ''}`}>
    <label title={hint}><span>{label}<i className="gs-quantity-symbol">{symbol}</i></span><div className="gs-number"><input aria-label={label} type="number" min={min} max={max} step={step} value={draft} aria-invalid={error} onChange={event => { setDraft(event.target.value); setError(false); }} onBlur={submit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /><span>{unit}</span></div></label>
    <input aria-label={`${label}滑杆`} type="range" min={logarithmic ? 0 : min} max={logarithmic ? 1000 : max} step={logarithmic ? 1 : step} value={rangeValue}
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); onStart(); }}
      onChange={event => { onStart(); const raw = Number(event.target.value); onChange(logarithmic ? Number((min * (max / min) ** (raw / 1000)).toPrecision(5)) : raw); }}
      onPointerUp={onFinish} onPointerCancel={onFinish} onLostPointerCapture={onFinish} onBlur={onFinish}
      onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) onStart(); }} onKeyUp={onFinish}
      style={{ '--range-fill': `${Math.min(100, Math.max(0, logarithmic ? rangeValue / 10 : (value - min) / (max - min) * 100))}%` } as CSSProperties} />
    <div className="gs-range-caption"><span>{min} {unit}</span><span>{max} {unit}</span></div>
    {error && <small className="gs-error" role="alert">请输入 {min}–{max} {unit} 范围内的数值。</small>}
    {hint && <small className="gs-field-hint">{hint}</small>}
  </div>;
}

export default function GaussianScene({ assistantOpen, onCloseAssistant, onExplore, onDirectory, formulaId, onFormula }: {
  assistantOpen: boolean; onCloseAssistant: () => void; onExplore: (experiment: Experiment) => void; onDirectory: () => void; formulaId: FormulaId | null; onFormula: (id: FormulaId | null) => void;
}) {
  const [initial] = useState(readScene);
  const [history, dispatch] = useReducer(historyReducer, { past: [], present: initial, future: [] } as History);
  const [preview, setPreview] = useState<Experiment | null>(null);
  const experiment = preview ?? history.present;
  const latest = useRef(experiment); latest.current = experiment;
  const gesture = useRef(false);
  const pending = useRef<Experiment | null>(null);
  const frame = useRef<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [spotOpen, setSpotOpen] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [viewOffset, setViewOffset] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const root = useRef<HTMLElement>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const panelLayout = useScenePanelWidth(workspace, spotOpen, panelOpen, {leftKey:"optics-gaussian-panel-width:v1",onLeftClose:()=>setPanelOpen(false),onRightClose:()=>setSpotOpen(false)});
  const plot = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 800, height: 550 });
  const svgId = useId().replace(/:/g, '');

  const start = useCallback(() => { gesture.current = true; }, []);
  const queue = useCallback((next: Experiment) => {
    latest.current = next; pending.current = next;
    if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; setPreview(pending.current); });
  }, []);
  const finish = useCallback(() => {
    if (!gesture.current) return;
    gesture.current = false;
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
    if (pending.current) dispatch({ type: 'commit', experiment: pending.current });
    pending.current = null; setPreview(null);
  }, []);
  const change = (field: Field, value: number) => {
    const current = latest.current;
    queue({ ...current, elements: current.elements.map(item => {
      if (item.kind === 'laser') {
        if (field === 'sourcePosition') return { ...item, positionMm: value };
        if (field === 'wavelengthNm' || field === 'waistMm') return { ...item, [field]: value };
      }
      if (item.kind === 'screen' && field === 'screenPosition') return { ...item, positionMm: value };
      return item;
    }) });
  };
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  useEffect(() => {
    try { localStorage.setItem(GAUSSIAN_DRAFT_KEY, JSON.stringify(history.present)); setSaveFailed(false); }
    catch { setSaveFailed(true); }
  }, [history.present]);
  useEffect(() => {
    if (!plot.current) return;
    const observer = new ResizeObserver(entries => { const { width, height } = entries[0].contentRect; if (width > 0 && height > 0) setSize({ width, height }); });
    observer.observe(plot.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('input, textarea, select, [contenteditable=true]') || document.querySelector('dialog[open]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); finish(); dispatch({ type: event.shiftKey ? 'redo' : 'undo' }); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); finish(); dispatch({ type: 'redo' }); }
    };
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
  }, [finish]);

  const { laser, screen } = gaussianElements(experiment);
  const beam = gaussianBeam(laser, screen);
  const framing = frameBeam(experiment);
  const region = beamRegions[beam.region];
  const width = Math.max(300, size.width), height = Math.max(280, size.height);
  const margin = { left: 64, right: 30, top: width < 450 ? 124 : 106, bottom: 62 };
  const pw = width - margin.left - margin.right, ph = height - margin.top - margin.bottom;
  const viewSpan = framing.spanMm / zoom;
  const startMm = framing.startMm + (framing.spanMm - viewSpan) / 2 + viewOffset;
  const endMm = startMm + viewSpan;
  // Automatic framing includes both the sampling plane and one Rayleigh length.
  // Manual zoom remains available for inspecting a smaller part of the same plot.
  const maxRadius = Math.max(framing.radiusMm, beam.radiusAt(startMm) * 1.18, beam.radiusAt(endMm) * 1.18);
  const x = (position: number) => margin.left + (position - startMm) / viewSpan * pw;
  const y = (radius: number) => margin.top + ph / 2 - radius / maxRadius * ph / 2;
  const rayleighPosition = laser.positionMm + beam.rayleighMm;
  const beamStartMm = startMm;
  const samplePositions = [...Array.from({ length: 321 }, (_, index) => beamStartMm + (endMm - beamStartMm) * index / 320), laser.positionMm, rayleighPosition].filter(position => position >= beamStartMm && position <= endMm).sort((a, b) => a - b);
  const points = samplePositions.map(z => ({ z, r: beam.radiusAt(z) }));
  const upper = points.map(({ z, r }) => `${x(z).toFixed(2)},${y(r).toFixed(2)}`).join(' ');
  const lower = [...points].reverse().map(({ z, r }) => `${x(z).toFixed(2)},${y(-r).toFixed(2)}`).join(' ');
  const horizontalTicks = Array.from({ length: 7 }, (_, index) => startMm + viewSpan * index / 6);
  const sourceInView = laser.positionMm >= startMm && laser.positionMm <= endMm;
  const screenInView = screen.positionMm >= startMm && screen.positionMm <= endMm;
  const axisY = y(0), sourceX = x(laser.positionMm), screenX = x(screen.positionMm);
  const waistPixels = Math.abs(y(laser.waistMm) - axisY);
  const screenSeparation = Math.abs(screenX - sourceX);
  // This is the displayed angle after the chart's unequal axis scaling.
  // The physical theta remains the paraxial far-field angle in the readout.
  const slope = beam.divergenceMrad / 1000;
  const shownAngle = Math.atan(slope * ph / 2 / maxRadius / (pw / viewSpan));
  const angleRadius = Math.max(25, Math.min(94, (width - margin.right - sourceX) * .42));
  const angleEnd = { x: sourceX + angleRadius * Math.cos(shownAngle), y: axisY - angleRadius * Math.sin(shownAngle) };
  const rayleighEndX = Math.min(width - margin.right, x(rayleighPosition));
  const rayleighClipped = rayleighPosition > endMm;
  const screenDimensionX = screenX + (screenX > width - margin.right - 75 ? -22 : 22);
  const waistDimensionX = sourceX < margin.left + 75 ? sourceX + 24 : sourceX - 24;
  const changeZoom = (next: number, anchor = startMm + viewSpan / 2) => {
    const bounded = Math.min(16, Math.max(1, next));
    const ratio = (anchor - startMm) / viewSpan;
    setZoom(bounded); setViewOffset(bounded === 1 ? 0 : anchor - framing.spanMm / bounded * ratio - (framing.startMm + (framing.spanMm - framing.spanMm / bounded) / 2));
  };
  const drag = useRef<{ pointerId: number; field: Field | 'pan'; initialX: number; initialStart: number; offset: number; spanMm: number; startMm: number } | null>(null);
  const positionFor = (clientX: number) => {
    const box = svg.current!.getBoundingClientRect();
    return startMm + ((clientX - box.left) * width / box.width - margin.left) / pw * viewSpan;
  };
  const startDrag = (event: ReactPointerEvent<SVGElement>, field: Field) => {
    if (event.button !== 0) return;
    event.stopPropagation(); start();
    const currentPosition = field === 'sourcePosition' ? laser.positionMm : screen.positionMm;
    drag.current = { pointerId: event.pointerId, field, initialX: event.clientX, initialStart: viewOffset, offset: positionFor(event.clientX) - currentPosition, spanMm: viewSpan, startMm };
    svg.current?.setPointerCapture(event.pointerId);
  };
  const onMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.field === 'pan') { setViewOffset(active.initialStart - (event.clientX - active.initialX) / pw * active.spanMm); return; }
    const current = gaussianElements(latest.current);
    const low = active.field === 'sourcePosition' ? 0 : current.laser.positionMm + 1;
    const high = active.field === 'sourcePosition' ? current.screen.positionMm - 1 : 600;
    const box = svg.current!.getBoundingClientRect();
    const position = active.startMm + ((event.clientX - box.left) * width / box.width - margin.left) / pw * active.spanMm - active.offset;
    change(active.field, Number(Math.min(high, Math.max(low, position)).toFixed(1)));
  };
  const endDrag = () => { if (drag.current?.field !== 'pan') finish(); drag.current = null; };
  const applyAssistant = (next: Experiment) => {
    try { gaussianElements(next); finish(); dispatch({ type: 'commit', experiment: next }); return true; }
    catch (error) { setNotice(error instanceof Error ? error.message : '这个方案不适用于自由传播场景。'); return false; }
  };
  const restoreAssistant = (before: Experiment, after: Experiment) => {
    if (gesture.current || preview !== null || experimentKey(latest.current) !== experimentKey(after)) return false;
    try {
      gaussianElements(before);
      if (history.past.length && experimentKey(history.past.at(-1)!) === experimentKey(before)) dispatch({ type: 'undo' });
      else dispatch({ type: 'commit', experiment: before });
      return true;
    } catch { return false; }
  };
  const fullScreen = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await root.current?.requestFullscreen(); }
    catch { setNotice('浏览器未开启全屏，可以使用缩放按钮放大查看。'); }
  };
  const spotExtent = Math.max(2.5, beam.screenRadiusMm * 2.2);
  const spotRadiusPx = beam.screenRadiusMm / spotExtent * 100;

  return <section ref={root} className={`gaussian-scene ${panelOpen ? '' : 'gs-panel-collapsed'} ${panelLayout.resizing ? 'gs-panel-resizing' : ''}`} aria-label="高斯光束仿真场景">
    <div className="gs-heading"><div className="gs-title"><button className="icon-button" aria-label="返回仿真场景库" onClick={onDirectory}><ChevronLeft size={20} /></button><h1>高斯光束</h1></div><div className="gs-heading-actions"><SceneAssistantToggle/><button className="gs-copy-button" onClick={() => { finish(); onExplore(latest.current); }}><Copy size={16} />复制到光路搭建</button><button className="outline-button" onClick={() => { finish(); onFormula('radius'); }} aria-haspopup="dialog" aria-expanded={formulaId !== null}><BookOpen size={15} />相关公式</button><button className="icon-button" aria-label="全屏查看场景" onClick={() => void fullScreen()}><Maximize size={18} /></button></div></div>
    <div className="gs-workspace" ref={workspace}>
      {panelOpen && <><aside className="gs-sidebar" style={{ width: panelLayout.width }} aria-label="高斯光束参数与结果"><div className="gs-sidebar-title"><h2><Settings2 size={16} />参数调节</h2><button className="icon-button" aria-label="收起左侧参数" onClick={() => setPanelOpen(false)}><PanelLeftClose size={17} /></button></div>
        <div className="gs-sidebar-scroll"><section><h3>光源</h3>
          <LiveParameter label="波长" symbol="λ" tone="wavelength" value={laser.wavelengthNm} unit="nm" min={380} max={1100} step={1} onStart={start} onFinish={finish} onChange={value => change('wavelengthNm', value)} />
          <div className="gs-presets">{[405, 532, 633, 1064].map(value => <button key={value} className={laser.wavelengthNm === value ? 'selected' : ''} onClick={() => { start(); change('wavelengthNm', value); finish(); }}>{value} nm</button>)}</div>
          <LiveParameter label="束腰半径" symbol="w₀" tone="waist" value={laser.waistMm} unit="mm" min={0.01} max={20} step={0.001} logarithmic onStart={start} onFinish={finish} onChange={value => change('waistMm', value)} hint="w₀ 是束腰处从光轴到光束边界的距离，即半径，不是直径。" />
        </section><section><h3>传播与观察</h3>
          <LiveParameter label="束腰位置" symbol="z₀" tone="waist" value={laser.positionMm} unit="mm" min={0} max={Number((screen.positionMm - 1).toFixed(1))} step={0.1} onStart={start} onFinish={finish} onChange={value => change('sourcePosition', value)} hint="圆点只标出束腰中心的位置，光束仍有半径 w₀。" />
          <LiveParameter label="观察位置" symbol="z" tone="screen" value={screen.positionMm} unit="mm" min={Number((laser.positionMm + 1).toFixed(1))} max={600} step={0.1} onStart={start} onFinish={finish} onChange={value => change('screenPosition', value)} />
        </section><section className="gs-readouts" aria-label="实时计算结果"><h3>实时结果</h3>
          <div className="gs-primary-reading gs-tone-screen"><small>光斑半径 <i className="gs-quantity-symbol">w(z)</i></small><strong data-testid="gaussian-screen-radius">{display(beam.screenRadiusMm, 4)}<span>mm</span></strong></div>
          <dl><div className="gs-tone-rayleigh"><dt><span>瑞利长度 <i className="gs-quantity-symbol">z<sub>R</sub></i></span><button aria-label="瑞利长度解释" onClick={() => { finish(); onFormula('rayleigh'); }}>?</button></dt><dd data-testid="gaussian-rayleigh">{display(beam.rayleighMm)} <span>mm</span></dd></div><div className="gs-tone-angle"><dt title="θ 是远处光束扩展方向与光轴的夹角，不是整个光束上下两侧的总夹角。"><span>发散半角 <i className="gs-quantity-symbol">θ</i></span></dt><dd data-testid="gaussian-divergence">{display(beam.divergenceMrad)} <span>mrad</span></dd></div><div className="gs-tone-distance"><dt><span>距束腰 <i className="gs-quantity-symbol">d</i></span></dt><dd>{display(beam.distanceMm, 1)} <span>mm</span></dd></div><div className="gs-curvature"><dt title="R 描述波前的弯曲程度，数值越大，波前越平。"><span>波前曲率半径 <i className="gs-quantity-symbol">R(z)</i></span></dt><dd data-testid="gaussian-wavefront-radius">{displayCurvature(beam.screenWavefrontRadiusMm)} <span>mm</span></dd></div></dl>
        </section></div>
        <div className="gs-sidebar-footer"><button className="text-button" onClick={() => { finish(); const next = makeGaussianScene(); dispatch({ type: 'commit', experiment: next }); setZoom(1); setViewOffset(0); }}><RotateCcw size={14} />恢复默认</button><span>{saveFailed ? '本机保存不可用' : '已自动保存'}</span></div>
      </aside><div className="gs-panel-resizer" {...panelLayout.separator} /></>}
      <main className="gs-visual" aria-label="高斯光束可视化"><div className="gs-toolbar"><div className="gs-toolbar-left">
        {!panelOpen && <button className="icon-button" aria-label="展开左侧参数" onClick={() => setPanelOpen(true)}><PanelLeftOpen size={18} /></button>}
      </div><div className="gs-toolbar-right"><button className="icon-button" aria-label="撤销场景调参" disabled={!history.past.length} onClick={() => { finish(); dispatch({ type: 'undo' }); }}><Undo2 size={16} /></button><button className="icon-button" aria-label="重做场景调参" disabled={!history.future.length} onClick={() => { finish(); dispatch({ type: 'redo' }); }}><Redo2 size={16} /></button><button className={`gs-spot-toggle ${spotOpen ? 'active' : ''}`} onClick={() => setSpotOpen(value => !value)} aria-expanded={spotOpen}><ScanLine size={14} />光斑</button></div></div>
        <div className="gs-visual-body"><div className="gs-plot" ref={plot} onWheel={event => { if (!drag.current) changeZoom(zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), positionFor(event.clientX)); }}>
          <div className={`gs-region gs-region-${beam.region}`} role="note" aria-label="传播区域提示" data-testid="gaussian-region" data-region={beam.region}><strong>{region.title}（{region.condition}）</strong><span>{region.meaning}</span></div>
          <svg ref={svg} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="高斯光束传播图，横轴为位置，纵轴为横向距离，束腰中心和观察平面可拖动" data-view-start-mm={startMm} data-view-span-mm={viewSpan} onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
            onPointerDown={event => { if (event.button === 0 && zoom > 1) { drag.current = { pointerId: event.pointerId, field: 'pan', initialX: event.clientX, initialStart: viewOffset, offset: 0, spanMm: viewSpan, startMm }; event.currentTarget.setPointerCapture(event.pointerId); } }}>
            <defs><linearGradient id={`${svgId}-beam`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#87a8cc" stopOpacity=".12" /><stop offset=".5" stopColor="#87a8cc" stopOpacity=".27" /><stop offset="1" stopColor="#87a8cc" stopOpacity=".12" /></linearGradient><clipPath id={`${svgId}-clip`}><rect x={margin.left} y={margin.top} width={pw} height={ph} /></clipPath><marker id={`${svgId}-dimension`} markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0 0 L6 3 L0 6" fill="context-stroke" /></marker></defs>
            {horizontalTicks.map((tick, index) => <g key={index}><line className="gs-grid" x1={x(tick)} x2={x(tick)} y1={margin.top} y2={height - margin.bottom} /><text x={x(tick)} y={height - margin.bottom + 25} textAnchor="middle">{display(tick, 1)}</text></g>)}
            {[-1, -.5, 0, .5, 1].map(tick => <g key={tick}><line className={tick === 0 ? 'gs-axis' : 'gs-grid'} x1={margin.left} x2={width - margin.right} y1={y(tick * maxRadius)} y2={y(tick * maxRadius)} /><text x={margin.left - 12} y={y(tick * maxRadius) + 4} textAnchor="end">{display(tick * maxRadius, 3)}</text></g>)}
            <text className="gs-axis-label" x={margin.left} y={margin.top - 40}>横向距离 / mm</text><text className="gs-axis-label" x={width / 2} y={height - 14} textAnchor="middle">光轴位置 z / mm →</text>
            <g clipPath={`url(#${svgId}-clip)`}>
              <rect x={sourceX} y={margin.top} width={Math.max(0, x(Math.min(endMm, rayleighPosition)) - sourceX)} height={ph} fill="#d6e9fc" opacity=".32" />
              <polygon data-testid="gaussian-envelope" points={`${upper} ${lower}`} fill={`url(#${svgId}-beam)`} /><polyline points={upper} fill="none" stroke="#607fa7" strokeWidth="2.6" /><polyline points={lower} fill="none" stroke="#607fa7" strokeWidth="2.6" />
              {rayleighPosition <= endMm && <line x1={x(rayleighPosition)} x2={x(rayleighPosition)} y1={margin.top} y2={height - margin.bottom} stroke="#5d98cd" strokeDasharray="5 5" />}
            </g>
            {laser.positionMm >= startMm && laser.positionMm <= endMm && <g className="gs-drag-handle" data-testid="gaussian-source" role="slider" tabIndex={0} aria-label="图中束腰位置" aria-valuemin={0} aria-valuemax={screen.positionMm - 1} aria-valuenow={laser.positionMm} onPointerDown={event => startDrag(event, 'sourcePosition')} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); start(); change('sourcePosition', Math.max(0, Math.min(screen.positionMm - 1, laser.positionMm + (event.key === 'ArrowRight' ? 1 : -1)))); finish(); } }}>
              <rect x={sourceX - 14} y={margin.top} width={28} height={ph} fill="transparent" />
              <line x1={sourceX} x2={sourceX} y1={margin.top} y2={height - margin.bottom} stroke="#c16b37" strokeOpacity=".6" strokeDasharray="3 5" /><text x={sourceX - (screenSeparation < 48 ? 14 : 0)} y={margin.top - 14} textAnchor={screenSeparation < 48 ? 'end' : 'middle'} className="gs-annotation-symbol gs-waist-symbol">z₀</text>
              <circle data-testid="gaussian-waist-point" cx={sourceX} cy={axisY} r={5} fill="#c16b37" stroke="#fff" strokeWidth="2" />
            </g>}
            {screenInView && <g className="gs-drag-handle" data-testid="gaussian-screen" role="slider" tabIndex={0} aria-label="图中观察位置" aria-valuemin={laser.positionMm + 1} aria-valuemax={600} aria-valuenow={screen.positionMm} onPointerDown={event => startDrag(event, 'screenPosition')} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); start(); change('screenPosition', Math.max(laser.positionMm + 1, Math.min(600, screen.positionMm + (event.key === 'ArrowRight' ? 1 : -1)))); finish(); } }}>
              <rect x={screenX - 15} y={margin.top} width={30} height={ph} fill="transparent" /><line x1={screenX} x2={screenX} y1={margin.top} y2={height - margin.bottom} stroke="#26836a" strokeWidth="1.8" /><circle cx={screenX} cy={axisY} r={5} fill="#fff" stroke="#26836a" strokeWidth="2" /><text className="gs-annotation-symbol gs-screen-symbol" x={screenX + (screenSeparation < 48 ? 14 : 0)} y={margin.top - 14} textAnchor={screenSeparation < 48 ? 'start' : 'middle'}>z</text>
            </g>}
            <g className="gs-annotations" data-testid="gaussian-annotations" pointerEvents="none" clipPath={`url(#${svgId}-clip)`}>
              {sourceInView && width - margin.right - sourceX > 48 && <g className="gs-tone-angle" data-testid="annotation-divergence" data-theta-mrad={beam.divergenceMrad}>
                <line className="gs-asymptote" x1={sourceX} y1={axisY} x2={x(endMm)} y2={y(slope * (endMm - laser.positionMm))} />
                <path className="gs-angle-arc" d={`M${sourceX + angleRadius} ${axisY} A${angleRadius} ${angleRadius} 0 0 0 ${angleEnd.x} ${angleEnd.y}`} />
                <text className="gs-annotation-symbol" x={Math.min(width - margin.right - 14, sourceX + (angleRadius + 20) * Math.cos(shownAngle / 2))} y={axisY - (angleRadius + 20) * Math.sin(shownAngle / 2) - 7}>θ</text>
              </g>}
              {sourceInView && <g className="gs-tone-rayleigh" data-testid="annotation-rayleigh" data-length-mm={beam.rayleighMm}>
                <line className="gs-dimension" x1={sourceX} x2={rayleighEndX} y1={margin.top + 20} y2={margin.top + 20} markerStart={rayleighEndX - sourceX >= 12 ? `url(#${svgId}-dimension)` : undefined} markerEnd={!rayleighClipped && rayleighEndX - sourceX >= 12 ? `url(#${svgId}-dimension)` : undefined} />
                <line className="gs-dimension" x1={sourceX} x2={sourceX} y1={margin.top + 12} y2={margin.top + 28} />
                {!rayleighClipped ? <line className="gs-dimension" x1={rayleighEndX} x2={rayleighEndX} y1={margin.top + 12} y2={margin.top + 28} /> : <path className="gs-dimension" d={`M${rayleighEndX - 8} ${margin.top + 16} l8 4 l-8 4`} fill="none" />}
                <text className="gs-annotation-symbol" x={(sourceX + rayleighEndX) / 2} y={margin.top + 11} textAnchor="middle">z<tspan baselineShift="sub" fontSize="10">R</tspan>{rayleighClipped ? ' …' : ''}</text>
              </g>}
              {sourceInView && <g className="gs-tone-waist" data-testid="annotation-waist" data-radius-mm={laser.waistMm}>
                  <line className="gs-dimension" x1={sourceX} x2={waistDimensionX + (waistDimensionX > sourceX ? -4 : 4)} y1={y(laser.waistMm)} y2={y(laser.waistMm)} />
                  <line className="gs-dimension" x1={waistDimensionX} x2={waistDimensionX} y1={axisY} y2={y(laser.waistMm)} markerStart={waistPixels >= 12 ? `url(#${svgId}-dimension)` : undefined} markerEnd={waistPixels >= 12 ? `url(#${svgId}-dimension)` : undefined} />
                  <text className="gs-annotation-symbol" x={waistDimensionX + (waistDimensionX > sourceX ? 8 : -8)} y={(axisY + y(laser.waistMm)) / 2 + (waistPixels < 16 ? -14 : 5)} textAnchor={waistDimensionX > sourceX ? 'start' : 'end'}>w₀</text>
              </g>}
              {screenInView && <g className="gs-tone-screen" data-testid="annotation-screen-radius" data-radius-mm={beam.screenRadiusMm}>
                <line className="gs-dimension gs-screen-dimension" x1={screenX} x2={screenDimensionX} y1={y(beam.screenRadiusMm)} y2={y(beam.screenRadiusMm)} />
                <line className="gs-dimension gs-screen-dimension" x1={screenDimensionX} x2={screenDimensionX} y1={axisY} y2={y(beam.screenRadiusMm)} markerStart={`url(#${svgId}-dimension)`} markerEnd={`url(#${svgId}-dimension)`} />
                <text className="gs-annotation-symbol gs-screen-symbol" x={screenDimensionX + (screenDimensionX > screenX ? 9 : -9)} y={(axisY + y(beam.screenRadiusMm)) / 2 - (Math.abs(y(beam.screenRadiusMm) - axisY) < 20 ? 14 : -5)} textAnchor={screenDimensionX > screenX ? 'start' : 'end'}>w(z)</text>
              </g>}
              {sourceInView && screenInView && <g className="gs-tone-distance" data-testid="annotation-distance" data-length-mm={beam.distanceMm}>
                <line className="gs-dimension" x1={sourceX} x2={screenX} y1={margin.top + ph - 18} y2={margin.top + ph - 18} markerStart={screenSeparation >= 12 ? `url(#${svgId}-dimension)` : undefined} markerEnd={screenSeparation >= 12 ? `url(#${svgId}-dimension)` : undefined} />
                <text className="gs-annotation-symbol" x={(sourceX + screenX) / 2} y={margin.top + ph - 25} textAnchor="middle">d</text>
              </g>}
            </g>
          </svg>
        </div>
        {spotOpen && <><div className="gs-panel-resizer" {...panelLayout.results.separator}/><aside style={{width:panelLayout.results.width}} className="gs-spot" aria-label="观察平面的光斑"><div className="gs-spot-heading"><div><h2>观察平面</h2><p>z = {display(screen.positionMm, 1)} mm</p></div><button className="icon-button" aria-label="收起光斑" onClick={() => setSpotOpen(false)}><X size={15} /></button></div>
          <svg className="gs-spot-image" viewBox="0 0 230 230" role="img" aria-label="观察位置的二维高斯光斑，光强按当前平面峰值归一化">
            <defs><radialGradient id={`${svgId}-spot`}>{Array.from({ length: 49 }, (_, index) => <stop key={index} offset={index / 48} stopColor="#9cc8ff" stopOpacity={Math.exp(-2 * (index / 48 * 3) ** 2)} />)}</radialGradient></defs>
            <rect width="230" height="230" rx="12" fill="#10203a" /><line x1="15" x2="215" y1="115" y2="115" stroke="#c4d7ed" strokeOpacity=".2" /><line y1="15" y2="215" x1="115" x2="115" stroke="#c4d7ed" strokeOpacity=".2" />
            <circle data-testid="gaussian-spot" cx="115" cy="115" r={spotRadiusPx * 3} fill={`url(#${svgId}-spot)`} /><circle cx="115" cy="115" r={spotRadiusPx} fill="none" stroke="#c1ddff" strokeOpacity=".65" strokeDasharray="3 4" />
            <g className="gs-spot-annotations" data-testid="spot-annotations">
              <line x1="115" y1="115" x2={115 + spotRadiusPx} y2="115" /><line x1="115" x2="115" y1="111" y2="119" /><line x1={115 + spotRadiusPx} x2={115 + spotRadiusPx} y1="111" y2="119" />
              <text x={115 + spotRadiusPx / 2} y="105" textAnchor="middle">w(z)</text>
            </g>
            <text x="115" y="216" textAnchor="middle" fill="#aac3df" fontSize="10">横向范围 ±{display(spotExtent, 2)} mm</text>
          </svg>
          <div className="gs-spot-caption"><i /><span>虚线圈为 w(z)，圈上光强约为中心的 13.5%。</span></div>
          <div className="gs-profile"><div>光强截面<span>当前平面峰值 = 1</span></div><svg viewBox="0 0 230 110" role="img" aria-label="高斯光斑的横向相对光强曲线"><line x1="12" x2="218" y1="88" y2="88" stroke="#cdd9e8" /><line x1="115" x2="115" y1="15" y2="88" stroke="#dce5ef" strokeDasharray="3 4" /><polyline fill="none" stroke="#4c88db" strokeWidth="2" points={Array.from({ length: 121 }, (_, index) => { const offset = (index / 120 * 2 - 1) * spotExtent; return `${12 + index / 120 * 206},${88 - beam.relativeIntensityAt(offset) * 70}`; }).join(' ')} /><text x="12" y="105" textAnchor="start">−{display(spotExtent, 2)}</text><text x="115" y="105" textAnchor="middle">0</text><text x="218" y="105" textAnchor="end">{display(spotExtent, 2)} mm</text></svg></div>
        </aside></>}
        </div><div className="gs-visual-footer">
          <div className="gs-plot-controls"><button className="icon-button" aria-label="缩小传播图" disabled={zoom <= 1} onClick={() => changeZoom(zoom / 1.35)}><Minus size={16} /></button><span>{display(zoom, 2)}×</span><button className="icon-button" aria-label="放大传播图" disabled={zoom >= 16} onClick={() => changeZoom(zoom * 1.35)}><Plus size={16} /></button></div>
        </div>
      </main>
    </div>
    <div className="gs-model-strip"><span title="横向与纵向的 1 mm 在屏幕上显示为不同长度，便于看清光束；θ 弧线是示意，实际角度看计算数值。">横纵比例不同</span></div>
    {formulaId && <FormulaSheet initialId={formulaId} onSelect={onFormula} values={{ wavelengthNm: laser.wavelengthNm, waistMm: laser.waistMm, distanceMm: beam.distanceMm, radiusMm: beam.screenRadiusMm, offsetMm: beam.screenRadiusMm }} onClose={() => onFormula(null)} />}
    <aside hidden={!assistantOpen} className="gs-drawer gs-assistant" aria-label="场景AI助手"><button className="gs-assistant-close icon-button" aria-label="关闭场景AI助手" onClick={onCloseAssistant}><X size={18} /></button><AssistantPanel experiment={experiment} mode="teaching" scene="gaussian" editing={preview !== null} onApply={applyAssistant} onRestore={restoreAssistant} onDesign={() => setNotice('方案设计请在实验探究工作区查看。')} onStudy={() => setNotice('误差分析请在实验探究工作区查看。')} suggestion={null} /></aside>
    {notice && <div className="gs-notice" role="status"><Sparkles size={16} /><span>{notice}</span><button className="icon-button" aria-label="关闭场景提示" onClick={() => setNotice(null)}><X size={15} /></button></div>}
  </section>;
}
