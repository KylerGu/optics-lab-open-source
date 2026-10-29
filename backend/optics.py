"""Air, ideal thin lenses, scalar TEM00 Gaussian beam, forward paraxial rays.

Units: mm for all lengths, radians for ray angles; wavelength nm -> mm.
Sign convention: q = z + i*zR, 1/q = 1/R - i*lambda/(pi*w**2).
Screens are non-blocking sampling planes, not physical absorbers.
"""
from bisect import bisect_right
from dataclasses import dataclass
import math

from .models import Experiment, Laser, Lens, Screen

MODEL_VERSION = "air-thin-lens-tem00/1.0"


def multiply(left: tuple, right: tuple) -> tuple:
    a, b, c, d = left
    e, f, g, h = right
    return a * e + b * g, a * f + b * h, c * e + d * g, c * f + d * h


def beam_radius(q: complex, wavelength_mm: float) -> float:
    # This form avoids subtracting nearly equal quantities near a narrow waist.
    if q.imag <= 0 or not math.isfinite(abs(q)):
        raise ValueError("该装置的数值条件超出支持范围，请增大焦距或简化透镜组合。")
    radius = math.sqrt(wavelength_mm / math.pi / q.imag) * abs(q)
    if not math.isfinite(radius):
        raise ValueError("该装置的光束尺寸超出数值范围。")
    return radius


def relative_intensity(offset_mm: float, radius_mm: float) -> float:
    return math.exp(-2 * (offset_mm / radius_mm) ** 2)


@dataclass(frozen=True)
class Segment:
    start: float
    end: float
    q: complex


