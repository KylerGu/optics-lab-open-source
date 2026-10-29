export default function IlluminationFormulaDiagram() {
  return <figure className="fk-figure"><svg viewBox="0 0 400 235" role="img" aria-label="定向光源主轴、距离和接收角示意">
    <path d="M30 195H370" stroke="#7f98ad"/><path d="M130 55V195 M280 140V195" stroke="#bcc9d7" strokeDasharray="4 4"/>
    <path d="M130 55L200 195" stroke="#c99c55" strokeWidth="2"/><path d="M130 55L280 195" stroke="#26836a" strokeWidth="1.6"/>
    <circle cx="130" cy="55" r="9" fill="#ecc783"/><circle cx="280" cy="195" r="4" fill="#26836a"/>
    <path d="M115 55H100V195H115" fill="none" stroke="#62748a"/>
    <text x="80" y="130">h</text><text x="145" y="40">I₀</text><text x="180" y="115">α</text><text x="245" y="180">γ</text><text x="225" y="115">r</text><text x="300" y="195">E</text>
    <text x="140" y="225">水平接收面</text>
  </svg><figcaption>α 从光源主轴量起，γ 从接收面法线量起。</figcaption></figure>;
}
