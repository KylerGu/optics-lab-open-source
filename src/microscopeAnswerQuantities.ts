import type { AnswerQuantity } from './answerQuantityLinks';
import { MICROSCOPE_QUANTITIES, canAnnotateMicroscope, type MicroscopeQuantity } from './microscopeQuantities';
import type { SceneResult, SceneState } from './sceneRuntime';

const names: Record<MicroscopeQuantity, { label: string; terms: string[]; symbols: string[] }> = {
  f1: { label: '物镜焦距', terms: ['物镜焦距'], symbols: ['f_o','f_1','fₒ'] },
  f2: { label: '目镜焦距', terms: ['目镜焦距'], symbols: ['f_e','f_2','fₑ'] },
  tubeF: { label: '管镜焦距', terms: ['管镜焦距'], symbols: ['f_t','fₜ'] },
  u: { label: '物距', terms: ['物体到物镜距离','物距'], symbols: ['u'] },
  d: { label: '镜距', terms: ['物镜到目镜距离','物镜到管镜距离','镜距'], symbols: ['d'] },
  h: { label: '物高', terms: ['物体高度','物高'], symbols: ['h'] },
  v1: { label: '中间像距', terms: ['中间像距','物镜像距'], symbols: ['v_1','v₁'] },
  v: { label: '距目镜的像距', terms: ['距目镜的像距','目镜像距','最终像距'], symbols: ['v_2','v₂'] },
  focusOffset: { label: '物体离焦量', terms: ['物体离焦量'], symbols: ['\\Delta u','Δu'] },
  fieldWidth: { label: '水平视场', terms: ['水平视场','视场宽度'], symbols: ['W'] },
  fieldHeight: { label: '垂直视场', terms: ['垂直视场','视场高度'], symbols: ['H'] },
  fieldDiagonal: { label: '对角线视场', terms: ['对角线视场','视场对角线'], symbols: ['L'] },
  fieldDiameter: { label: '目视视野直径', terms: ['目视视野直径','视野直径','视场直径'], symbols: ['D'] },
  separation: { label: '两点间距', terms: ['两点间距','点间距','两点距离'], symbols: ['s'] },
  resolution: { label: '横向分辨率', terms: ['横向分辨极限','横向分辨率','分辨极限','瑞利极限','分辨率'], symbols: ['r','r_{xy}','rₓᵧ'] },
  depth: { label: '景深', terms: ['物方全景深','全景深','物方景深','景深估计','景深','DOF'], symbols: ['DOF','D'] },
  halfDepth: { label: '焦平面上下范围', terms: ['焦平面上下范围','半景深'], symbols: ['\\Delta z','Δz'] },
  defocus: { label: '样品离焦量', terms: ['样品离焦量','样品位置'], symbols: ['z'] },
};

export function microscopeAnswerQuantities(state: SceneState, result: SceneResult | null, source: SceneState,
  selected: ReadonlySet<MicroscopeQuantity>, toggle: (key: MicroscopeQuantity) => void): AnswerQuantity[] {
  if (state.sceneId !== 'instruments-0' || source.sceneId !== state.sceneId || source.parameters.study !== state.parameters.study || source.parameters.mode !== state.parameters.mode) return [];
  const controls = state.parameters.study === 0 ? 'microscope-ray-diagram' : state.parameters.study === 2 ? 'microscope-field-diagram' : 'microscope-performance-diagram';
  return (Object.keys(names) as MicroscopeQuantity[]).filter(key => canAnnotateMicroscope(state, result, key)).map(key => {
    const meta = key === 'v' && state.parameters.mode === 1
      ? { ...names.v, label: '最佳像面距管镜', terms: ['最佳像面距管镜','管镜像距','最终像距'] } : names[key];
    return { ...meta, id: key, color: MICROSCOPE_QUANTITIES[key].color, controls, selected: selected.has(key), onToggle: () => toggle(key) };
  });
}
