import { useEffect, useRef, useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import { renderToString } from 'katex';
import 'katex/dist/katex.min.css';
import './formula-knowledge.css';
import { FOCUS_FIELDS, gaussianFocus, parseFocus, type FocusParameters } from './gaussianFocus';

const expression = (latex: string) => <span className="fk-typeset" dangerouslySetInnerHTML={{ __html: renderToString(latex, { displayMode: true, throwOnError: true, trust: false }) }}/>;
const formulas = [
  { id: 'transform', title: '薄透镜的光束变换', question: '透镜怎样同时改变光束宽度和波前？',
    relations: [String.raw`q_-=z_L-z_0+i z_R,\qquad z_R=\frac{\pi w_0^2}{\lambda}`, String.raw`\frac{1}{q_+}=\frac{1}{q_-}-\frac{1}{f}`, String.raw`\frac{1}{q}=\frac{1}{R}-i\frac{\lambda}{\pi w^2}`],
    meaning: '复光束参数 q 用一个数同时记录光束的粗细和波前的弯曲程度。薄透镜改变波前曲率，透镜两侧的光斑半径连续。先计算 q，再确定束腰；束腰到透镜的距离通常不等于焦距。' },
  { id: 'waist', title: '出射束腰与观察光斑', question: '最细处在哪里，目标位置的光斑多大？',
    relations: [String.raw`z'_0=z_L-\operatorname{Re}(q_+),\qquad z'_R=\operatorname{Im}(q_+)`, String.raw`w'_0=\sqrt{\frac{\lambda z'_R}{\pi}}`, String.raw`w(z)=w'_0\sqrt{1+\left(\frac{z-z'_0}{z'_R}\right)^2}\quad(z\ge z_L)`],
    meaning: '束腰是光束最细的位置。z′₀ ≥ zᴸ 时它在实际出射光路中；z′₀ < zᴸ 时它是出射光束反向延拓的束腰，透镜后最细处改为透镜平面。观察位置在透镜前时，使用入射光束的自由传播公式。' },
];

export default function GaussianFocusFormulaSheet({ parameters, onClose }: { parameters: FocusParameters; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), content = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState('transform'), [target, setTarget] = useState('position');
  const [values, setValues] = useState(() => Object.fromEntries(FOCUS_FIELDS.map(f => [f.key, String(parameters[f.key])])));
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { content.current?.scrollTo({ top: 0 }); }, [selected]);
  const topic = formulas.find(f => f.id === selected)!;
  let answer = '—', note = '', error = '';
  try {
    if (Object.values(values).some(v => !v.trim())) throw new Error('请填写全部已知量。');
    const p = parseFocus(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)])));
    const b = gaussianFocus(p);
    const n = target === 'position' ? b.outputWaistPositionMm : target === 'waist' ? b.outputWaistMm : b.observationRadiusMm;
    answer = Math.abs(n) >= 1e6 || Math.abs(n) > 0 && Math.abs(n) < .0001 ? n.toExponential(4) : Math.abs(n) > 0 && Math.abs(n) < .01 ? Number(n.toPrecision(6)).toString() : Number(n.toFixed(6)).toString();
    note = target === 'observation' && b.observationBeforeLens ? '观察位置在透镜前，读数取入射光束。' : b.virtual ? '出射束腰在透镜前，仅表示反向延拓；透镜后实际最小半径为 ' + Number(b.minimumForwardMm.toFixed(6)) + ' mm。' : '已知量来自当前场景；此处试算不改变场景参数。';
  } catch (e) { error = e instanceof Error ? e.message : '参数无效。'; }
  return <dialog ref={dialog} className="fk-sheet os-formula-sheet gfocus-formula-sheet" aria-label="高斯光束透镜聚焦相关公式" onClose={onClose} onClick={e => { if (e.target !== e.currentTarget) return; const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.currentTarget.close(); }}>
    <div className="fk-sheet-grip"/><header className="fk-sheet-heading"><h2><BookOpen size={18}/>相关公式</h2><button className="icon-button" aria-label="关闭相关公式" autoFocus onClick={() => dialog.current?.close()}><X size={20}/></button></header>
    <div className="fk-sheet-body"><nav className="fk-topic-nav" aria-label="选择知识点">{formulas.map(f => <button key={f.id} className={f.id === selected ? 'active' : ''} aria-pressed={f.id === selected} onClick={() => setSelected(f.id)}><span>{f.title}</span><small>{f.id === 'transform' ? 'q · f · R' : 'z′₀ · w′₀ · w(z)'}</small></button>)}</nav><div className="fk-sheet-content" ref={content}>
      <article className="fk-knowledge-card" aria-label={topic.title + '知识卡'}><header className="fk-card-heading"><h2>{topic.title}</h2><p>{topic.question}</p></header><div className="fk-concept-grid"><div className="fk-concept"><div className="fk-expression">{topic.relations.map(latex => <div key={latex}>{expression(latex)}</div>)}</div><p>{topic.meaning}</p></div><figure className="fk-figure"><svg className="gfocus-formula-diagram" viewBox="0 0 400 245" role="img" aria-label="透镜前后高斯光束束腰示意"><path d="M25 130H375" stroke="#91adc9" strokeDasharray="5 5"/><path d="M35 103Q90 103 150 90Q225 124 265 125Q310 125 365 100 M35 157Q90 157 150 170Q225 136 265 135Q310 135 365 160" fill="none" stroke="#607fa7" strokeWidth={2.5}/><path d="M150 45Q175 130 150 215Q125 130 150 45Z" fill="#d8eafa" fillOpacity=".6" stroke="#357fc6"/><path d="M35 80V182" stroke="#c16b37" strokeDasharray="4 4"/><path d="M265 80V182" stroke="#8a5eac" strokeDasharray="4 4"/><text x={24} y={64} style={{ fill: '#c16b37' }}>z₀</text><text x={137} y={30} style={{ fill: '#357fc6' }}>zᴸ</text><text x={252} y={65} className="gfocus-figure-output">z′₀</text><text x={45} y={215}>入射光束</text><text x={252} y={215}>出射光束</text></svg><figcaption>示意中的束腰位于透镜后方；实际位置由当前参数决定。</figcaption></figure></div>
        <div className="fk-detail-grid"><section className="fk-symbols"><h3>变量与单位</h3><dl>{[['λ', '空气中波长；输入 nm，公式换算为 mm'], ['w₀、z₀', '未放透镜时入射光束的束腰半径与位置 / mm；束腰可在透镜任一侧'], ['f、zᴸ', '正焦距与透镜位置 / mm'], ['z', '观察位置 / mm'], ['z′₀、w′₀', '出射束腰位置与半径 / mm'], ['q₋、q₊', '透镜前后复光束参数 / mm'], ['R', '波前曲率半径 / mm；正值对应发散波前']].map(([symbol, meaning]) => <div key={symbol}><dt>{symbol}</dt><dd>{meaning}</dd></div>)}</dl><p>位置均从同一固定原点量起，光沿 z 增大方向传播；移动透镜不会移动原点。</p><h3>适用条件</h3><p>空气中、M² = 1 的理想基模高斯光束、小角度传播、无像差薄透镜；忽略有限口径截断、损耗及非线性。所有半径采用光强降到中心 1/e² 的定义。</p><h3>实际应用</h3><p>给定激光输入与透镜，估算聚焦位置、最小光斑和目标平面光斑，比较焦距或透镜位置变化造成的影响。</p></section>
          <section className="fk-calculator" aria-label="聚焦公式求解器"><div className="fk-section-heading"><h3>公式求解器</h3></div><label className="fk-solve-target">求解未知量<select aria-label="选择聚焦未知量" value={target} onChange={e => setTarget(e.target.value)}><option value="position">出射束腰位置 z′₀</option><option value="waist">出射束腰半径 w′₀</option><option value="observation">观察光斑半径 w(z)</option></select></label><div className="gfocus-calculator-grid">{FOCUS_FIELDS.filter(f => target === 'observation' || f.key !== 'observationMm').map(f => <label key={f.key}><span>{f.label} {f.symbol}</span><div><input aria-label={'已知' + f.label} type="number" min={f.min} max={f.max} step="any" value={values[f.key]} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}/><span>{f.unit}</span></div></label>)}</div><output className="fk-calculator-result" aria-live="polite"><span>{target === 'position' ? '出射束腰位置 z′₀' : target === 'waist' ? '出射束腰半径 w′₀' : '观察光斑半径 w(z)'}</span><strong data-testid="focus-formula-answer">{answer}<small>mm</small></strong></output>{error && <p className="fk-calculator-error" role="status">{error}</p>}{note && <p className="fk-calculator-note">{note}</p>}</section>
        </div><footer className="fk-card-footer"><a href="https://www.edmundoptics.co.uk/knowledge-center/application-notes/lasers/gaussian-beam-propagation/" target="_blank" rel="noreferrer">公式参考 ↗</a></footer>
      </article>
    </div></div>
  </dialog>;
}
