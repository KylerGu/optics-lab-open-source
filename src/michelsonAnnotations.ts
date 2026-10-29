/** Shared meanings and colours keep controls and drawing labels in agreement. */
export const MICHELSON_QUANTITIES = {
  mirror1MoveUm: { color:'#357fc6', meaning:'第一镜相对初始位置的移动量；正值向外，负值向内。' },
  mirrorMoveUm: { color:'#bf703f', meaning:'第二镜相对初始位置的移动量；正值向外，负值向内。' },
  arm1Mm: { color:'#357fc6', meaning:'分光镜到第一反射镜的单程距离。' },
  arm2Mm: { color:'#bf703f', meaning:'分光镜到第二反射镜的单程距离。' },
  sourceDistanceMm: { color:'#617f9b', meaning:'光源到分光镜的距离；移动光源不改变两臂长度差。' },
  lensDistanceMm: { color:'#617f9b', meaning:'分光镜到观察透镜的距离；观察屏随透镜一起移动。' },
  focalLengthMm: { color:'#617f9b', meaning:'本场景中，透镜到观察屏的距离等于焦距。' },
  observationRadiusMm: { color:'#26836a', meaning:'圆环中心到观察点的距离；0 表示观察点在圆心。' },
  intensity: { color:'#8a5eac', meaning:'所选观察点的亮暗程度；0 为全暗，1 为最亮。' },
  differenceUm: { color:'#8a5eac', meaning:'第二臂长度减去第一臂长度；正值表示第二臂更长。' },
  axisDeltaUm: { color:'#8a5eac', meaning:'两束光到圆心时的往返路程之差，等于两臂长度差的两倍。' },
  deltaUm: { color:'#8a5eac', meaning:'两束光到所选观察点时的等效路程之差，决定该点的亮暗。' },
} as const;
export type MichelsonAnnotation = keyof typeof MICHELSON_QUANTITIES;
export const MICHELSON_PARAMETER_MEANINGS = {
  ...Object.fromEntries(Object.entries(MICHELSON_QUANTITIES).map(([key, value])=>[key,value.meaning])),
  wavelengthNm:'光波每重复一次的长度；决定条纹变化所需的移镜量。',
  baseDifferenceUm:'两镜微调均为 0 时，第二臂长度减去第一臂长度。',
} as Record<string,string>;
