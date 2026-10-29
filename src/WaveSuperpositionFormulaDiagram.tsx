export default function WaveSuperpositionFormulaDiagram() {
  return <figure className="fk-figure"><svg viewBox="0 0 400 245" role="img" aria-label="同相、反相与相差90度时的电场叠加示意">{[0, Math.PI, Math.PI / 2].map((phase, row) => {
    const baseline = 45 + row * 75;
    const path = (kind: number) => Array.from({ length: 161 }, (_, i) => {
      const theta = i / 160 * Math.PI * 4;
      const e = kind === 0 ? Math.cos(theta) : kind === 1 ? Math.cos(theta + phase) : Math.cos(theta) + Math.cos(theta + phase);
      return `${105 + i * 1.65},${baseline - e * 14}`;
    }).join(' ');
    return <g key={row}><text x={14} y={baseline + 4}>{['同相', '反相', '相差90°'][row]}</text><line x1={100} x2={380} y1={baseline} y2={baseline} stroke="#bacbdf" strokeDasharray="4 4"/>{['#357fc6', '#c16b37', '#8a5eac'].map((color, kind) => <polyline key={kind} points={path(kind)} fill="none" stroke={color} strokeWidth={kind === 2 ? 2.2 : 1.2} opacity={kind === 2 ? 1 : .65}/>)}</g>;
  })}</svg><figcaption>蓝、橙为两束电场，紫色为合成电场；两束振幅均为1。</figcaption></figure>;
}
