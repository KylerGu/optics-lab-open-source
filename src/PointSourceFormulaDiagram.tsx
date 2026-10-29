export default function PointSourceFormulaDiagram() {
  return <figure className="fk-figure"><svg viewBox="0 0 400 230" role="img" aria-label="点光源到接收面中心的距离与照度示意">
    <path d="M70 105L320 45 M70 105L320 165 M70 105H320" stroke="#d9aa62" fill="none"/>
    <rect x="313" y="35" width="14" height="140" rx="5" fill="#e0f1eb" stroke="#26836a"/>
    <circle cx="70" cy="105" r="12" fill="#edc77f"/><circle cx="320" cy="105" r="4" fill="#26836a"/>
    <path d="M70 195H320 M70 190V200 M320 190V200" stroke="#62748a"/>
    <text x="67" y="70">I</text><text x="340" y="110">E</text><text x="190" y="215">r</text>
  </svg><figcaption>r 从点光源量到接收面中心；中心垂直接收。</figcaption></figure>;
}
