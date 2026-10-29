import {renderToString} from 'katex';
import AberrationQuantitySymbol from './AberrationQuantitySymbol';

const definitions=[
  ['当前波长折射率',String.raw`n=A+B/\lambda^2`],
  ['透镜中心厚度',String.raw`t=2(R-\sqrt{R^2-(D/2)^2})+t_{\mathrm e}`],
  ['近轴有效焦距',String.raw`F=z_{F'}-z_{H'}`],
  ['近轴后焦距',String.raw`\mathrm{BFL}=z_{F'}-z_{V'}`],
  ['边缘光线焦距',String.raw`L_{\mathrm m}=z_{\mathrm m}-z_{V'}`],
  ['纵向球差',String.raw`\Delta z_{\mathrm{SA}}=\mathrm{BFL}-L_{\mathrm m}`],
  ['红蓝近轴焦距差',String.raw`\Delta z_{\mathrm{RB}}=\mathrm{BFL}_{650}-\mathrm{BFL}_{450}`],
  ['屏上几何均方根半径',String.raw`r_{\mathrm{RMS}}=\sqrt{\frac1N\sum_i[(x_i-\bar x)^2+(y_i-\bar y)^2]}`],
];
export default function AberrationSymbolDefinitions(){
  return <details className="os-symbol-formulas"><summary>本场景符号与定义</summary>
    <dl>{definitions.map(([label,latex])=><div key={label}><dt>{label}</dt><dd dangerouslySetInnerHTML={{__html:renderToString(latex,{throwOnError:true,trust:false})}}/></div>)}</dl>
    <p>z 为沿光轴的位置；V、V′ 为透镜前、后顶点，H′ 为后主面（计算有效焦距的参考平面），F′ 为近轴焦点，zₘ 为边缘光线的轴上交点。</p>
    <p>D 为口径，s 为后顶点到观察屏的距离；tₑ 为边缘厚度。色散式中 λ 使用 μm，红蓝比较采用 650 nm 和 450 nm。</p>
    <p><AberrationQuantitySymbol quantity="marginalFocus"/>、<AberrationQuantitySymbol quantity="longitudinalSA"/>、<AberrationQuantitySymbol quantity="chromaticShift"/> 是本场景的下标约定；<AberrationQuantitySymbol quantity="rmsRadius"/> 表示落点到平均位置的均方根距离，不是光斑外边界。</p>
  </details>;
}
