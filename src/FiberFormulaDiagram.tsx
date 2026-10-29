export default function FiberFormulaDiagram() {
  return <figure className="fk-figure"><svg viewBox="0 0 400 245" role="img" aria-label="纤芯半径与光纤接收角示意">
    <rect x="115" y="55" width="255" height="125" fill="#f0f4f8" stroke="#c3d1df"/>
    <rect x="115" y="85" width="255" height="65" fill="#e6f1fa" stroke="#8ab0ce"/>
    <path d="M25 75L115 117.5L190 150L340 85L370 98 M25 160L115 117.5" fill="none" stroke="#c19b59" strokeWidth="2"/>
    <path d="M25 117.5H370" stroke="#91adc9" strokeDasharray="4 4"/>
    <path d="M350 117.5V85 M345 117.5H355 M345 85H355" stroke="#537ca2"/>
    <text x="358" y="107">a</text><text x="250" y="72">n₂</text><text x="250" y="138">n₁</text><text x="64" y="106">θₐ</text><text x="130" y="215">V = 2πa NA / λ</text>
  </svg><figcaption>接收半角从轴线量起；a 为纤芯半径。</figcaption></figure>;
}
