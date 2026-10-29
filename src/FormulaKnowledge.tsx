import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bookmark, BookOpen, Calculator, ChevronRight, Search, X } from 'lucide-react';
import { renderToString } from 'katex';
import 'katex/dist/katex.min.css';
import { DEFAULT_FORMULA_VALUES, FORMULA_TOPICS, formulaInCategory, type FormulaId, type FormulaTopic, type FormulaValues } from './formulaCatalog';
import './formula-knowledge.css';
import { routeHash, type PageRoute } from './navigation';
import { OpticsDirectory } from './OpticsDirectory';
import { opticsCategoryPath, inOpticsCategory } from './opticsOutline';
import { OPTICS_FORMULAS, OpticsKnowledgeCard } from './OpticsKnowledge';
import { calculatorValues, FORMULA_QUANTITIES, QUANTITY_INFO, solveForQuantity, type CalculatorValues, type FormulaQuantity } from './formulaSolver';
import { FORMULA_FAVORITES_CATEGORY, useFormulaFavorites } from './formulaFavorites';
import FormulaNumberInput from './FormulaNumberInput';
import { formatFormulaNumber } from './formulaNumbers';

function FavoriteButton({ title, saved, onToggle }: { title: string; saved: boolean; onToggle: () => void }) {
  const label = `${saved ? '取消收藏' : '收藏'}${title}`;
  return <button type="button" className={`fk-favorite ${saved ? 'is-saved' : ''}`} aria-label={label} aria-pressed={saved} title={label} onClick={onToggle}><Bookmark size={19} fill={saved ? 'currentColor' : 'none'} /></button>;
}

function FormulaPreview({ id, latex }: { id: string; latex: string }) {
  // Pick the main relation rather than intermediate definitions in multi-relation cards.
  const mainRelation: Record<string, number> = {
    'wave-field-sum': 2, 'young-path-difference': 2, 'young-intensity': 1,
    'michelson-path': 3, 'michelson-intensity': 1, 'single-slit-intensity': 1,
    'single-slit-width': 1, 'circular-intensity': 1, 'circular-diameter': 1, 'fourier-intensity': 2, 'four-f-output': 1,
    'crystal-separation': 1, 'newton-dark-radius': 1,
  };
  const relations = latex.split(/,\s*\\(?:qquad|quad)\s*|,\s*\\ |\\quad\s*/);
  const preview = id === 'fiber-coupling-efficiency'
    ? String.raw`\begin{aligned}\eta&=\left(\frac{2ww_f}{S}\right)^2\\&\cdot\exp\!\left(-\frac{2d^2}{S}-\frac{k^2w^2w_f^2\sin^2\theta}{2S}\right)\end{aligned}`
    : id === 'wave-average-intensity' ? String.raw`I_{\rm rel}=A^2`
    : id === 'newton-thickness' ? String.raw`t=t_0+R-\sqrt{R^2-r^2}`
    : relations[mainRelation[id] ?? 0] ?? latex;
  return <div className="fk-formula-preview"><span className="fk-typeset" dangerouslySetInnerHTML={{ __html: renderToString(preview, { displayMode: true, throwOnError: true, output: 'htmlAndMathml', trust: false }) }} /></div>;
}

function SymbolText({ text, svg = false }: { text: string; svg?: boolean }) {
  return <>{text.split('z_R').map((part, index) => <Fragment key={index}>{index > 0 && (svg ? <>z<tspan baselineShift="sub" fontSize="9">R</tspan></> : <>z<sub>R</sub></>)}{part}</Fragment>)}</>;
}

function FormulaExpression({ id }: { id: FormulaId }) {
  const topic = FORMULA_TOPICS.find(item => item.id === id)!;
  const html = renderToString(topic.latex, { displayMode: true, throwOnError: true, output: 'htmlAndMathml', trust: false });
  return <span className="fk-typeset" dangerouslySetInnerHTML={{ __html: html }} />;
}

