"""Bounded 3D geometric ray tracing for the free-space construction workspace.

Lengths are millimetres. Ideal lenses use the local paraxial thin-lens law;
spherical singlets use curved surfaces and Snell refraction. Gaussian envelopes are tracked
separately; sampled ray power does not include diffraction or interference.
"""
import math
from collections import deque
from typing import Annotated, Literal

from pydantic import Field, model_validator
from .models import StrictModel
from .spherical_lenses import default_radii
from .profile_lenses import PHYSICAL_KINDS, CYLINDER_KINDS, physical_lens_hit as lens_hit, validate_physical_lens as validate_lens, within_clear_aperture
from .spatial_components import (basis, diffraction_profile, index_at, interface, polarize,
                                 prism_hit, slit_passes, source_modes, transport, waveplate, stokes, polarization_split)

from .amplitude_grating import grating_count, grating_mount_radius, grating_orders, grating_passes, grating_profile
from .spatial_four_f import calculate_spatial_four_f
from .spatial_fourier import calculate_spatial_fourier

Coordinate = Annotated[float, Field(ge=-1000, le=1000)]
Vec = tuple[float, float, float]


class SpatialElement(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=40)
    kind: Literal["object", "eye", "sensor", "laser", "lens", "plano-convex-lens", "biconvex-lens", "plano-concave-lens", "biconcave-lens", "positive-meniscus-lens", "negative-meniscus-lens", "aspheric-convex-lens", "aspheric-concave-lens", "plano-convex-cylinder-lens", "plano-concave-cylinder-lens", "cylindrical-lens", "half-wave-plate", "quarter-wave-plate", "polarizing-splitter", "mirror", "splitter", "screen", "aperture", "filter", "right-prism", "dispersion-prism", "polarizer", "slit", "amplitude-grating", "power-meter"]
    objectMode: Literal['finite','distant'] = 'finite'
    angularHeightDeg: float = Field(default=.6, ge=.01, le=3)
    incidentAngleDeg: float = Field(default=0, ge=-3, le=3)
    objectPattern: Literal['F','arrow'] = 'F'
    objectHeightMm: float = Field(default=10, ge=.001, le=200)
    objectWidthMm: float = Field(default=6, ge=.001, le=200)
    sensorWidthMm: float = Field(default=8.8, ge=.1, le=200)
    sensorHeightMm: float = Field(default=6.6, ge=.1, le=200)
    adapterMagnification: float = Field(default=1, ge=.1, le=10)
    nearDistanceMm: float = Field(default=250, ge=100, le=1000)
    fieldNumberMm: float = Field(default=18, ge=1, le=100)
    position: tuple[Coordinate, Coordinate, Coordinate]
    yawDeg: float = Field(default=0, ge=-180, le=180)
    pitchDeg: float = Field(default=0, ge=-90, le=90)
    diameterMm: float = Field(default=40, ge=1, le=200)
    focalLengthMm: float = Field(default=100, ge=-5000, le=5000)
    beamRadiusMm: float = Field(default=4, ge=0.01, le=20)
    wavelengthNm: float = Field(default=532, ge=380, le=1100)
    transmission: float = Field(default=0.5, ge=0, le=1)
    beamModel: Literal["parallel", "gaussian"] = "parallel"
    waistOffsetMm: float = Field(default=0, ge=-2000, le=2000)
    probeOffsetMm: float = Field(default=0, ge=-100, le=100)
    slitMode: Literal['pass','stop'] = 'pass'
    gratingProfile: Literal['binary','sinusoidal'] = 'binary'
    gratingModulation: float = Field(default=1, ge=0, le=1)
    powerMw: float = Field(default=10, ge=0, le=1000)
    divergenceMrad: float = Field(default=0, ge=0, le=100)
    rayCount: int = Field(default=9, ge=1, le=201, strict=True)
    rollDeg: float = Field(default=0, ge=-180, le=180)
    polarization: Literal["linear", "unpolarized"] = "linear"
    polarizationDeg: float = Field(default=0, ge=-180, le=180)
    glass: Literal["bk7", "custom"] = "bk7"
    refractiveIndex: float = Field(default=1.5168, ge=1, le=2.5)
    abbeNumber: float = Field(default=64.17, ge=10, le=1000)
    apexAngleDeg: float = Field(default=60, ge=20, le=100)
    prismHeightMm: float = Field(default=40, ge=1, le=200)
    slitWidthMm: float = Field(default=.1, ge=.001, le=20)
    slitHeightMm: float = Field(default=20, ge=.01, le=200)
    meterRangeMw: float = Field(default=100, ge=.001, le=3000)
    designWavelengthNm: float = Field(default=532, ge=380, le=1100)
    pTransmission: float = Field(default=1, ge=0, le=1)
    sTransmission: float = Field(default=0, ge=0, le=1)
    frontRadiusMm: float = Field(default=50, ge=.5, le=5000)
    backRadiusMm: float = Field(default=100, ge=.5, le=5000)
    centerThicknessMm: float = Field(default=5, ge=.1, le=200)

    clearApertureMm: float = Field(default=40, ge=.1, le=200)
    clearWidthMm: float = Field(default=25, ge=.1, le=200)
    clearHeightMm: float = Field(default=25, ge=.1, le=200)

    conicConstant: float = Field(default=-1, ge=-10, le=10)
    asphericA4: float = Field(default=0, ge=-.001, le=.001)
    asphericA6: float = Field(default=0, ge=-.00001, le=.00001)
    cylinderWidthMm: float = Field(default=25, ge=1, le=200)
    cylinderHeightMm: float = Field(default=25, ge=1, le=200)

    gratingPeriodUm: float = Field(default=10, ge=1000/1200, le=400)
    gratingSlitUm: float = Field(default=5, ge=.01, le=50)
    gratingWidthMm: float = Field(default=1, ge=.01, le=50)
    gratingHeightMm: float = Field(default=20, ge=.01, le=200)

    @model_validator(mode="before")
    @classmethod
    def apparatus_defaults(cls, data):
        if isinstance(data,dict):
            data=dict(data)
            if data.get('kind') in {'half-wave-plate','quarter-wave-plate','amplitude-grating'}:
                data.setdefault('transmission',1)
            if data.get('kind')=='quarter-wave-plate':data.setdefault('rollDeg',45)
            if data.get('kind')=='polarizing-splitter':data.setdefault('yawDeg',-45)
            if data.get('kind') in PHYSICAL_KINDS:
                data.setdefault('diameterMm',25)
                front,back=default_radii(data['kind'])
                data.setdefault('frontRadiusMm',front)
                data.setdefault('backRadiusMm',back)
            data.setdefault('clearApertureMm',data.get('diameterMm',40))
            data.setdefault('clearWidthMm',data.get('cylinderWidthMm',25))
            data.setdefault('clearHeightMm',data.get('cylinderHeightMm',25))
        return data

    @model_validator(mode="after")
    def valid_element(self):
        if not self.id.strip() or not self.name.strip():
            raise ValueError("器件名称和编号不能为空。")
        if self.kind in {"lens", "cylindrical-lens"} and abs(self.focalLengthMm) < 1:
            raise ValueError("透镜焦距绝对值至少为 1 mm。")
        if self.kind == "amplitude-grating":
            if self.gratingProfile=='binary' and (self.gratingPeriodUm>50 or self.gratingSlitUm>self.gratingPeriodUm) or self.gratingWidthMm+1e-10 < 2*self.gratingPeriodUm*.001:
                raise ValueError("透光条纹宽度 a 不能超过周期 d，通光宽度 W 至少覆盖两个周期。")
        if self.objectMode=='distant' and self.objectPattern!='F':
            raise ValueError('远处样品目前使用 F 图案。')
        validate_lens(self)
        return self


