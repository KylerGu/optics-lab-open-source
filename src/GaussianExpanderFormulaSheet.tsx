import { useEffect, useRef, useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import { renderToString } from 'katex';
import 'katex/dist/katex.min.css';
import './formula-knowledge.css';
import { EXPANDER_FIELDS, collimatedPosition, gaussianExpander, parseExpander, type ExpanderParameters } from './gaussianExpander';

const expression = (latex: string) => <span className="fk-typeset" dangerouslySetInnerHTML={{ __html: renderToString(latex, { displayMode: true, throwOnError: true, trust: false }) }}/>;
const topics = [
  { id: 'ideal', title: '扩束倍率与无焦镜距', question: '两镜焦距怎样决定扩束倍率？',
    relations: [String.raw`d=z_2-z_1=f_1+f_2`, String.raw`M=\left|\frac{f_2}{f_1}\right|,\qquad\theta'\approx\frac{\theta}{M}`],
    meaning: '伽利略式采用负焦距第一镜和正焦距第二镜，开普勒式采用两片正焦距镜。上式是平行输入的无焦设计关系；有限高斯光束的实际半径和波前还取决于入射束腰。实际倍率按第二镜处半径除以第一镜处半径计算。' },
  { id: 'gaussian', title: '双透镜高斯光束变换', question: '任意镜距下，光斑和发散角是多少？',
    relations: [String.raw`q_{1-}=z_1-z_0+i\frac{\pi w_0^2}{\lambda}`, String.raw`q_{1+}=\frac{1}{1/q_{1-}-1/f_1},\quad q_{2-}=q_{1+}+d`, String.raw`q_{2+}=\frac{1}{1/q_{2-}-1/f_2}`, String.raw`\frac1q=\frac1R-i\frac{\lambda}{\pi w^2},\quad\theta'=\frac{\lambda}{\pi w'_0}`],
    meaning: '复光束参数 q 同时记录光束宽度和波前弯曲。自由传播给 q 加上距离，薄透镜改变 1/q；连续经过两镜即可求出每段真实包络。观察面在第一镜前、两镜之间或第二镜后时，分别使用对应段的光束。θ′为远场发散半角，不是当前包络的局部斜率。' },
  { id: 'collimate', title: '准直镜距', question: '怎样移动第二镜，使其出射波前平直？',
    relations: [String.raw`q_{1+}=a+ib,\quad x=a+d`, String.raw`\operatorname{Re}(1/q_{2+})=0\ \Longrightarrow\ x^2-f_2x+b^2=0`, String.raw`d=\frac{f_2+\sqrt{f_2^2-4b^2}}2-a`],
    meaning: '“调到准直”只移动第二镜，使该镜后的波前为平面；选择较大出射束腰、较低发散角的解。判别式为负或位置超出可调范围时不应用。平波前仍有衍射发散，不等于处处严格平行。主界面的“近准直”表示第二镜后 100 mm 内半径变化小于 1%。' },
];

export default function GaussianExpanderFormulaSheet({ parameters, onClose }: { parameters: ExpanderParameters; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), content = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState('ideal'), [target, setTarget] = useState('expansion');
  const [values, setValues] = useState(() => Object.fromEntries(EXPANDER_FIELDS.map(f => [f.key, String(parameters[f.key])])));
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { content.current?.scrollTo({ top: 0 }); }, [selected]);
  const topic = topics.find(t => t.id === selected)!;
  let answer = '—', error = '';
  const unit = target === 'expansion' ? '×' : target === 'divergence' ? 'mrad' : 'mm';
  const label = target === 'expansion' ? '实际扩束倍率' : target === 'divergence' ? '出射发散半角' : target === 'observation' ? '观察光斑半径' : '准直第二镜位置';
  const knownFields = EXPANDER_FIELDS.filter(f => (target === 'observation' || f.key !== 'observationMm') && (target !== 'collimate' || f.key !== 'secondPositionMm'));
  try {
    if (knownFields.some(f => !values[f.key].trim())) throw new Error('请填写全部已知量。');
    const known = Object.fromEntries(knownFields.map(f => [f.key, Number(values[f.key])]));
    const p = parseExpander({ ...known, observationMm: target === 'observation' ? known.observationMm : 0,
      secondPositionMm: target === 'collimate' ? known.firstPositionMm + 1 : known.secondPositionMm }), b = gaussianExpander(p);
    const result = collimatedPosition(p);
    const number = target === 'expansion' ? b.expansion : target === 'divergence' ? b.divergenceMrad : target === 'observation' ? b.observationRadiusMm : result.positionMm;
    if (number === null) { answer = '无可用解'; error = result.reason; }
    else answer = Math.abs(number) > 0 && Math.abs(number) < .0001 ? number.toExponential(4) : Number(number.toFixed(6)).toString();
  } catch (e) { error = e instanceof Error ? e.message : '参数无效。'; }
  return <dialog ref={dialog} className="fk-sheet os-formula-sheet gfocus-formula-sheet" aria-label="激光扩束与准直相关公式" onClose={onClose} onClick={e => { if (e.target !== e.currentTarget) return; const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.currentTarget.close(); }}>
    <div className="fk-sheet-grip"/><header className="fk-sheet-heading"><h2><BookOpen size={18}/>相关公式</h2><button className="icon-button" aria-label="关闭相关公式" autoFocus onClick={() => dialog.current?.close()}><X size={20}/></button></header>
    <div className="fk-sheet-body"><nav className="fk-topic-nav" aria-label="选择知识点">{topics.map(t => <button key={t.id} className={selected === t.id ? 'active' : ''} aria-pressed={selected === t.id} onClick={() => setSelected(t.id)}><span>{t.title}</span><small>{t.id === 'ideal' ? 'M · f₁ · f₂' : t.id === 'gaussian' ? 'q · w · θ′' : 'd · R'}</small></button>)}</nav><div className="fk-sheet-content" ref={content}>
      <article className="fk-knowledge-card" aria-label={topic.title + '知识卡'}><header className="fk-card-heading"><h2>{topic.title}</h2><p>{topic.question}</p></header><div className="fk-concept-grid"><div className="fk-concept"><div className="fk-expression">{topic.relations.map(latex => <div key={latex}>{expression(latex)}</div>)}</div><p>{topic.meaning}</p></div><figure className="fk-figure"><svg className="gfocus-formula-diagram" viewBox="0 0 400 245" role="img" aria-label="伽利略式扩束器示意"><path d="M25 123H375" stroke="#91adc9" strokeDasharray="5 5"/><path d="M25 111H120L265 81H375 M25 135H120L265 165H375" fill="none" stroke="#607fa7" strokeWidth={2.5}/><path d="M107 52H133Q122 123 133 194H107Q118 123 107 52Z" fill="#d8eafa" fillOpacity=".6" stroke="#357fc6"/><path d="M265 39Q288 123 265 207Q242 123 265 39Z" fill="#d8eafa" fillOpacity=".6" stroke="#8a5eac"/><text x={97} y={34}>f₁ &lt; 0</text><text x={244} y={25}>f₂ &gt; 0</text><text x={182} y={220}>d</text><text x={23} y={91}>入射</text><text x={323} y={62}>出射</text></svg><figcaption>无焦设计示意；主图按当前高斯光束参数计算。</figcaption></figure></div>
        <div className="fk-detail-grid"><section className="fk-symbols"><h3>变量与单位</h3><dl>{[['λ', '波长；输入 nm，公式中换算为 mm'], ['w₀、z₀', '入射光束自由传播时的束腰半径和位置 / mm'], ['f₁、f₂', '第一、第二镜有向焦距 / mm；伽利略式 f₁ 为负'], ['z₁、z₂、z', '两镜和观察面的绝对位置 / mm；均从同一固定原点向右量取'], ['w′₀、θ′', '出射束腰半径 / mm、远场发散半角 / rad；读数以 mrad 显示'], ['q、R', '复光束参数、波前曲率半径 / mm；平波前 R 为无穷大']].map(([s, m]) => <div key={s}><dt>{s}</dt><dd>{m}</dd></div>)}</dl><h3>适用条件</h3><p>空气中 M² = 1 的理想基模高斯光束、小角度传播、无像差薄透镜；不计口径截断、损耗与非线性。所有光斑半径采用中心光强 1/e² 的约定。</p></section>
          <section className="fk-calculator" aria-label="扩束公式求解器"><h3>公式求解器</h3><label className="fk-solve-target">求解未知量<select aria-label="选择扩束未知量" value={target} onChange={e => setTarget(e.target.value)}><option value="expansion">实际扩束倍率</option><option value="divergence">出射发散半角</option><option value="observation">观察光斑半径</option><option value="collimate">准直第二镜位置</option></select></label><label className="fk-solve-target">装置类型<select aria-label="公式装置类型" value={values.firstKind} onChange={e => setValues(v => ({ ...v, firstKind: e.target.value }))}><option value="-1">伽利略式</option><option value="1">开普勒式</option></select></label><div className="gfocus-calculator-grid">{knownFields.filter(f => f.key !== 'firstKind').map(f => <label key={f.key}><span>{f.label} {f.symbol}</span><div><input aria-label={'已知' + f.label} type="number" min={f.min} max={f.max} step="any" value={values[f.key]} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}/><span>{f.unit}</span></div></label>)}</div><output className="fk-calculator-result" aria-live="polite"><span>{label}</span><strong data-testid="expander-formula-answer">{answer}<small>{unit}</small></strong></output>{error && <p className="fk-calculator-error" role="status">{error}</p>}<p className="fk-calculator-note">已知量来自当前场景；此处试算不改变场景。</p></section>
        </div><footer className="fk-card-footer"><a href="https://www.edmundoptics.com/knowledge-center/application-notes/lasers/beam-expanders/" target="_blank" rel="noreferrer">扩束原理 ↗</a><a href="https://www.rp-photonics.com/abcd_matrix.html" target="_blank" rel="noreferrer">光束变换 ↗</a></footer>
      </article>
    </div></div>
  </dialog>;
}
