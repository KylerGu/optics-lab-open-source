import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Crosshair, Maximize2, Minimize2, Palette } from 'lucide-react';
import type { SpatialExperiment, SpatialResult } from './builderModel';
import {
  describeStokesState,
  infernoColor,
  listProfilerDetectors,
  sampleDetectorField,
  selectProfilerDetector,
  wavelengthColorLut,
  type ProfilerPalette,
  type ProfilerZoomMode,
} from './spatialBeamProfiler';

interface Props {
  experiment: SpatialExperiment;
  result: SpatialResult | null;
  selectedId: string | null;
  onSelectDetector?: (id: string) => void;
}

const HEATMAP_PX = 128;

export default function SpatialBeamProfilerHud({
  experiment,
  result,
  selectedId,
  onSelectDetector,
}: Props) {
  const [collapsed, setCollapsed] = useState(true);
  const [palette, setPalette] = useState<ProfilerPalette>('inferno');
  const [zoomMode, setZoomMode] = useState<ProfilerZoomMode>('auto');
  const [preferredId, setPreferredId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const detectors = useMemo(
    () => listProfilerDetectors(experiment, result),
    [experiment, result],
  );
  const activeDetector = useMemo(
    () => selectProfilerDetector(experiment, result, selectedId, preferredId),
    [experiment, result, selectedId, preferredId],
  );
  const field = useMemo(
    () => (activeDetector ? sampleDetectorField(activeDetector, experiment, result, 48, zoomMode) : null),
    [activeDetector, experiment, result, zoomMode],
  );

  useEffect(() => {
    if (collapsed || !field) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = ctx.createImageData(HEATMAP_PX, HEATMAP_PX);
    const n = field.gridSize;
    for (let py = 0; py < HEATMAP_PX; py++) {
      const sy = Math.min(n - 1, Math.floor((py / HEATMAP_PX) * n));
      for (let px = 0; px < HEATMAP_PX; px++) {
        const sx = Math.min(n - 1, Math.floor((px / HEATMAP_PX) * n));
        const val = field.matrix[sy * n + sx];
        const [r, g, b] = palette === 'inferno'
          ? infernoColor(val)
          : wavelengthColorLut(val, field.wavelengthNm);
        const idx = (py * HEATMAP_PX + px) * 4;
        img.data[idx] = r;
        img.data[idx + 1] = g;
        img.data[idx + 2] = b;
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Crosshair
    const mid = HEATMAP_PX / 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(HEATMAP_PX, mid);
    ctx.moveTo(mid, 0);
    ctx.lineTo(mid, HEATMAP_PX);
    ctx.stroke();

    // 1/e^2 envelope ring
    if (field.radiusMm !== null && field.extentMm > 0) {
      const rxPx = ((field.radiusUMm ?? field.radiusMm) / field.extentMm) * (HEATMAP_PX / 2);
      const ryPx = ((field.radiusVMm ?? field.radiusMm) / field.extentMm) * (HEATMAP_PX / 2);
      if (rxPx > 2 && ryPx > 2 && rxPx < HEATMAP_PX && ryPx < HEATMAP_PX) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.ellipse(mid, mid, rxPx, ryPx, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
  }, [collapsed, field, palette]);

  if (!activeDetector || !field) return null;

  const uPoints = field.uProfile
    .map((v, i) => `${(i / Math.max(1, field.uProfile.length - 1)) * 128},${24 - v * 22}`)
    .join(' ');
  const vPoints = field.vProfile
    .map((v, i) => `${v * 22},${(i / Math.max(1, field.vProfile.length - 1)) * 128}`)
    .join(' ');
  const stokesInfo = field.stokes ? describeStokesState(field.stokes) : null;

  return (
    <aside className={`sb-profiler-hud ${collapsed ? 'is-collapsed' : ''}`} aria-label="实时光斑分析仪">
      <div className="sb-profiler-header">
        <div className="sb-profiler-title">
          <Crosshair size={13} />
          <span>CCD 光斑仪</span>
          {collapsed && <span className="sb-profiler-mode">{field.modeLabel}</span>}
        </div>
        <div className="sb-profiler-actions">
          {!collapsed && (
            <>
              <button
                type="button"
                className="sb-profiler-icon-btn"
                title={zoomMode === 'auto' ? '切换为全屏视场' : '切换为自适应局部放大'}
                onClick={() => setZoomMode((z) => (z === 'auto' ? 'full' : 'auto'))}
              >
                {zoomMode === 'auto' ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
              </button>
              <button
                type="button"
                className="sb-profiler-icon-btn"
                title={palette === 'inferno' ? '切换为真实波长配色' : '切换为 Inferno 伪彩'}
                onClick={() => setPalette((p) => (p === 'inferno' ? 'wavelength' : 'inferno'))}
              >
                <Palette size={13} />
              </button>
            </>
          )}
          <button
            type="button"
            className="sb-profiler-icon-btn"
            title={collapsed ? '展开光斑分析仪' : '折叠光斑分析仪'}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {detectors.length > 1 && (
            <div className="sb-profiler-detectors" role="tablist" aria-label="探测器切换">
              {detectors.map((det) => (
                <button
                  key={det.elementId}
                  type="button"
                  role="tab"
                  aria-selected={det.elementId === activeDetector.elementId}
                  className={det.elementId === activeDetector.elementId ? 'active' : ''}
                  onClick={() => {
                    setPreferredId(det.elementId);
                    onSelectDetector?.(det.elementId);
                  }}
                >
                  {det.name}
                </button>
              ))}
            </div>
          )}

          <div className="sb-profiler-stage">
            <svg className="sb-profiler-u-curve" viewBox="0 0 128 24" preserveAspectRatio="none" aria-hidden="true">
              <polyline fill="none" stroke="currentColor" strokeWidth="1.4" points={uPoints} />
            </svg>
            <div className="sb-profiler-row">
              <canvas
                ref={canvasRef}
                width={HEATMAP_PX}
                height={HEATMAP_PX}
                className="sb-profiler-canvas"
              />
              <svg className="sb-profiler-v-curve" viewBox="0 0 24 128" preserveAspectRatio="none" aria-hidden="true">
                <polyline fill="none" stroke="currentColor" strokeWidth="1.4" points={vPoints} />
              </svg>
            </div>
            <div className="sb-profiler-fov">
              <span className="sb-profiler-mode">{field.modeLabel}</span>
              <span>视场 ±{field.extentMm.toFixed(2)} mm</span>
            </div>
          </div>

          <div className="sb-profiler-metrics">
            <div>
              <span>功率</span>
              <strong>{field.powerMw.toFixed(2)} mW</strong>
            </div>
            <div>
              <span>半径</span>
              <strong>{field.radiusMm !== null ? `${field.radiusMm.toFixed(2)} mm` : '--'}</strong>
            </div>
            <div>
              <span>波长</span>
              <strong>{field.wavelengthNm.toFixed(0)} nm</strong>
            </div>
          </div>

          {stokesInfo && (
            <div className="sb-profiler-stokes">
              <svg width="20" height="20" viewBox="-12 -12 24 24" aria-hidden="true">
                <circle cx="0" cy="0" r="10" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" />
                <ellipse
                  cx="0"
                  cy="0"
                  rx="8.5"
                  ry={Math.max(1.2, 8.5 * stokesInfo.ellipticity)}
                  transform={`rotate(${(-stokesInfo.angleRad * 180) / Math.PI})`}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="1.6"
                />
              </svg>
              <span>{stokesInfo.label}</span>
            </div>
          )}
        </>
      )}
    </aside>
  );
}