class MicroscopePresentation(StrictModel):
    kind: Literal['microscope']
    objectId: str = Field(min_length=1, max_length=100)
    objectiveId: str = Field(min_length=1, max_length=100)
    relayId: str = Field(min_length=1, max_length=100)
    observerId: str = Field(min_length=1, max_length=100)


class SpatialExperiment(StrictModel):
    schemaVersion: Literal[2]
    name: str = Field(min_length=1, max_length=80)
    elements: list[SpatialElement] = Field(max_length=50)
    presentation: MicroscopePresentation | None = None

    @model_validator(mode="after")
    def valid_experiment(self):
        ids = [e.id for e in self.elements]
        if not self.name.strip() or len(ids) != len(set(ids)):
            raise ValueError("实验名称为空或器件编号重复。")
        if sum(e.kind == "laser" for e in self.elements) > 3:
            raise ValueError("当前最多支持三个光源。")
        return self


class SpatialRequest(StrictModel):
    revision: int = Field(ge=0, le=2_147_483_647)
    experiment: SpatialExperiment


def add(a: Vec, b: Vec) -> Vec:
    return tuple(x + y for x, y in zip(a, b))


def mul(a: Vec, k: float) -> Vec:
    return tuple(x * k for x in a)


def sub(a: Vec, b: Vec) -> Vec:
    return add(a, mul(b, -1))