function FormulaDiagram({ topic }: { topic: FormulaTopic }) {
  const uid = useId().replace(/:/g, '');
  const upper = Array.from({ length: 81 }, (_, i) => `${65 + i * 3.5},${145 - Math.hypot(1, i / 28) * 22}`).join(' ');
  const lower = Array.from({ length: 81 }, (_, i) => `${345 - i * 3.5},${145 + Math.hypot(1, (80 - i) / 28) * 22}`).join(' ');
  const dimension = (x1: number, y1: number, x2: number, y2: number, symbol: string, color = '#347ebc') => <g style={{ color }}><line className="fk-dimension" x1={x1} y1={y1} x2={x2} y2={y2} markerStart={`url(#${uid}-arrow)`} markerEnd={`url(#${uid}-arrow)`} /><text x={x1 === x2 ? x1 + 10 : (x1 + x2) / 2} y={x1 === x2 ? (y1 + y2) / 2 + 5 : y1 - 9} textAnchor={x1 === x2 ? 'start' : 'middle'} fill={color}><SymbolText text={symbol} svg /></text></g>;
  return <figure className="fk-figure"><svg viewBox="0 0 400 245" role="img" aria-label={`${topic.title}示意图`}>
    <defs><marker id={`${uid}-arrow`} markerWidth="5" markerHeight="5" refX="5" refY="2.5" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0 0 L5 2.5 L0 5" fill="context-stroke" /></marker></defs>
    {topic.id === 'curvature' ? <>
      <line className="fk-axis" x1="50" x2="354" y1="195" y2="195" /><line className="fk-axis" x1="50" x2="50" y1="36" y2="195" />
      <text x="47" y="23"><SymbolText text="R / z_R" svg /></text><text x="352" y="221" textAnchor="end"><SymbolText text="d / z_R →" svg /></text>
      <polyline className="fk-curve" points={Array.from({ length: 111 }, (_, i) => { const d = .16 + i * .034; return `${50 + d * 74},${195 - (d + 1 / d) * 23}`; }).join(' ')} />
      <line className="fk-guide" x1="124" x2="124" y1="149" y2="195" /><line className="fk-guide" x1="50" x2="124" y1="149" y2="149" />
      <circle cx="124" cy="149" r="4" fill="#347ebc" /><text x="133" y="135"><SymbolText text="最小值 2z_R" svg /></text><text x="124" y="213" textAnchor="middle">1</text><text x="40" y="153" textAnchor="end">2</text><text x="65" y="56">束腰处 R → ∞</text>
    </> : topic.id === 'intensity' ? <>
      <line className="fk-axis" x1="42" x2="354" y1="190" y2="190" /><line className="fk-axis" x1="42" x2="42" y1="38" y2="190" /><text x="42" y="23">I(r) / I(0)</text><text x="354" y="222" textAnchor="end">横向距离 r / w →</text>
      <polyline className="fk-curve" points={Array.from({ length: 101 }, (_, i) => `${42 + i * 3.1},${190 - Math.exp(-2 * (i / 100 * 2.5) ** 2) * 145}`).join(' ')} />
      <line className="fk-guide" x1="166" x2="166" y1="170.4" y2="190" /><line className="fk-guide" x1="42" x2="166" y1="170.4" y2="170.4" /><circle cx="166" cy="170.4" r="4" fill="#26836a" />
      <text x="155" y="151">r = w：约 13.5%</text><text x="166" y="212" textAnchor="middle">1</text><text x="33" y="50" textAnchor="end">1</text><text x="42" y="212" textAnchor="middle">0</text>
    </> : <>
      <line className="fk-axis" x1="40" x2="365" y1="145" y2="145" /><polygon points={`${upper} ${lower}`} fill="#dceaf8" /><polyline className="fk-curve" points={upper} /><polyline className="fk-curve" points={lower} />
      <line className="fk-guide" x1="65" x2="65" y1="81" y2="211" /><circle cx="65" cy="145" r="4" fill="#c16b37" /><text x="65" y="231" textAnchor="middle">束腰</text><text x="355" y="231" textAnchor="end">传播方向 →</text>
      {topic.id === 'radius' && <>
        {dimension(82, 145, 82, 123, 'w₀', '#c16b37')}
        <line className="fk-guide" x1="282" x2="282" y1="62" y2="211" />{dimension(282, 145, 282, 91.5, 'w(z)', '#26836a')}{dimension(65, 207, 282, 207, 'd')}
      </>}
      {topic.id === 'rayleigh' && <>
        <line className="fk-guide" x1="163" x2="163" y1="65" y2="211" />{dimension(65, 75, 163, 75, 'z_R')}{dimension(163, 145, 163, 113.9, '√2 w₀')}{dimension(82, 145, 82, 123, 'w₀', '#c16b37')}
      </>}
      {topic.id === 'divergence' && <>
        <line className="fk-asymptote" x1="65" x2="345" y1="145" y2="82.1" /><path d="M155 145 A90 90 0 0 0 152.8 125.3" fill="none" stroke="#8a5eac" strokeWidth="2" /><text x="171" y="132" fill="#8a5eac">θ</text><text x="263" y="71">远场展开方向</text>
      </>}
    </>}
  </svg><figcaption>{topic.diagramCaption}</figcaption></figure>;
}

