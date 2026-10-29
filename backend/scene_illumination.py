"""Directional point source with a cosine-power photometric distribution."""
import math

EXTENT = 4.
SIZE = 81


def illuminance_at(p, x=None, y=None):
    x = p['observationXM'] if x is None else x
    y = p['observationYM'] if y is None else y
    dx = x - p['sourceXM']
    r = math.hypot(dx, y, p['heightM'])
    theta = math.radians(p['tiltDeg'])
    cosine = max(-1., min(1., (dx*math.sin(theta) + p['heightM']*math.cos(theta)) / r))
    order = math.log(.5) / math.log(math.cos(math.radians(p['halfAngleDeg'])))
    factor = max(0., cosine)**order
    return dict(value=p['intensityCd']*factor*p['heightM']/r**3, distance=r,
                alphaDeg=math.degrees(math.acos(cosine)), incidenceDeg=math.degrees(math.acos(p['heightM']/r)), order=order)


def map_values(p):
    step = EXTENT*2/(SIZE-1)
    weighted, maximum, minimum, peak = 0., 0., math.inf, None
    for j in range(SIZE):
        for i in range(SIZE):
            x, y = -EXTENT+i*step, EXTENT-j*step
            e = illuminance_at(p, x, y)['value']
            weighted += e*(.5 if i in (0, SIZE-1) else 1)*(.5 if j in (0, SIZE-1) else 1)
            minimum = min(minimum, e)
            if e > maximum:
                maximum, peak = e, dict(x=x, y=y)
    average = weighted/(SIZE-1)**2
    return dict(maximum=maximum, minimum=minimum, average=average,
                uniformity=minimum/average if average else None, peak=peak)


def illumination_target(p, target, value=None):
    if target == 'best_direction':
        # Tilt is limited to the x-z plane. An off-axis y point cannot be fully aligned.
        theta = math.degrees(math.atan2(p['observationXM']-p['sourceXM'], p['heightM']))
        return dict(tiltDeg=max(-70., min(70., theta)))
    if target != 'illuminance':
        raise ValueError('未知的照明目标。')
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise ValueError('目标照度须为非负有限数值，单位 lx。')
    if value == 0:
        return dict(intensityCd=0.)
    per_cd = illuminance_at({**p, 'intensityCd': 1.})['value']
    if per_cd <= 0:
        raise ValueError('观察点位于光源后半空间，仅增加光强不能照亮；请先调整方向。')
    intensity = value/per_cd
    if not math.isfinite(intensity) or intensity > 2000:
        raise ValueError(f'保持位置、方向和半强角时，观察点最大可达照度为 {2000*per_cd:.6g} lx。')
    return dict(intensityCd=intensity)


def calculate_illumination(state, definition, revision=''):
    p = state['parameters']
    observation, area = illuminance_at(p), map_values(p)
    metrics = [dict(key=key, label=label, value=value, unit=unit, note=note) for key, label, value, unit, note in [
        ('illuminance', '观察点照度', observation['value'], 'lx', '实际观察点，包含距离、配光及入射余弦'),
        ('maximum', '区域采样最大照度', area['maximum'], 'lx', '固定8 m×8 m区域，81×81网格，不保证连续最大值'),
        ('average', '区域平均照度', area['average'], 'lx', '同一区域二维梯形积分近似'),
        ('uniformity', '区域均匀度', area['uniformity'], '', '网格最小照度/区域平均照度；关闭光源时不定义'),
        ('distance', '观察点距离', observation['distance'], 'm', ''),
        ('alphaDeg', '离轴角', observation['alphaDeg'], '°', '观察方向与光源主轴夹角'),
        ('incidenceDeg', '入射角', observation['incidenceDeg'], '°', '接收面法线与入射方向夹角')]]
    return dict(revision=revision, input=state, modelVersion='directional-illumination-1', model='illumination-map',
                scope=definition['scope'], status='光源关闭' if p['intensityCd'] == 0 else '观察点在光源后半空间' if observation['value'] == 0 else '定向照明',
                warnings=[], metrics=metrics, bounds=[-4, 4, -4, 4], segments=[], markers=[], regions=[],
                curve=[dict(x=-4+8*i/320, y=illuminance_at(p, -4+8*i/320, p['observationYM'])['value']) for i in range(321)],
                chart=dict(xLabel='位置 x / m', yLabel='照度 E / lx', currentX=p['observationXM'], currentY=observation['value']))