def dot(a: Vec, b: Vec) -> float:
    return sum(x * y for x, y in zip(a, b))


def cross(a: Vec, b: Vec) -> Vec:
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


def norm(a: Vec) -> Vec:
    length = math.sqrt(dot(a, a))
    if length < 1e-12:
        raise ValueError("光线方向无效。")
    return mul(a, 1 / length)


def normal(e: SpatialElement) -> Vec:
    yaw, pitch = math.radians(e.yawDeg), math.radians(e.pitchDeg)
    return (math.cos(pitch)*math.cos(yaw), math.sin(pitch), math.cos(pitch)*math.sin(yaw))


def frame(n: Vec) -> tuple[Vec, Vec]:
    u = norm(cross(n, (0, 1, 0) if abs(n[1]) < .9 else (0, 0, 1)))
    return u, cross(n, u)


def reflected(d: Vec, n: Vec) -> Vec:
    return norm(sub(d, mul(n, 2 * dot(d, n))))


def thin_lens_direction(direction, normal_axis, local, focal_length):
    axial = dot(direction, normal_axis)
    forward = mul(normal_axis, 1 if axial > 0 else -1)
    slope = mul(sub(direction, mul(forward, dot(direction, forward))), 1/abs(axial))
    return norm(add(forward, sub(slope, mul(local, 1/focal_length))))