function FormulaCalculator({ topic, initialValues, fromScene }: { topic: FormulaTopic; initialValues: FormulaValues; fromScene: boolean }) {
  const [fields, setFields] = useState(() => Object.fromEntries(Object.entries(calculatorValues(initialValues)).map(([k, v]) => [k, String(v)])) as Record<FormulaQuantity, string>);
  const [target, setTarget] = useState(FORMULA_QUANTITIES[topic.id][0]);
  const [edited, setEdited] = useState(false);
  let results: number[] = [], error = '', note: string | undefined;
  try {
    const values = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.trim() ? Number(v) : NaN])) as CalculatorValues;
    ({ values: results, note } = solveForQuantity(topic.id, target, values));
  } catch (e) { error = e instanceof Error ? e.message : '请填写有效的已知量。'; }
  const resultInfo = QUANTITY_INFO[target];
  const changeTarget = (next: FormulaQuantity) => {
    // Retain exact computed values as known inputs when reversing the equation.
    if (results.length === 1) setFields(current => ({ ...current, [target]: String(results[0]) }));
    setTarget(next);
  };
  return <section className="fk-calculator" aria-label={`${topic.title}求解器`}>
    <div className="fk-section-heading"><h3><Calculator size={16} />公式求解器</h3><span>{fromScene && !edited ? '已代入当前场景' : '独立计算'}</span></div>
    <label className="fk-solve-target"><span>求解物理量</span><select aria-label="求解物理量" value={target} onChange={e => changeTarget(e.target.value as FormulaQuantity)}>{FORMULA_QUANTITIES[topic.id].map(field => <option key={field} value={field}>{QUANTITY_INFO[field].label}</option>)}</select></label>
    <div className="fk-calculator-grid">{FORMULA_QUANTITIES[topic.id].filter(field => field !== target).map(field => { const info = QUANTITY_INFO[field]; return <label key={field}><span>{info.label}</span><div><FormulaNumberInput aria-label={`已知${info.label}`} min={0} max={field === 'intensityPercent' ? 100 : undefined} step="any" value={Number.isFinite(Number(fields[field])) ? fields[field] : ''} onChange={value => { setEdited(true); setFields(current => ({ ...current, [field]: value })); }} /><span>{info.unit}</span></div></label>; })}</div>
    <output className={`fk-calculator-result ${results.length > 1 ? 'fk-multiple-results' : ''}`} aria-live="polite"><span>{resultInfo.label}</span><div>{results.length ? results.map((result, index) => <strong key={index} data-testid="formula-calculator-result">{results.length > 1 && <small>解 {index + 1}：</small>}{formatFormulaNumber(result)}<small>{resultInfo.unit}</small></strong>) : <strong>—</strong>}</div></output>
    {error && <p className="fk-calculator-error" role="status">{error}</p>}
    {note && <p className="fk-calculator-note">{note}</p>}
    {topic.id === 'curvature' && results[0] === Infinity && <p className="fk-calculator-note">束腰处波前为平面，曲率半径趋于无穷大。</p>}
  </section>;
}