def simulate(experiment: Experiment, revision: int = 0, *, include_display: bool = True) -> dict:
    lasers = [item for item in experiment.elements if isinstance(item, Laser)]
    if len(lasers) != 1:
        raise ValueError("请添加一个激光光源，再运行计算。")
    source = lasers[0]
    if source.positionMm >= experiment.railLengthMm:
        raise ValueError("请将光源放在实验台末端之前，留出传播距离。")
    ordered = sorted(experiment.elements, key=lambda item: item.positionMm)
    for previous, following in zip(ordered, ordered[1:]):
        if abs(previous.positionMm - following.positionMm) < 1e-7:
            raise ValueError(f"{previous.name}与{following.name}位置重合，请分开后计算。")
    if any(item.positionMm < source.positionMm for item in ordered):
        raise ValueError("当前模型只计算光源右侧的传播，请把透镜和观察屏移到光源右侧。")
    lenses = [item for item in ordered if isinstance(item, Lens)]
    screens = [item for item in ordered if isinstance(item, Screen)]
    wavelength = source.wavelengthNm * 1e-6
    rayleigh = math.pi * source.waistMm ** 2 / wavelength
    q = complex(0, rayleigh)
    cursor = source.positionMm
    matrix = (1.0, 0.0, 0.0, 1.0)
    segments: list[Segment] = []
    warnings: list[str] = []
    aperture_checks = []
    initial_divergence = wavelength / (math.pi * source.waistMm)
    if initial_divergence > 0.1:
        warnings.append("光源发散角超过0.1 rad，近轴近似可能不可靠。")
    for lens in lenses:
        distance = lens.positionMm - cursor
        segments.append(Segment(cursor, lens.positionMm, q))
        q += distance
        matrix = multiply((1, distance, 0, 1), matrix)
        radius = beam_radius(q, wavelength)
        clipped_fraction = math.exp(-2 * ((lens.diameterMm / 2) / radius) ** 2)
        aperture_checks.append({"elementId": lens.id, "name": lens.name, "radiusMm": radius, "clippedFraction": clipped_fraction})
        if clipped_fraction > 0.01:
            warnings.append(f"{lens.name}口径预计截去{clipped_fraction * 100:.2f}%的理想高斯功率；未模拟截断与衍射，下游高斯结果仅作理想参考。")
        # 1/q_out = 1/q_in - 1/f. Radius is continuous at an ideal thin lens.
        q = 1 / (1 / q - 1 / lens.focalLengthMm)
        if wavelength / math.pi / q.imag > 0.1 ** 2:
            warnings.append(f"{lens.name}之后的高斯光束发散半角超过0.1 rad，近轴近似可能不可靠。")
        matrix = multiply((1, 0, -1 / lens.focalLengthMm, 1), matrix)
        cursor = lens.positionMm
    end = experiment.railLengthMm
    segments.append(Segment(cursor, end, q))
    matrix = multiply((1, end - cursor, 0, 1), matrix)
    starts = [segment.start for segment in segments]

    def q_at(position: float) -> complex:
        segment = segments[bisect_right(starts, position) - 1]
        return segment.q + (position - segment.start)

    def sample_at(position: float) -> dict:
        return {"positionMm": position, "radiusMm": beam_radius(q_at(position), wavelength)}

    # Explicit analytic minima supplement the display grid. A narrow focus cannot
    # disappear simply because it falls between two display samples.
    candidates = []
    for segment in segments:
        focus = min(segment.end, max(segment.start, segment.start - segment.q.real))
        candidates.extend([segment.start, segment.end, focus])
    minimum = min((sample_at(position) for position in candidates), key=lambda item: item["radiusMm"])
    positions = sorted(set([source.positionMm + (end - source.positionMm) * index / 500 for index in range(501)] + candidates + [screen.positionMm for screen in screens])) if include_display else []
    samples = [sample_at(position) for position in positions]
    ray_paths = []
    max_angle = 0.0
    for index in range(9):
        height = source.waistMm * (index - 4) / 4
        slope = 0.0
        ray_cursor = source.positionMm
        points = [{"positionMm": ray_cursor, "heightMm": height}]
        blocked_by = None
        for lens in lenses:
            height += slope * (lens.positionMm - ray_cursor)
            points.append({"positionMm": lens.positionMm, "heightMm": height})
            ray_cursor = lens.positionMm
            if abs(height) > lens.diameterMm / 2:
                blocked_by = lens.id
                break
            slope -= height / lens.focalLengthMm
            max_angle = max(max_angle, abs(slope))
        if blocked_by is None:
            points.append({"positionMm": end, "heightMm": height + slope * (end - ray_cursor)})
        if include_display:
            ray_paths.append({"initialHeightMm": source.waistMm * (index - 4) / 4, "points": points, "blockedBy": blocked_by})
    if max_angle > 0.1:
        warnings.append("示意光线的近轴斜率超过0.1，光线轨迹的近轴近似可能不可靠。")
    screen_results = []
    for screen in screens:
        radius = beam_radius(q_at(screen.positionMm), wavelength)
        # Zoom to the spot, but never show a region larger than the screen.
        half_extent = min(screen.sizeMm / 2, 3 * radius)
        offsets = [-half_extent + 2 * half_extent * index / 128 for index in range(129)] if include_display else []
        screen_results.append({
            "elementId": screen.id, "name": screen.name, "positionMm": screen.positionMm,
            "radiusMm": radius, "sizeMm": screen.sizeMm, "halfExtentMm": half_extent,
            "capturedFraction": math.erf(screen.sizeMm / (math.sqrt(2) * radius)) ** 2,
            "peakRelativeToSource": (source.waistMm / radius) ** 2,
            "profile": [{"offsetMm": offset, "relativeIntensity": relative_intensity(offset, radius)} for offset in offsets],
        })
    return {
        "revision": revision, "modelVersion": MODEL_VERSION,
        "inputSnapshot": experiment.model_dump(),
        "quality": "reference-only" if warnings else "within-model",
        "warnings": warnings, "sourcePositionMm": source.positionMm,
        "rayleighRangeMm": rayleigh, "minimum": minimum,
        "samples": samples, "rayPaths": ray_paths, "screens": screen_results,
        "apertureChecks": aperture_checks,
        "endMatrix": {"A": matrix[0], "B": matrix[1], "C": matrix[2], "D": matrix[3]},
        "assumptions": [
            "空气中同轴、理想薄透镜、近轴传播；不含像差、偏振或真实曲面折射。",
            "理想M²=1高斯光束；光源所在平面为束腰，半径按光强降至峰值1/e²定义。",
            "绿色几何光线在光源平面初始平行；高斯光束另含衍射发散，二者焦点不必相同。",
            "观察屏为不遮挡后续传播的采样平面；光强按本屏峰值归一化，无绝对功率单位。",
            "透镜口径用于光线遮挡检查和高斯截光风险评估；未计算截光后的波动场。",
        ],
    }
