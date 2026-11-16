import type { ResearchArtifact } from './ResearchResults';
import type { FormulaId, FormulaValues } from './formulaCatalog';
import { OPTICS_FORMULAS } from './opticsKnowledgeModel';
import type { SceneResult, SceneState } from './sceneRuntime';
import type { SpatialElement } from './builderModel';
import { isPhysicalLens, physicalFocalLengths } from './physicalLensGeometry';
import { glassIndex } from './spatialGeometry';
import { formatCompact, formatScaled, chooseLengthDisplay } from './researchUnits';

export interface FormulaPresetRequest {
  id: string;
  formulaId?: FormulaId;
  knowledgeId?: string;
  values?: Partial<FormulaValues>;
  opticsValues?: Record<string, number>;
  state?: SceneState;
  result?: SceneResult | { metrics: SceneResult['metrics'] };
}

export interface RecordFormulaLink {
  label: string;
  preset: Omit<FormulaPresetRequest, 'id'>;
}

export interface FormulaExpressionCard {
  title: string;
  latex: string;
  preset?: Omit<FormulaPresetRequest, 'id'>;
  presetLabel?: string;
}

export interface FormulaDerivationStep {
  label: string;
  latex: string;
}

export interface RecordFormulaInfo {
  expressions: FormulaExpressionCard[];
  derivations: FormulaDerivationStep[];
  extraLinks: RecordFormulaLink[];
}

function formatLengthTex(mm: number): string {
  const display = chooseLengthDisplay([mm]);
  const scaled = formatScaled(mm, display);
  const unitTex = display.unit === 'μm' ? String.raw`\mu\text{m}` : String.raw`\text{${display.unit}}`;
  return String.raw`${scaled}\ ${unitTex}`;
}

function primaryAxisInfo(
  laser: SpatialElement,
  lens: SpatialElement,
  scanField?: string,
): { symbol: 'x' | 'y' | 'z'; index: 0 | 1 | 2 } {
  if (scanField === 'x') return { symbol: 'x', index: 0 };
  if (scanField === 'y') return { symbol: 'y', index: 1 };
  if (scanField === 'z') return { symbol: 'z', index: 2 };
  const dx = Math.abs(lens.position[0] - laser.position[0]);
  const dy = Math.abs(lens.position[1] - laser.position[1]);
  const dz = Math.abs(lens.position[2] - laser.position[2]);
  if (dz >= dx && dz >= dy) return { symbol: 'z', index: 2 };
  if (dy > dx) return { symbol: 'y', index: 1 };
  return { symbol: 'x', index: 0 };
}

function resolveLensFocalMm(lens: SpatialElement, wavelengthNm: number): { effective: number; back: number } | null {
  if (lens.kind === 'lens' || lens.kind === 'cylindrical-lens') {
    return { effective: lens.focalLengthMm, back: lens.focalLengthMm };
  }
  if (isPhysicalLens(lens.kind)) {
    const focals = physicalFocalLengths(lens, wavelengthNm);
    if (focals.effective != null && focals.back != null) {
      return { effective: focals.effective, back: focals.back };
    }
  }
  return null;
}