export function FormulaKnowledgeCard({ id, values = DEFAULT_FORMULA_VALUES, fromScene = false }: { id: FormulaId; values?: FormulaValues; fromScene?: boolean }) {
  const topic = FORMULA_TOPICS.find(item => item.id === id)!;
  return <article className="fk-knowledge-card" aria-label={`${topic.title}知识卡`}>
    <header className="fk-card-heading"><h2>{topic.title}</h2><p>{topic.question}</p></header>
    <div className="fk-concept-grid"><div className="fk-concept"><div className="fk-expression"><span><FormulaExpression id={id} /></span></div><p>{topic.meaning}</p></div><FormulaDiagram topic={topic} /></div>
    <div className="fk-detail-grid">
      <section className="fk-symbols">
        <h3>变量与单位</h3>
        <dl>{topic.symbols.map(item => <div key={item.symbol}><dt><SymbolText text={item.symbol} /></dt><dd>{item.meaning}<small>{item.unit}</small></dd></div>)}</dl>
        <h3>适用条件</h3><p>{topic.conditions}</p>
        <h3>实际应用</h3><p>{topic.application}</p>
      </section>
      <FormulaCalculator key={id} topic={topic} initialValues={values} fromScene={fromScene} />
    </div>
    <footer className="fk-card-footer"><a href="https://physicslabs.colorado.edu/courses/phys-4430/lab-guides/gaussian-beams/week-3/" target="_blank" rel="noreferrer">公式参考 ↗</a></footer>
  </article>;
}

export function FormulaSheet({ initialId, values, onClose, onSelect }: { initialId: FormulaId; values: FormulaValues; onClose: () => void; onSelect: (id: FormulaId) => void }) {
  const selected = initialId;
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = dialog.current!; if (!el.open) el.showModal(); }, []);
  useEffect(() => { panel.current?.scrollTo({ top: 0 }); }, [selected]);
  return <dialog className="fk-sheet" ref={dialog} aria-label="高斯光束相关公式" onClose={onClose} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.currentTarget.close();
  }}><div className="fk-sheet-grip" /><header className="fk-sheet-heading"><h2><BookOpen size={18} />相关公式</h2><button className="icon-button" aria-label="关闭相关公式" onClick={() => dialog.current?.close()} autoFocus><X size={20} /></button></header>
    <div className="fk-sheet-body"><nav className="fk-topic-nav" aria-label="选择知识点">{FORMULA_TOPICS.map(topic => <button key={topic.id} className={selected === topic.id ? 'active' : ''} aria-pressed={selected === topic.id} onClick={() => onSelect(topic.id)}><span>{topic.title}</span><small><SymbolText text={topic.symbol} /></small></button>)}</nav><div className="fk-sheet-content" ref={panel} data-navigation-scroll="formula-sheet"><FormulaKnowledgeCard id={selected} values={values} fromScene /></div></div>
  </dialog>;
}

