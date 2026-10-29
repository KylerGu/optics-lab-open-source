export default function MichelsonFormulaDiagram(){
  return <figure className="fk-figure"><svg viewBox="0 0 400 245" role="img" aria-label="分光器将入射光分为两条往返光路，再汇向观察端">
    <path d="M25 115H160 M160 115H295 M160 115V40 M160 115V210" stroke="#bacbdf" fill="none"/>
    <path d="M160 112H295 M295 118H166V210" fill="none" stroke="#357fc6" strokeWidth={2}/>
    <path d="M157 115V40 M163 40V210" fill="none" stroke="#c16b37" strokeWidth={2}/>
    <path d="M295 88V142 M134 40H186 M141 134L179 96" stroke="#91adc9" strokeWidth={4}/>
    <text x={22} y={95}>光源</text><text x={302} y={110}>M₁</text><text x={180} y={30}>M₂</text><text x={182} y={155}>分光器</text>
    <text x={213} y={94}>L₁</text><text x={127} y={80}>L₂</text><text x={127} y={233}>观察端</text>
  </svg><figcaption>每一臂均走一个往返；轴上光程差为2(L₂−L₁)。</figcaption></figure>;
}
