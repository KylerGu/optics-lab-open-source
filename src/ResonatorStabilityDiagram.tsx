export default function ResonatorStabilityDiagram({ g1, g2 }: { g1: number; g2: number }) {
  const x = (g: number) => 125 + g * 48, y = (g: number) => 125 - g * 48;
  const curve = Array.from({ length: 61 }, (_, i) => .5 + 1.5 * i / 60);
  const positive = `M${x(0)} ${y(0)} L${x(2)} ${y(0)} L${x(2)} ${y(.5)} ${[...curve].reverse().map(g => `L${x(g)} ${y(1 / g)}`).join(' ')} L${x(0)} ${y(2)}Z`;
  const inside = Math.abs(g1) <= 2 && Math.abs(g2) <= 2;
  return <figure className="resonator-stability"><svg viewBox="0 0 250 250" role="img" aria-label="稳定区域图，浅绿色区域满足零小于g₁g₂小于一，圆点表示当前腔参数" data-testid="resonator-stability-diagram">
    <rect x={29} y={29} width={192} height={192} rx={5} fill="#f7fafc"/>
    <path d={positive} fill="#dceee8"/><path d={positive} transform="rotate(180 125 125)" fill="#dceee8"/>
    {[-2, -1, 0, 1, 2].map(g => <g key={g}><line x1={x(g)} x2={x(g)} y1={29} y2={221} stroke="#e1e8f0"/><line x1={29} x2={221} y1={y(g)} y2={y(g)} stroke="#e1e8f0"/>{g !== 0 && <><text x={x(g)} y={139} textAnchor="middle">{g}</text><text x={116} y={y(g) + 4} textAnchor="end">{g}</text></>}</g>)}
    <path d="M29 125H229 M125 221V21" stroke="#8098b3"/><text x={230} y={119}>g₁</text><text x={132} y={23}>g₂</text>
    {[1, -1].map(s => <polyline key={s} points={curve.map(g => `${x(s * g)},${y(s / g)}`).join(' ')} fill="none" stroke="#8fb5a9" strokeWidth={1.3}/>)}
    {inside && <circle data-testid="resonator-stability-point" cx={x(g1)} cy={y(g2)} r={4.5} fill="#476e9e" stroke="white" strokeWidth={1.5}/>}
  </svg><figcaption>{inside ? '浅绿：稳定区域' : '当前点在图外 · 浅绿：稳定区域'}</figcaption></figure>;
}
