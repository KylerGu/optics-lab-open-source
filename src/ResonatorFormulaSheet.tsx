import { useEffect, useRef, useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import { renderToString } from 'katex';
import 'katex/dist/katex.min.css';
import './formula-knowledge.css';
import { RESONATOR_FIELDS, parseResonator, resonator, stableLength, type ResonatorParameters } from './resonator';

const topics = [
  { id: 'stability', title: '两镜腔稳定条件', relations: [String.raw`g_1=1-\frac{L}{R_1},\quad g_2=1-\frac{L}{R_2}`, String.raw`0<g_1g_2<1`, String.raw`\frac{A+D}{2}=2g_1g_2-1`], meaning: '稳定表示光线在多次往返后仍被腔约束。L 是镜间距；朝向腔内的凹面镜取正曲率半径，凸面镜取负值，平面镜取无穷大。严格稳定区域满足 0 < g₁g₂ < 1；等于 0 或 1 是边界。A、D 是光线往返一次的矩阵系数。共焦腔是边界上的特殊简并情况。' },
  { id: 'mode', title: '腔内高斯基模', relations: [String.raw`D_g=g_1+g_2-2g_1g_2`, String.raw`z_0=\frac{Lg_2(1-g_1)}{D_g},\quad z_R=\frac{L\sqrt{g_1g_2(1-g_1g_2)}}{|D_g|}`, String.raw`w_0=\sqrt{\frac{\lambda z_R}{\pi}},\quad w(z)=w_0\sqrt{1+\left(\frac{z-z_0}{z_R}\right)^2}`], meaning: '基模是横向最简单的高斯光束。两面镜的曲率和间距共同决定束腰位置和半径，所以束腰是计算结果，不能独立拖动。位置从第一面镜 z = 0 向第二面镜量取。主图只画两镜之间的真实包络；束腰落在腔外时不硬画腔内束腰。光斑半径采用中心光强下降到 1/e² 的约定。' },
  { id: 'confocal', title: '平凹腔与共焦腔', relations: [String.raw`R_1=\infty:\quad 0<L<R_2,\ z_0=0,\ z_R=\sqrt{L(R_2-L)}`, String.raw`R_1=R_2=L:\quad z_0=\frac L2,\ z_R=\frac L2,\ w_0=\sqrt{\frac{\lambda L}{2\pi}}`], meaning: '平凹腔的束腰位于平面镜。共焦腔的两面凹镜曲率半径都等于镜间距；理想往返矩阵为 −I，因此往返条件不唯一确定光束。此处明确选择对称高斯解。其他临界情况不显示有限稳定光束。“调到稳定”保持腔镜参数不变，从可调镜距内的严格稳定区间中选取一个内部值。' },
];
const expression = (latex: string) => <div dangerouslySetInnerHTML={{ __html: renderToString(latex, { displayMode: true, throwOnError: true, trust: false }) }}/>;

export default function ResonatorFormulaSheet({ parameters, onClose }: { parameters: ResonatorParameters; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), content = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState('stability'), [target, setTarget] = useState('product');
  const [values, setValues] = useState(() => Object.fromEntries(RESONATOR_FIELDS.map(f => [f.key, String(parameters[f.key])])));
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { content.current?.scrollTo({ top: 0 }); }, [selected]);
  const topic = topics.find(t => t.id === selected)!;
  const knownFields = RESONATOR_FIELDS.filter(f => !['firstKind', 'secondKind'].includes(f.key) && (f.key !== 'firstRadiusMm' || values.firstKind !== '0') && (f.key !== 'secondRadiusMm' || values.secondKind !== '0') && (f.key !== 'observationMm' || target === 'observation') && (f.key !== 'wavelengthNm' || ['waist', 'observation'].includes(target)) && (f.key !== 'lengthMm' || target !== 'stable'));
  let answer = '—', note = '', error = '';
  const label = target === 'product' ? '稳定乘积 g₁g₂' : target === 'waist' ? '束腰半径 w₀' : target === 'observation' ? '观察光斑半径 w(z)' : '稳定镜间距 L';
  try {
    if (knownFields.some(f => !values[f.key].trim())) throw new Error('请填写全部已知量。');
    const known = Object.fromEntries(knownFields.map(f => [f.key, Number(values[f.key])]));
    const p = parseResonator({ wavelengthNm: 532, lengthMm: parameters.lengthMm, observationMm: 0, firstRadiusMm: 500, secondRadiusMm: 500, ...known, firstKind: Number(values.firstKind), secondKind: Number(values.secondKind) });
    const b = resonator(p), result = target === 'product' ? b.product : target === 'waist' ? b.mode?.waistMm ?? null : target === 'observation' ? b.observationRadiusMm : stableLength(p);
    if (result === null) { answer = '无可用解'; note = target === 'stable' ? '当前腔镜在可调镜距内没有稳定区域。' : !b.observationInside && target === 'observation' ? '观察面在腔外。' : '当前无有限稳定高斯解。'; }
    else { answer = Math.abs(result) > 0 && Math.abs(result) < .0001 ? result.toExponential(4) : Number(result.toFixed(6)).toString(); note = target === 'product' ? b.status : b.confocal && target !== 'stable' ? '共焦腔取对称高斯解' : ''; }
  } catch (e) { error = e instanceof Error ? e.message : '参数无效。'; }
  return <dialog ref={dialog} className="fk-sheet os-formula-sheet gfocus-formula-sheet resonator-formula" aria-label="两镜谐振腔相关公式" onClose={onClose} onClick={e => { if (e.target !== e.currentTarget) return; const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.currentTarget.close(); }}>
    <div className="fk-sheet-grip"/><header className="fk-sheet-heading"><h2><BookOpen size={18}/>相关公式</h2><button className="icon-button" aria-label="关闭相关公式" autoFocus onClick={() => dialog.current?.close()}><X size={20}/></button></header>
    <div className="fk-sheet-body"><nav className="fk-topic-nav" aria-label="选择知识点">{topics.map(t => <button key={t.id} className={selected === t.id ? 'active' : ''} aria-pressed={selected === t.id} onClick={() => setSelected(t.id)}>{t.title}</button>)}</nav><div className="fk-sheet-content" ref={content}><article className="fk-knowledge-card" aria-label={topic.title + '知识卡'}><header className="fk-card-heading"><h2>{topic.title}</h2></header><div className="fk-concept-grid"><div className="fk-concept"><div className="fk-expression">{topic.relations.map(latex => <div key={latex}>{expression(latex)}</div>)}</div><p>{topic.meaning}</p></div></div>
      <div className="fk-detail-grid"><section className="fk-symbols"><h3>变量与单位</h3><dl>{[['L、R₁、R₂', '镜间距、两镜有向曲率半径 / mm；平面镜 1/R = 0'], ['λ', '波长；输入 nm，计算换算为 mm'], ['g₁、g₂', '无单位的稳定参数'], ['z₀、z、zR', '束腰位置、观察位置、瑞利长度 / mm'], ['w₀、w₁、w₂、w(z)', '束腰、两镜处和观察面的光束半径 / mm']].map(([s, m]) => <div key={s}><dt>{s}</dt><dd>{m}</dd></div>)}</dl><h3>适用条件</h3><p>空气中的理想两镜腔、球面或平面腔镜、小角度高斯基模。不计有限口径、增益、损耗或热透镜；稳定腔不代表已达到激光振荡阈值。</p></section>
      <section className="fk-calculator" aria-label="谐振腔公式求解器"><h3>公式求解器</h3><label className="fk-solve-target">计算量<select aria-label="选择谐振腔计算量" value={target} onChange={e => setTarget(e.target.value)}><option value="product">稳定乘积</option><option value="waist">束腰半径</option><option value="observation">观察光斑半径</option><option value="stable">稳定镜间距</option></select></label>{(['firstKind', 'secondKind'] as const).map((k, i) => <label key={k} className="fk-solve-target">第{i === 0 ? '一' : '二'}镜类型<select aria-label={'公式第' + (i === 0 ? '一' : '二') + '镜类型'} value={values[k]} onChange={e => setValues(v => ({ ...v, [k]: e.target.value }))}><option value="1">凹面镜</option><option value="0">平面镜</option><option value="-1">凸面镜</option></select></label>)}<div className="gfocus-calculator-grid">{knownFields.map(f => <label key={f.key}><span>{f.label} {f.symbol}</span><div><input aria-label={'已知' + f.label} type="number" min={f.min} max={f.max} step="any" value={values[f.key]} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}/><span>{f.unit}</span></div></label>)}</div><output className="fk-calculator-result" aria-live="polite"><span>{label}</span><strong data-testid="resonator-formula-answer">{answer}<small>{target === 'product' ? '' : 'mm'}</small></strong></output>{error && <p className="fk-calculator-error" role="status">{error}</p>}{note && <p className="fk-calculator-note">{note}</p>}<p className="fk-calculator-note">此处试算不改变场景。{target === 'stable' && '以打开公式时的镜距为参考，选取稳定区间内部值。'}</p></section></div>
      <footer className="fk-card-footer"><a href="https://www.rp-photonics.com/stability_zones_of_optical_resonators.html" target="_blank" rel="noreferrer">谐振腔稳定性 ↗</a><a href="https://www.rp-photonics.com/resonator_modes.html" target="_blank" rel="noreferrer">谐振腔模式 ↗</a></footer>
    </article></div></div>
  </dialog>;
}
