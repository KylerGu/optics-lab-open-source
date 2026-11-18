// 主应用及其样式单独打包，引导页可以先显示，主应用在后台加载。
import './styles.css';
import './workbench.css';
import './gaussian-scene.css';
import 'katex/dist/katex.min.css';
import './readability.css';
import './spatial-build.css';
import './ui-consistency.css';
import './type-scale.css';
import './studio-split.css';

export { default } from './App';