export default function FormulaLibrary({ onOpenGaussian, route, onNavigate, onBack }: { onOpenGaussian: () => void; route: PageRoute; onNavigate: (route: PageRoute, replace?: boolean) => void; onBack: (route: PageRoute) => void }) {
  const { favorites, toggleFavorite, saveFailed } = useFormulaFavorites();
  const selected = route.formula ?? route.knowledge ?? null;
  const generic = OPTICS_FORMULAS.find(f=>f.id===selected);
  const topics = [...FORMULA_TOPICS, ...OPTICS_FORMULAS.map(f=>({...f,symbol:f.fields.map(p=>p.key).join(' ')}))];
  const requestedCategory = route.category ?? 'all';
  const categoryId = requestedCategory === FORMULA_FAVORITES_CATEGORY || topics.some(topic => inOpticsCategory(topic.categoryId, requestedCategory)) ? requestedCategory : 'all';
  const query = route.query ?? '';
  const setQuery = (query: string) => onNavigate({ ...route, query }, true);
  const topicRoute = (id: string): PageRoute => ({ ...route, formula: FORMULA_TOPICS.some(f=>f.id===id) ? id as FormulaId : undefined, knowledge: OPTICS_FORMULAS.some(f=>f.id===id) ? id : undefined });
  const setSelected = (id: string | null) => id ? onNavigate(topicRoute(id)) : onBack({ ...route, formula: undefined, knowledge: undefined });
  const categoryTitle = categoryId === 'all' ? '全部公式' : categoryId === FORMULA_FAVORITES_CATEGORY ? '我的收藏' : opticsCategoryPath(categoryId).at(-1)!.title;
  const inCategory = (topic: { id: string; categoryId: string }, id: string) => id === FORMULA_FAVORITES_CATEGORY ? favorites.includes(topic.id) : inOpticsCategory(topic.categoryId, id);
  const count = (id: string) => topics.filter(topic => inCategory(topic, id)).length;
  const shown = topics.filter(topic => inCategory(topic, categoryId) && `${topic.title} ${topic.symbol} ${topic.question} ${topic.meaning} ${opticsCategoryPath(topic.categoryId).map(category => category.title).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
  const chooseCategory = (category: string) => onNavigate({ ...route, category, formula: undefined, knowledge: undefined });
  return <main className="fk-library" aria-label="公式库" data-navigation-scroll="formula-library">
    <header className="fk-library-heading"><div><h1>公式库</h1><p className="ui-page-description">从公式理解原理，再到场景中验证。</p></div>{!selected && <label className="fk-search"><Search size={18} /><input aria-label="搜索公式" value={query} placeholder="搜索公式或物理量" onChange={e => setQuery(e.target.value)} /></label>}</header>
    {saveFailed && <p className="fk-save-warning" role="status">收藏暂时无法保存，刷新后可能丢失。</p>}
    <div className="fk-library-layout"><OpticsDirectory kind="formulas" selected={categoryId} onSelect={chooseCategory} count={count} />
    <section className="fk-library-content" aria-label={selected ? '公式知识详情' : '分类公式列表'}>{selected ? <><div className="fk-library-breadcrumb"><button className="text-button" onClick={() => setSelected(null)}><ArrowLeft size={16} />返回公式列表</button><button className="outline-button" onClick={()=>generic ? onNavigate({area:'scene',sceneId:generic.sceneId}) : onOpenGaussian()}>打开相关场景<ArrowRight size={15} /></button></div><div className="fk-detail-card">{generic ? <OpticsKnowledgeCard key={selected} id={selected}/> : <FormulaKnowledgeCard key={selected} id={selected as FormulaId}/>}<FavoriteButton title={topics.find(topic => topic.id === selected)!.title} saved={favorites.includes(selected)} onToggle={() => toggleFavorite(selected)} /></div></> : <>
      <div className="fk-library-category"><span>{categoryTitle}</span><small>{shown.length} 张{categoryId === FORMULA_FAVORITES_CATEGORY ? '已收藏' : ''}公式卡片</small></div>
      <div className="fk-library-grid">{shown.map(topic => <article className="fk-library-item" key={topic.id} aria-label={`${topic.title}公式卡片`}>
        <a className="fk-card-link" href={routeHash(topicRoute(topic.id))} aria-label={`查看${topic.title}知识卡`} onClick={event => { if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); setSelected(topic.id); } }}>
          <h2>{topic.title}</h2><p>{topic.question}</p><FormulaPreview id={topic.id} latex={topic.latex} /><span className="fk-item-open">查看知识卡<ChevronRight size={16} /></span>
        </a>
        <FavoriteButton title={topic.title} saved={favorites.includes(topic.id)} onToggle={() => toggleFavorite(topic.id)} />
      </article>)}</div>
      {!shown.length && <div className="fk-empty">{categoryId === FORMULA_FAVORITES_CATEGORY ? <Bookmark size={27} /> : <BookOpen size={27} />}<p>{query.trim() ? '当前分类下没有匹配的公式。' : categoryId === FORMULA_FAVORITES_CATEGORY ? '还没有收藏公式，点击卡片右上角的书签即可收藏。' : '该分类暂未收录知识卡。'}</p>{query.trim() && <button className="text-button" onClick={() => setQuery('')}>清除搜索</button>}</div>}
    </>}</section></div>
  </main>;
}
