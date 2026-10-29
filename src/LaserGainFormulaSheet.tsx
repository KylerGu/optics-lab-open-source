import { useEffect, useRef, useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import { renderToString } from 'katex';
import 'katex/dist/katex.min.css';
import './formula-knowledge.css';
import { DEFAULT_GAIN, GAIN_FIELDS, laserGain, parseGain, gainTarget, type LaserGainParameters } from './laserGain';
const topics = [
  { id: 'threshold', title: '激光阈值条件', relations: [String.raw`Q_0=R_1R_2\exp\left[2(g_0-\alpha)L\right]`, String.raw`Q_0=1\quad\Longrightarrow\quad g_{\rm th}=\alpha+\frac{\ln(1/(R_1R_2))}{2L}`], meaning: '小信号增益 g₀ 表示光很弱时，介质每单位长度的放大能力。Q₀ 是微弱光往返一周后的强度倍率：小于 1 会衰减，等于 1 达到阈值，大于 1 具备起振的增益条件。这里 g 和 α 都是光强系数，不是电场振幅系数。增益介质填满两镜之间的长度 L，往返经过两次；镜面反射率也必须相乘。' },
  { id: 'saturation', title: '增益饱和与稳态', relations: [String.raw`s=\frac{I}{I_s},\qquad g(s)=\frac{g_0}{1+s}`, String.raw`g_0>g_{\rm th}>0:\quad s_{\rm ss}=\frac{g_0}{g_{\rm th}}-1,\quad g_{\rm ss}=g_{\rm th}`, String.raw`\frac{I_{\rm out}}{I_s}=(1-R_2)\max\left(0,\frac{g_0}{g_{\rm th}}-1\right)`], meaning: '光强增加会消耗储存在介质中的激发能量，从而降低增益。采用等效均匀饱和模型；阈值以上，饱和增益恰好等于阈值增益，继续增加小信号增益主要提高稳态光强。I 是输出镜前的等效腔内光强，Iₛ 为相同约定下的饱和光强；输出镜无吸收，所以透射率为 1 − R₂。低于或恰好达到阈值时，这个忽略自发辐射的模型取零稳态受激光强。“试算相对光强”是独立采样点，不会强行改变自动算出的激光稳态。' },
  { id: 'stimulated', title: '受激辐射与增益', relations: [String.raw`g_0=\sigma_e N_e-\sigma_a N_g`, String.raw`I(z)=I(0)\exp[(g_0-\alpha)z]`], meaning: '受激辐射是已有光子促使激发态粒子发出相同模式光子的过程。σe、σa 是有效发射与吸收截面，Ne、Ng 是相应能级的粒子数密度；发射超过吸收时可获得正增益。本场景直接输入 g₀，不用未给定的材料或泵浦参数估算功率。单程放大不等于激光振荡，还需满足往返增益条件和腔模条件。' },
];
const expression = (latex: string) => <div dangerouslySetInnerHTML={{ __html: renderToString(latex, { displayMode: true, throwOnError: true, trust: false }) }}/>;
const needed: Record<string, string[]> = { threshold: ['lengthMm', 'lossPerM', 'firstReflectivityPct', 'secondReflectivityPct'], roundTrip: ['lengthMm', 'smallSignalGain', 'lossPerM', 'firstReflectivityPct', 'secondReflectivityPct'], output: ['lengthMm', 'smallSignalGain', 'lossPerM', 'firstReflectivityPct', 'secondReflectivityPct'], saturation: ['smallSignalGain', 'probeIntensity'], above: ['lengthMm', 'lossPerM', 'firstReflectivityPct', 'secondReflectivityPct'] };
export default function LaserGainFormulaSheet({ parameters, onClose }: { parameters: LaserGainParameters; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), content = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState('threshold'), [target, setTarget] = useState('threshold');
  const [values, setValues] = useState(() => Object.fromEntries(GAIN_FIELDS.map(f => [f.key, String(parameters[f.key])])));
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { content.current?.scrollTo({ top: 0 }); }, [selected]);
  const topic = topics.find(t => t.id === selected)!, knownFields = GAIN_FIELDS.filter(f => needed[target].includes(f.key));
  const label = target === 'threshold' ? '阈值增益' : target === 'roundTrip' ? '小信号往返倍率' : target === 'output' ? '相对出射光强' : target === 'saturation' ? '试算饱和增益' : '阈值1.2倍的增益';
  const unit = target === 'roundTrip' ? '×' : target === 'output' ? '' : 'm⁻¹';
  let answer = '—', note = '', error = '';
  try {
    if (knownFields.some(f => !values[f.key].trim())) throw new Error('请填写全部已知量。');
    const p = parseGain({ ...DEFAULT_GAIN, ...Object.fromEntries(knownFields.map(f => [f.key, Number(values[f.key])])) }), b = laserGain(p);
    const result = target === 'threshold' ? b.thresholdGain : target === 'roundTrip' ? b.roundTrip : target === 'output' ? b.outputIntensity : target === 'saturation' ? b.probeGain : gainTarget(p, true);
    if (result === null) { answer = '无可用解'; note = b.lossless ? '理想无损模型无法确定有限稳态输出。' : '目标增益超出当前可调范围。'; }
    else { answer = result !== 0 && (Math.abs(result) < .0001 || Math.abs(result) > 1e6) ? result.toExponential(4) : Number(result.toFixed(6)).toString(); note = target === 'roundTrip' || target === 'output' ? b.status : ''; }
  } catch (e) { error = e instanceof Error ? e.message : '参数无效。'; }
  return <dialog ref={dialog} className="fk-sheet os-formula-sheet gfocus-formula-sheet gain-formula" aria-label="激光阈值与增益相关公式" onClose={onClose} onClick={e => { if (e.target !== e.currentTarget) return; const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.currentTarget.close(); }}>
    <div className="fk-sheet-grip"/><header className="fk-sheet-heading"><h2><BookOpen size={18}/>相关公式</h2><button className="icon-button" aria-label="关闭相关公式" autoFocus onClick={() => dialog.current?.close()}><X size={20}/></button></header>
    <div className="fk-sheet-body"><nav className="fk-topic-nav" aria-label="选择知识点">{topics.map(t => <button key={t.id} className={selected === t.id ? 'active' : ''} aria-pressed={selected === t.id} onClick={() => setSelected(t.id)}>{t.title}</button>)}</nav><div className="fk-sheet-content" ref={content}><article className="fk-knowledge-card" aria-label={topic.title + '知识卡'}><header className="fk-card-heading"><h2>{topic.title}</h2></header><div className="fk-concept-grid"><div className="fk-concept"><div className="fk-expression">{topic.relations.map(latex => <div key={latex}>{expression(latex)}</div>)}</div><p>{topic.meaning}</p></div></div>
      <div className="fk-detail-grid"><section className="fk-symbols"><h3>变量与单位</h3><dl>{[['L', '增益介质长度；输入 mm，指数计算时换成 m'], ['g₀、g、gth、α', '小信号增益、饱和增益、阈值增益、内部损耗系数 / m⁻¹'], ['R₁、R₂', '第一镜和输出镜的光强反射率；输入百分数，计算换成 0–1'], ['I、Iₛ、Iout', '等效腔内光强、饱和光强、出射光强；界面显示相对于 Iₛ 的值'], ['σe、σa；Ne、Ng', '发射与吸收截面 / m²；相关能级粒子数密度 / m⁻³']].map(([s, m]) => <div key={s}><dt>{s}</dt><dd>{m}</dd></div>)}</dl><h3>适用条件</h3><p>假定已有可共振的单个腔模，增益及内部损耗均匀，采用稳态等效均匀饱和、无吸收输出镜。不计算几何稳定性、泵浦转换效率、空间烧孔、自发辐射、瞬态或多模竞争；不是材料设计的绝对功率预测。高单程增益时均匀光强近似会变差。理想无损腔 gth = 0 不具有本模型可唯一确定的有限稳态，不能把它画成正常输出曲线。</p></section>
      <section className="fk-calculator" aria-label="增益公式求解器"><h3>公式求解器</h3><label className="fk-solve-target">计算量<select aria-label="选择增益计算量" value={target} onChange={e => setTarget(e.target.value)}><option value="threshold">阈值增益</option><option value="roundTrip">小信号往返倍率</option><option value="output">相对出射光强</option><option value="saturation">饱和增益</option><option value="above">阈值以上的增益</option></select></label><div className="gfocus-calculator-grid">{knownFields.map(f => <label key={f.key}><span>{f.label} {f.symbol}</span><div><input aria-label={'已知' + f.label} type="number" min={f.min} max={f.max} step="any" value={values[f.key]} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}/><span>{f.unit}</span></div></label>)}</div><output className="fk-calculator-result" aria-live="polite"><span>{label}</span><strong data-testid="gain-formula-answer">{answer}<small>{unit}</small></strong></output>{error && <p className="fk-calculator-error" role="status">{error}</p>}{note && <p className="fk-calculator-note">{note}</p>}<p className="fk-calculator-note">此处试算不改变场景。光强均以饱和光强 Iₛ 为基准。</p></section></div>
      <footer className="fk-card-footer"><a href="https://www.rp-photonics.com/laser_threshold.html" target="_blank" rel="noreferrer">激光阈值 ↗</a><a href="https://www.rp-photonics.com/gain_saturation.html" target="_blank" rel="noreferrer">增益饱和 ↗</a></footer>
    </article></div></div>
  </dialog>;
}
