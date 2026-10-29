export default function YoungDoubleSlitFormulaDiagram() {
  return <figure className="fk-figure"><svg viewBox="0 0 400 245" role="img" aria-label="上缝和下缝到同一观察点的两条光程">
    <path d="M75 38V82 M75 94V146 M75 158V212 M300 30V220" stroke="#91adc9" strokeWidth={4}/>
    <path d="M30 120H300" stroke="#bacbdf" strokeDasharray="4 4"/>
    <path d="M75 88L300 67" stroke="#357fc6" strokeWidth={2}/><path d="M75 152L300 67" stroke="#c16b37" strokeWidth={2}/>
    <circle cx={300} cy={67} r={4} fill="#26836a"/>
    <text x={46} y={86}>S₁</text><text x={46} y={157}>S₂</text><text x={312} y={65}>P</text>
    <text x={176} y={65}>r₁</text><text x={176} y={126}>r₂</text>
    <path d="M42 88V152 M38 88H46 M38 152H46 M315 67V120 M311 120H319 M311 67H319 M75 204H300 M75 200V208 M300 200V208" fill="none" stroke="#91adc9"/>
    <text x={23} y={125}>d</text><text x={325} y={100}>y</text><text x={184} y={225}>L</text>
  </svg><figcaption>两条光路汇于同一点；δ = r₂ − r₁。装置示意局部放大。</figcaption></figure>;
}