def sample_offsets(radius, count):
    """Balanced equal-area disk sampling, including the chief and outer radius.

    Opposite pairs avoid a spurious centroid shift. An odd peripheral count uses
    one balanced triplet. Increasing ray count refines aperture-power estimates.
    These are geometric samples, not an exact Gaussian irradiance integral.
    """
    offsets = [(0., 0.)]
    remaining = count - 1
    if remaining == 0:
        return offsets
    if remaining == 1:
        return offsets + [(radius, 0.)]
    used = 0
    if remaining % 2:
        ring = radius * math.sqrt(3 / remaining)
        offsets.extend((ring * math.cos(i * 2 * math.pi / 3), ring * math.sin(i * 2 * math.pi / 3)) for i in range(3))
        used = 3
    golden_angle = math.pi * (3 - math.sqrt(5))
    for i in range((remaining - used) // 2):
        ring = radius * math.sqrt((used + 2 * (i + 1)) / remaining)
        a, b = ring * math.cos(i * golden_angle), ring * math.sin(i * golden_angle)
        offsets.extend([(a, b), (-a, -b)])
    return offsets


def trace(experiment: SpatialExperiment, revision: int = 0):
    sources = [e for e in experiment.elements if e.kind == "laser"]
    if not sources and not any(e.kind=="object" for e in experiment.elements):
        raise ValueError("请先添加一个光源，再运行仿真。")
    targets = [e for e in experiment.elements if e.kind not in {"laser", "object", "eye", "sensor"}]
    segments, beams, warnings, chief_hits = [], [], set(), set()
    four_f=calculate_spatial_four_f(experiment)
    fourier=calculate_spatial_fourier(experiment)
    coherent=four_f or fourier
    if not coherent and any(e.kind=='amplitude-grating' and e.gratingProfile=='sinusoidal' for e in experiment.elements):
        if sum(e.kind=='lens' for e in experiment.elements)==1:
            warnings.add('当前装置不满足前后焦面傅里叶计算条件：检查共轴、输入与屏距透镜均为 f、输入束腰和通光口径；当前仅显示几何光路。')
        else:warnings.add('当前装置不满足 4f 波动计算条件：检查共轴、等焦距、f / 2f / f 间距、输入束腰、通光口径及滤波片所在焦面；当前仅显示几何光路。')
    screen_hits = {e.id: [] for e in targets if e.kind in {"screen", "power-meter"}}
    screen_polarization = {e.id: [] for e in targets if e.kind in {"screen", "power-meter"}}
    gaussian_radii = {e.id: [] for e in targets if e.kind in {"screen", "power-meter"}}
    slit_events = []
    grating_events, grating_evidence = [], {}
    queue = deque()
    total_power = sum(source.powerMw for source in sources)
    if sources and total_power == 0:
        warnings.add("光源的发射功率均为 0，当前没有出射光线。")
    for source in sources:
        d = normal(source)
        u, v = frame(d)
        count = source.rayCount
        q = complex(-source.waistOffsetMm, math.pi*source.beamRadiusMm**2/(source.wavelengthNm*1e-6)) if source.beamModel == "gaussian" else None
        radius = source.beamRadiusMm*math.sqrt(1+(source.waistOffsetMm/q.imag)**2) if q is not None else source.beamRadiusMm
        offsets = sample_offsets(radius, count)
        for i, (a, b) in enumerate(offsets):
            slope = math.tan(source.divergenceMrad/1000) if source.beamModel == "parallel" else 0
            outgoing = norm(add(d, add(mul(u, slope*a/source.beamRadiusMm), mul(v, slope*b/source.beamRadiusMm))))
            queue.append((add(source.position, add(mul(u, a), mul(v, b))), outgoing,
                          source.powerMw/(count*max(total_power,1e-12)), source.id, i == 0, 0, source.id, q, source.wavelengthNm*1e-6,
                          transport(source_modes(source,d),d,outgoing)))
    while queue and len(segments) < 3000:
        origin, d, power, source_id, chief, steps, previous, q, wavelength, modes = queue.popleft()
        if power < 1e-15:
            continue
        if steps >= 32:
            warnings.add("部分光线反复折返，已在 32 次交互后停止追踪。")
            continue
        nearest = None
        for e in targets:
            if e.id == previous:
                continue
            if e.kind in PHYSICAL_KINDS:
                intersection=lens_hit(e,origin,d)
                if intersection and (nearest is None or intersection[0]<nearest[0]):
                    distance,hit,n,_=intersection
                    nearest=distance,e,hit,n,sub(hit,e.position)
                continue
            if e.kind in {"right-prism", "dispersion-prism"}:
                intersection=prism_hit(e,origin,d)
                if intersection and (nearest is None or intersection[0]<nearest[0]):
                    distance,hit,n=intersection
                    nearest=distance,e,hit,n,sub(hit,e.position)
                continue
            n = normal(e)
            denominator = dot(d, n)
            if abs(denominator) < 1e-8:
                continue
            distance = dot(sub(e.position, origin), n) / denominator
            if distance <= 1e-5 or distance > 2000:
                continue
            hit = add(origin, mul(d, distance))
            local = sub(hit, e.position)
            # Aperture is an opaque circular plate with an adjustable clear hole.
            radius = grating_mount_radius(e) if e.kind=='amplitude-grating' else max(30, e.diameterMm / 2 + 10) if e.kind == "aperture" else max(30,e.slitHeightMm/2+10,e.slitWidthMm/2+10) if e.kind == "slit" else e.diameterMm / 2
            if dot(local, local) > radius**2 + 1e-7:
                continue
            if nearest is None or distance < nearest[0]:
                nearest = distance, e, hit, n, local
        end = nearest[2] if nearest else add(origin, mul(d, 450))
        distance = nearest[0] if nearest else 450
        propagated_q = q + distance if q is not None else None
        if chief and q is not None:
            radii = [math.sqrt(-wavelength/(math.pi*(1/(q+distance*i/32)).imag)) for i in range(33)]
            source = next(s for s in sources if s.id == source_id)
            beams.append({"start":origin, "end":end, "radiiMm":radii, "sourceId":source_id, "powerMw":power*total_power*source.rayCount})
        segments.append({"start": origin, "end": end, "power": power,
                         "powerMw": power*total_power,
                         "sourceId": source_id, "chief": chief,
                         "hitId": nearest[1].id if nearest else None, "fromId":previous})
        if not nearest:
            continue
        _, e, hit, n, local = nearest
        if chief:
            chief_hits.add(e.id)
            if propagated_q is not None and e.kind not in {"screen", "power-meter"}:
                gaussian_radius = math.sqrt(-wavelength/(math.pi*(1/propagated_q).imag))
                if gaussian_radius*4 > (min(e.gratingWidthMm,e.gratingHeightMm) if e.kind=='amplitude-grating' else min(e.clearWidthMm,e.clearHeightMm) if e.kind in CYLINDER_KINDS else e.clearApertureMm if e.kind in PHYSICAL_KINDS else e.diameterMm):
                    warnings.add(f"{e.name}可能限制高斯光束口径；当前包络未计算截光后的衍射。")
        if e.kind in {"screen", "power-meter"}:
            screen_hits[e.id].append((hit, power))
            screen_polarization[e.id].append((stokes(modes,d,e),power))
            if chief and propagated_q is not None:
                gaussian_radii[e.id].append(math.sqrt(-wavelength/(math.pi*(1/propagated_q).imag)))
            continue
        if e.kind == "aperture" and dot(local, local) > (e.diameterMm/2)**2 + 1e-7:
            continue
        if e.kind == "slit":
            if not slit_passes(e,hit): continue
            if chief: slit_events.append((e,next(s for s in sources if s.id==source_id),hit,d))
            propagated_q=None
        if e.kind == "amplitude-grating":
            if not grating_passes(e,hit):continue
            _,period_axis,_=basis(e)
            if abs(dot(local,period_axis))>grating_count(e)*e.gratingPeriodUm*.001/2+1e-9:
                continue  # opaque margins around the complete, centred periods
            orders = grating_orders(e,d,wavelength)
            if chief:
                key = (e.id,source_id)
                if key not in grating_evidence:
                    grating_evidence[key] = {"gratingId":e.id,"sourceId":source_id,"incident":d,"orders":orders}
                elif grating_evidence[key]["incident"] != d:
                    warnings.add(f"{e.name}有多路入射，级次表仅显示首条主轴；未计算多路相干叠加。")
                if previous == source_id:
                    grating_events.append((e,next(s for s in sources if s.id==source_id),hit,d))
                else:
                    warnings.add(f"{e.name}级次方向已计算；光强剖面暂需光源直接照射光栅。")
            for order in orders:
                if order['efficiency'] > 0:
                    outgoing=order['direction']
                    queue.append((hit,outgoing,power*order['efficiency'],source_id,chief,steps+1,e.id,None,wavelength,transport(modes,d,outgoing)))
            continue
        if e.kind in PHYSICAL_KINDS:
            entry=lens_hit(e,origin,d)
            if entry[3]=='edge' or not within_clear_aperture(e,hit): continue
            glass_index=index_at(e,wavelength*1e6)
            outgoing,modes,fraction,_=interface(d,n,1,glass_index,modes)
            next_power=power*fraction;cursor=hit
            if chief and q is not None:
                warnings.add(f"{e.name}之后显示实际曲面折射的几何光线；暂不计算实体透镜后的高斯包络。")
            for bounce in range(16):
                intersection=lens_hit(e,cursor,outgoing,inside=True)
                if not intersection: break
                _,exit_hit,exit_normal,face=intersection
                if len(segments)>=3000 or steps+bounce+1>=32:
                    warnings.add("实体透镜内部光线已达到追踪上限，停止追踪。")
                    break
                segments.append({"start":cursor,"end":exit_hit,"power":next_power,"powerMw":next_power*total_power,
                                 "sourceId":source_id,"chief":chief,"hitId":e.id,"fromId":e.id})
                if face=='edge' or not within_clear_aperture(e,exit_hit): break
                outgoing,modes,fraction,tir=interface(outgoing,exit_normal,glass_index,1,modes)
                next_power*=fraction;cursor=exit_hit
                if not tir:
                    queue.append((cursor,outgoing,next_power,source_id,chief,steps+bounce+2,e.id,None,wavelength,modes))
                    break
            else: warnings.add(f"{e.name}内部反射次数达到上限，停止追踪。")
            continue
        if e.kind in {"right-prism", "dispersion-prism"}:
            glass_index=index_at(e,wavelength*1e6)
            outgoing,modes,fraction,tir=interface(d,n,1,glass_index,modes)
            next_power=power*fraction
            cursor=hit
            if chief and q is not None:
                warnings.add(f"{e.name}之后仅计算几何光线，尚不提供棱镜内的高斯包络与像散。")
            # Refract through the solid, tracing every internal reflection and actual exit face.
            for bounce in range(16):
                intersection=prism_hit(e,cursor,outgoing,inside=True)
                if not intersection: break
                _,exit_hit,exit_normal=intersection
                if len(segments)>=3000 or steps+bounce+1>=32:
                    warnings.add("棱镜内部光线已达到追踪上限，停止追踪。")
                    break
                segments.append({"start":cursor,"end":exit_hit,"power":next_power,"powerMw":next_power*total_power,
                                 "sourceId":source_id,"chief":chief,"hitId":e.id,"fromId":e.id})
                outgoing,modes,fraction,tir=interface(outgoing,exit_normal,glass_index,1,modes)
                next_power*=fraction; cursor=exit_hit
                if not tir:
                    queue.append((cursor,outgoing,next_power,source_id,chief,steps+bounce+2,e.id,None,wavelength,modes))
                    break
            else:
                warnings.add(f"{e.name}内部反射次数达到上限，停止追踪。")
            continue
        directions = [(d, power)]
        if e.kind == "polarizing-splitter":
            transmitted,reflected_modes=polarization_split(e,d,modes)
            for outgoing,(branch_modes,fraction) in [(d,transmitted),(reflected(d,n),reflected_modes)]:
                queue.append((hit,outgoing,power*fraction,source_id,chief,steps+1,e.id,propagated_q,wavelength,transport(branch_modes,d,outgoing)))
            if abs(abs(dot(d,n))-math.sqrt(.5))>.08:
                warnings.add(f"{e.name}采用理想偏振分光面；当前偏离45°入射，未计算真实镀膜的角度和波长变化。")
            continue
        if e.kind == "mirror":
            directions = [(reflected(d, n), power)]
        elif e.kind == "splitter":
            directions = [(d, power*e.transmission), (reflected(d, n), power*(1-e.transmission))]
        elif e.kind == "filter":
            directions = [(d, power*e.transmission)]
        elif e.kind == "polarizer":
            modes,fraction=polarize(e,d,modes)
            directions=[(d,power*fraction*e.transmission)]
            if abs(dot(d,n))<.98: warnings.add(f"{e.name}为理想偏振片，倾斜入射仅按透光轴投影估计。")
        elif e.kind in {"half-wave-plate", "quarter-wave-plate"}:
            modes=waveplate(e,d,modes,wavelength*1e6)
            directions=[(d,power*e.transmission)]
            if abs(dot(d,n))<.98: warnings.add(f"{e.name}倾斜入射仅投影快轴，未计算晶体角度相关延迟。")
            if abs(wavelength*1e6-e.designWavelengthNm)>1e-6: warnings.add(f"{e.name}偏离设计波长，按恒定双折射的零级延迟近似，未使用实测色散。")
        elif e.kind in {"lens", "cylindrical-lens"}:
            axial = dot(d, n)
            if abs(axial) < .98:
                warnings.add(f"{e.name}入射角较大，薄透镜近轴近似仅供参考。")
            forward = mul(n, 1 if axial > 0 else -1)
            slope = mul(sub(d, mul(forward, dot(d, forward))), 1/abs(axial))
            focus_offset = local
            if e.kind == "cylindrical-lens":
                _, axis, _ = basis(e)
                focus_offset = mul(axis, dot(local, axis))
                if propagated_q is not None:
                    warnings.add(f"{e.name}之后只显示单方向聚焦的几何光线，尚不计算椭圆高斯包络。")
                propagated_q = None
            outgoing = thin_lens_direction(d, n, focus_offset, e.focalLengthMm)
            directions = [(outgoing, power)]
            if propagated_q is not None:
                propagated_q = 1/(1/propagated_q-1/e.focalLengthMm)
        for outgoing, next_power in directions:
            queue.append((hit, outgoing, next_power, source_id, chief, steps+1, e.id, propagated_q, wavelength, transport(modes,d,outgoing)))
    if queue:
        warnings.add("分支过多，已达到本次光线追踪上限。")
    screens = []
    for e in targets:
        if e.kind not in {"screen", "power-meter"}:
            continue
        hits = screen_hits[e.id]
        power = sum(p for _, p in hits)
        centroid = tuple(sum(pos[i]*p for pos, p in hits)/power for i in range(3)) if power else None
        radius = max((math.sqrt(dot(sub(pos, centroid), sub(pos, centroid))) for pos, _ in hits), default=None) if centroid else None
        _, su, sv = basis(e)
        radius_u = max((abs(dot(sub(pos,centroid),su)) for pos,_ in hits), default=None) if centroid else None
        radius_v = max((abs(dot(sub(pos,centroid),sv)) for pos,_ in hits), default=None) if centroid else None
        pol_hits=screen_polarization[e.id]
        polarization = {"s1":sum(s[0]*p for s,p in pol_hits)/power,"s2":sum(s[1]*p for s,p in pol_hits)/power,"s3":sum(s[2]*p for s,p in pol_hits)/power} if power and all(s is not None for s,p in pol_hits) else None
        screens.append({"elementId": e.id, "name": e.name, "hits": len(hits),
                        "sampledPowerFraction": power, "centroid": centroid, "footprintRadiusMm": radius,
                        "sampledPowerMw": power*total_power,
                        "sampledRadiusUMm": radius_u, "sampledRadiusVMm": radius_v,
                        "polarizationStokes": polarization,
                        "gaussianRadiusMm": gaussian_radii[e.id][0] if len(gaussian_radii[e.id]) == 1 else None,
                        **({"detectorKind":"power-meter","readingMw":power*total_power if power*total_power<=e.meterRangeMw+1e-8 else None,
                            "overRange":power*total_power>e.meterRangeMw+1e-8} if e.kind=="power-meter" else {})})
        if e.kind=="power-meter" and power*total_power>e.meterRangeMw+1e-8:
            warnings.add(f"{e.name}超过 {e.meterRangeMw:g} mW 量程，请增大量程或降低入射功率。")
        if sources and not hits and not (coherent and coherent['screenId']==e.id and coherent['capturedPowerMw']>0):
            warnings.add(f"光线尚未到达{e.name}，请检查位置和朝向。")
    diffraction=[]
    for slit,source,hit,d in slit_events:
        if four_f and slit.id==four_f['filterId']:continue
        if slit.slitMode=='stop':
            warnings.add(f'{slit.name}当前仅计算几何遮光；符合4f条件时可查看波动输出。')
            continue
        found=False
        # An intervening optic invalidates the direct Fraunhofer section (including off-axis blockage).
        nearest=None
        for e in targets:
            if e.id==slit.id: continue
            if e.kind in PHYSICAL_KINDS:
                inter=lens_hit(e,hit,d)
                if inter and (nearest is None or inter[0]<nearest[0]): nearest=(inter[0],e)
                continue
            if e.kind in {"right-prism","dispersion-prism"}:
                inter=prism_hit(e,hit,d)
                if inter and (nearest is None or inter[0]<nearest[0]): nearest=(inter[0],e)
                continue
            n=normal(e); den=dot(d,n)
            if abs(den)<1e-8: continue
            distance=dot(sub(e.position,hit),n)/den
            radius=max(30,e.diameterMm/2+10) if e.kind=="aperture" else max(30,e.slitHeightMm/2+10) if e.kind=="slit" else e.diameterMm/2
            local=sub(add(hit,mul(d,distance)),e.position)
            if distance>1e-5 and dot(local,local)<=radius**2+1e-7 and (nearest is None or distance<nearest[0]): nearest=(distance,e)
        # Require an unmodified source->slit chief segment, and no downstream element before the screen.
        direct=any(s['chief'] and s['sourceId']==source.id and s['hitId']==slit.id and math.sqrt(dot(sub(s['start'],source.position),sub(s['start'],source.position)))<1e-6 for s in segments)
        clear=nearest and not any(e.id not in {slit.id,nearest[1].id} and 0<dot(sub(e.position,source.position),d)<dot(sub(nearest[1].position,source.position),d) for e in targets)
        if nearest and nearest[1].kind=='screen' and direct and clear:
            profile=diffraction_profile(slit,nearest[1],source,hit,d)
            if profile: diffraction.append(profile); found=True
        if not found:
            warnings.add(f"{slit.name}当前只计算几何截光；远场条纹需宽光束正入射、窄而长的狭缝及无遮挡的远处正对观察屏。")
        else:
            warnings.add(f"{slit.name}条纹为独立的归一化远场强度，采样光线与功率计读数未包含衍射能量分布。")
    for grating,source,hit,d in grating_events:
        if grating.gratingProfile=='sinusoidal':continue
        # A 1D wave section is only valid along an unobstructed source/grating/screen path.
        candidates=[]
        for screen in targets:
            if screen.kind!='screen' or dot(sub(screen.position,grating.position),d)<=0: continue
            distance=dot(sub(screen.position,grating.position),d)
            blocked=any(other.id not in {grating.id,screen.id} and 0<dot(sub(other.position,source.position),d)<dot(sub(screen.position,source.position),d) for other in targets)
            if not blocked: candidates.append((distance,screen))
        if not candidates:
            warnings.add(f"{grating.name}级次方向已计算；光强剖面需要无遮挡的下游观察屏。")
            continue
        _,screen=min(candidates,key=lambda pair:pair[0])
        profile,reason=grating_profile(grating,screen,source,d)
        if profile: diffraction.append(profile)
        elif reason: warnings.add(f"{grating.name}：{reason}。")
    if grating_evidence and not four_f and any(e.kind=='amplitude-grating' and e.gratingProfile=='binary' for e in targets):
        warnings.add("光栅级次功率为薄振幅模型的采样估计；光强剖面单独计算，不是功率计读数。")
    from .spatial_imaging import calculate_imaging
    imaging = calculate_imaging(experiment)
    return {"imaging":imaging, "revision": revision, "inputSnapshot": experiment.model_dump(),
            "model": "3D光线 / 实体透镜 / 实体棱镜 / 理想偏振 / 狭缝与振幅光栅", "segments": segments, "beams": beams, "diffraction":diffraction, "gratingOrders":list(grating_evidence.values()),
            "screens": screens, "fourF":four_f, "fourier":fourier, "warnings": sorted(warnings), "chiefHitIds": sorted(chief_hits),
            "assumptions": (["傅里叶频谱按实际前后焦面器件参数变换复振幅后取模平方，I/I₀以频谱中心为基准；到屏功率另按有限圆屏上的绝对强度积分。共轴且输入/输出到透镜均为f，输入束腰在余弦振幅光栅上，镜片与光栅口径至少覆盖六束腰半径；忽略像差、离焦和高斯尾部的微小截断。"] if fourier else [])+(["4f 输出按当前器件参数进行两次相干傅里叶变换，保持输入中心光强基准；T 为输入条纹之后到完整输出平面的功率比，到屏功率按有限圆屏积分。须满足共轴等焦距及 f / 2f / f 间距，口径至少覆盖六个束腰半径；忽略像差、离焦与高斯尾部的微小截断。"] if four_f else [])+["每个光源按设置的光线数量，覆盖圆形截面内部及边界并等权采样；到屏功率是几何采样估计，低光线数会产生阶梯误差，并非高斯光强积分。",
                            "几何光束的发散半角决定出射方向；高斯光束的发散半角与束腰半径及波长联动。",
                            "教学理想透镜保留近轴薄透镜模型；反射镜按空间反射定律计算。",
                            "实体镜片外形尺寸与有效通光尺寸分开；入射和出射表面超出有效通光区域的光线被吸收。旧文件缺少通光尺寸时按原外形补齐，不默认90%。",
                            "平凸、双凸、平凹、双凹、正弯月、负弯月透镜按真实前后球面或平面、中心厚度逐面折射与全反射，包含几何球差和材料色散；无镀膜表面计算菲涅耳透射损耗，不追踪非全反射的杂散反射光，透镜侧边吸收光线。参考焦距为587.56 nm的近轴厚透镜值，边缘光线不一定在同一点聚焦。",
                            "实体非球面透镜为单面圆锥基底加四阶/六阶修正、后表面平面，逐面真实折射与表面透射损耗；参数须保证全口径凸凹形状和至少0.1mm边厚。实体柱面透镜为矩形平凸/平凹柱面体，仅局部U方向曲率，roll转动弯曲方向；包含厚度和真实表面折射。它们之后不计算高斯包络，不计算镀膜或非全反射杂散分支。",
                            "教学理想柱面薄透镜只在标记的聚焦方向施加薄透镜光焦度；转动轴向角改变聚焦方向，不计算实体厚度、像差或椭圆高斯包络。",
                            "分光镜按设置比例分配光线功率，滤光片按透过率衰减。",
                            "偏振分光镜按实际入射面的p/s复电场分量及各自透过率分配两路功率，反射率=1−透过率；默认p全透、s全反。采用理想无吸收薄分光面，不模拟立方体折射、镀膜色散与额外相位。",
                            "几何光束模式显示采样光线范围；高斯模式另外显示理想高斯光束的 1/e² 光强半径。",
                            "高斯半径在垂直于传播方向的截面上定义；倾斜观察屏上的光斑可能呈椭圆。",
                            "棱镜按实体三角柱逐面折射与全反射，BK7按波长色散；无镀膜表面计算菲涅耳透射损耗，不追踪非全反射的杂散反射分支。",
                            "理想偏振片按电场投影计算透光功率；未偏振光经过理想偏振片减半，线偏振光遵循马吕斯定律。",
                            "波片保留两偏振方向的复电场相位，设计波长时半波片延迟π、四分之一波片延迟π/2；其他波长按设计波长/实际波长缩放，不模拟晶体色散、倾角依赖或多级波片。屏的归一化S1/S2/S3描述偏振，S3=2Im(Eu·Ev共轭)，多光源按非相干功率相加。",
                            "功率计为有限圆形探测面，显示收集的几何采样功率；超量程不返回有效读数。",
                            "矩形振幅光栅采用周期透光条纹及不透光遮光框；通光矩形之外、遮光框之内的光线被吸收；方向满足切向波矢匹配，级次效率为 q²sinc²(mq) 的薄标量近似，q=a/d。不支持真实镀膜、闪耀、相位光栅或高斯包络传播。",
                            "矩形光栅光强剖面为均匀平行光直接正入射的一维有限条纹菲涅耳积分，仅显示 |x/L|≤0.2 的近轴横截面；忽略条纹高度方向的衍射，不支持中间透镜、遮挡或多源相干叠加。",
                            "狭缝通光模式截取矩形区域，遮光模式挡住该区域；通光模式符合远场条件时另算单狭缝 sinc² 归一化条纹，不与几何功率混算。",
                            "高斯包络不计算截光后的衍射或棱镜后的像散；不计算多光源相干干涉与一般波动传播。"]}