export function resolveArtifactFormulas(artifact: ResearchArtifact, metric?: string): RecordFormulaInfo {
  if (artifact.kind === 'model') {
    const matched = OPTICS_FORMULAS.filter(f => f.sceneId === artifact.input.sceneId);
    const expressions: FormulaExpressionCard[] = matched.slice(0, 3).map(f => ({
      title: f.title,
      latex: f.latex,
      preset: {
        knowledgeId: f.id,
        state: artifact.input,
        result: artifact.data.evidence,
      },
      presetLabel: '代入计算',
    }));
    const derivations: FormulaDerivationStep[] = artifact.data.evidence.metrics
      .filter(m => m.value !== null && Number.isFinite(m.value))
      .slice(0, 3)
      .map(m => ({
        label: m.label,
        latex: String.raw`${formatCompact(m.value!, 4)}${m.unit ? String.raw`\ \text{${m.unit}}` : ''}`,
      }));
    return { expressions, derivations, extraLinks: [] };
  }

  const elements = artifact.input.elements;
  const laser = elements.find(e => e.kind === 'laser');
  const wavelengthNm = laser?.wavelengthNm ?? 532;
  const lenses = elements.filter(
    e => e.kind === 'lens' || e.kind === 'cylindrical-lens' || isPhysicalLens(e.kind),
  );
  const firstLens = lenses[0];
  const firstFocal = firstLens ? resolveLensFocalMm(firstLens, wavelengthNm) : null;
  const screen = elements.find(e => e.kind === 'screen');
  const expressions: FormulaExpressionCard[] = [];
  const derivations: FormulaDerivationStep[] = [];
  const extraLinks: RecordFormulaLink[] = [];
  const scanField = artifact.kind === 'comparison' ? artifact.data.field : undefined;

  if (metric === 'sampledPowerMw') {
    expressions.push({
      title: '几何采样到屏功率',
      latex: String.raw`P_{\text{屏}}=\frac{N_{\text{命中}}}{N}\,P_0\prod_i T_i`,
    });
    if (laser) {
      derivations.push({
        label: '光源输入与采样设定',
        latex: String.raw`P_0 = ${formatCompact(laser.powerMw, 4)}\text{ mW},\qquad N = ${laser.rayCount}\text{ 条采样光线}`,
      });
    }
    return { expressions, derivations, extraLinks };
  }

  if (metric === 'footprintRadiusMm') {
    if (firstLens && isPhysicalLens(firstLens.kind) && firstFocal) {
      const n = glassIndex(firstLens, wavelengthNm);
      expressions.push({
        title: '厚透镜制造者公式',
        latex: String.raw`\frac{1}{f}=(n-1)\left(\frac{1}{R_1}-\frac{1}{R_2}+\frac{(n-1)d}{n R_1 R_2}\right)`,
        preset: {
          knowledgeId: 'lensmaker-thick',
          opticsValues: {
            n: Number(n.toFixed(4)),
            R1: firstLens.frontRadiusMm,
            R2: firstLens.backRadiusMm,
            d: firstLens.centerThicknessMm,
          },
        },
        presetLabel: '代入计算',
      });
      derivations.push({
        label: '实体透镜焦距与后焦距',
        latex: String.raw`n(${formatCompact(wavelengthNm, 4)}\text{ nm}) \approx ${formatCompact(n, 4)},\quad f \approx ${formatCompact(firstFocal.effective, 4)}\text{ mm},\quad \text{BFL} \approx ${formatCompact(firstFocal.back, 4)}\text{ mm}`,
      });
    } else {
      expressions.push({
        title: '薄透镜物像公式',
        latex: String.raw`\frac{1}{v}-\frac{1}{u}=\frac{1}{f}`,
        preset: firstFocal
          ? { knowledgeId: 'thin-lens', opticsValues: { f: firstFocal.effective } }
          : { knowledgeId: 'thin-lens' },
        presetLabel: '代入计算',
      });
    }
    expressions.push({
      title: '几何光线追迹包络',
      latex: String.raw`y(z)=\left|\frac{z-z_{\text{focus}}}{f}\right|\,y_{\text{lens}}`,
    });
    if (firstLens && firstFocal && laser) {
      const axis = primaryAxisInfo(laser, firstLens, scanField);
      const focusCoord = firstLens.position[axis.index] + firstFocal.back;
      const sampleDist = screen
        ? Math.abs(screen.position[axis.index] - focusCoord)
        : Math.abs(firstFocal.effective * 0.5);
      const edgeRadius = Math.abs(sampleDist / firstFocal.effective) * laser.beamRadiusMm;
      derivations.push({
        label: '理想几何会聚点与边缘包络',
        latex: String.raw`${axis.symbol}_{\text{focus}} \approx ${formatCompact(focusCoord, 4)}\text{ mm},\qquad \text{偏离焦面 }${formatCompact(sampleDist, 4)}\text{ mm 处 }y \approx ${formatLengthTex(edgeRadius)}`,
      });
    } else if (firstLens && firstFocal) {
      derivations.push({
        label: '透镜参数',
        latex: String.raw`f = ${formatCompact(firstFocal.effective, 4)}\text{ mm},\qquad D = ${formatCompact(firstLens.diameterMm, 4)}\text{ mm}`,
      });
    }
    return { expressions, derivations, extraLinks };
  }

  if (laser?.beamModel === 'gaussian') {
    const wavelengthMm = laser.wavelengthNm * 1e-6;
    const zR = (Math.PI * laser.beamRadiusMm * laser.beamRadiusMm) / wavelengthMm;
    const distanceMm = screen
      ? Math.hypot(
          screen.position[0] - laser.position[0],
          screen.position[1] - laser.position[1],
          screen.position[2] - laser.position[2],
        )
      : 150;
    const baseValues: Partial<FormulaValues> = {
      wavelengthNm: laser.wavelengthNm,
      waistMm: laser.beamRadiusMm,
      distanceMm,
    };

    expressions.push({
      title: '高斯光束传输半径',
      latex: String.raw`w(d)=w_0\sqrt{1+\left(\frac{d}{z_R}\right)^2}`,
      preset: { formulaId: 'radius', values: baseValues },
      presetLabel: '代入计算',
    });
    expressions.push({
      title: '瑞利长度',
      latex: String.raw`z_R=\frac{\pi w_0^2}{\lambda}`,
      preset: { formulaId: 'rayleigh', values: baseValues },
      presetLabel: '代入计算',
    });
    if (lenses.length > 0) {
      expressions.push({
        title: '薄透镜复参数变换（ABCD 法则）',
        latex: String.raw`\frac{1}{q_{\text{出}}}=\frac{1}{q_{\text{入}}}-\frac{1}{f},\qquad \frac{1}{q(z)}=\frac{1}{R(z)}-\mathrm{i}\frac{\lambda}{\pi w^2(z)}`,
      });
    }

    derivations.push({
      label: '输入光束瑞利长度',
      latex: String.raw`z_R = \frac{\pi \times ${formatCompact(laser.beamRadiusMm, 4)}^2}{${formatCompact(wavelengthMm, 4)}} \approx ${formatCompact(zR, 4)}\text{ mm}`,
    });

    if (firstLens && firstFocal) {
      const f = firstFocal.effective;
      const dLens = Math.hypot(
        firstLens.position[0] - laser.position[0],
        firstLens.position[1] - laser.position[1],
        firstLens.position[2] - laser.position[2],
      );
      const denom = (1 - dLens / f) ** 2 + (zR / f) ** 2;
      const w0FocusExact = denom > 0 ? laser.beamRadiusMm / Math.sqrt(denom) : 0;
      const focalShift = (f * f * (dLens - f)) / ((dLens - f) ** 2 + zR * zR);
      const zWaistFromLens = f + focalShift;
      const axis = primaryAxisInfo(laser, firstLens, scanField);
      const lensCoord = firstLens.position[axis.index];
      const waistCoord = lensCoord + zWaistFromLens;

      derivations.push({
        label: '透镜聚焦像方束腰',
        latex: String.raw`w_0' = \frac{w_0}{\sqrt{\left(1-\frac{d_{\text{镜}}}{f}\right)^2+\left(\frac{z_R}{f}\right)^2}} \approx ${formatLengthTex(w0FocusExact)}`,
      });
      derivations.push({
        label: `像方束腰坐标（${axis.symbol.toUpperCase()} 轴）`,
        latex: String.raw`d' = f + \frac{f^2(d_{\text{镜}}-f)}{(d_{\text{镜}}-f)^2+z_R^2} \approx ${formatCompact(zWaistFromLens, 4)}\text{ mm}\implies ${axis.symbol}' = ${formatCompact(lensCoord, 4)} + ${formatCompact(zWaistFromLens, 4)} \approx ${formatCompact(waistCoord, 4)}\text{ mm}`,
      });
      extraLinks.push({
        label: '薄透镜物像公式',
        preset: { knowledgeId: 'thin-lens', opticsValues: { f } },
      });
    }

    if (artifact.kind === 'design' && artifact.data.recommendation) {
      const rec = artifact.data.recommendation;
      derivations.push({
        label: '推荐方案焦距与最小束腰对比',
        latex: String.raw`\text{推荐 } f = ${formatCompact(rec.focalLengthMm, 4)}\text{ mm},\quad \text{透镜位置 } ${formatCompact(rec.positionMm, 4)}\text{ mm}${rec.radiusMm !== null ? String.raw`,\quad w_{\text{屏}} = ${formatLengthTex(rec.radiusMm)}` : ''}`,
      });
    } else if (artifact.kind === 'study') {
      const tol = artifact.data.tolerance;
      derivations.push({
        label: '误差设置范围',
        latex: String.raw`\Delta z = \pm ${formatCompact(tol.positionErrorMm, 4)}\text{ mm},\qquad \frac{\Delta f}{f} = \pm ${formatCompact(tol.focalErrorPercent, 4)}\%`,
      });
    }
    return { expressions, derivations, extraLinks };
  }

  if (elements.some(e => e.kind === 'dispersion-prism' || e.kind === 'right-prism')) {
    expressions.push(
      {
        title: '折射定律',
        latex: String.raw`n_1\sin\theta_1=n_2\sin\theta_2`,
        preset: { knowledgeId: 'snell-law' },
        presetLabel: '代入计算',
      },
      {
        title: '三棱镜偏向角',
        latex: String.raw`\delta = i + e - A`,
        preset: { knowledgeId: 'prism-deviation' },
        presetLabel: '代入计算',
      },
    );
  } else if (elements.some(e => e.kind === 'polarizer' || e.kind === 'quarter-wave-plate' || e.kind === 'half-wave-plate')) {
    expressions.push({
      title: '马吕斯定律',
      latex: String.raw`I=I_0\cos^2\theta`,
      preset: { knowledgeId: 'malus-power' },
      presetLabel: '代入计算',
    });
  } else if (elements.some(e => e.kind === 'slit' || e.kind === 'amplitude-grating' || e.kind === 'aperture')) {
    expressions.push({
      title: '夫琅禾费单缝衍射',
      latex: String.raw`I(\theta)=I_0\left(\frac{\sin\beta}{\beta}\right)^2,\qquad \beta=\frac{\pi a\sin\theta}{\lambda}`,
      preset: { knowledgeId: 'single-slit-width' },
      presetLabel: '代入计算',
    });
  } else if (firstLens && isPhysicalLens(firstLens.kind) && firstFocal) {
    const n = glassIndex(firstLens, wavelengthNm);
    expressions.push({
      title: '厚透镜制造者公式',
      latex: String.raw`\frac{1}{f}=(n-1)\left(\frac{1}{R_1}-\frac{1}{R_2}+\frac{(n-1)d}{n R_1 R_2}\right)`,
      preset: {
        knowledgeId: 'lensmaker-thick',
        opticsValues: {
          n: Number(n.toFixed(4)),
          R1: firstLens.frontRadiusMm,
          R2: firstLens.backRadiusMm,
          d: firstLens.centerThicknessMm,
        },
      },
      presetLabel: '代入计算',
    });
    derivations.push({
      label: '实体透镜焦距与后焦距',
      latex: String.raw`f \approx ${formatCompact(firstFocal.effective, 4)}\text{ mm},\qquad \text{BFL} \approx ${formatCompact(firstFocal.back, 4)}\text{ mm}`,
    });
  } else if (firstFocal) {
    expressions.push({
      title: '薄透镜物像公式',
      latex: String.raw`\frac{1}{v}-\frac{1}{u}=\frac{1}{f}`,
      preset: { knowledgeId: 'thin-lens', opticsValues: { f: firstFocal.effective } },
      presetLabel: '代入计算',
    });
  }

  return { expressions, derivations, extraLinks };
}
