"""Independent complex-q model for a two-lens Gaussian beam expander."""
import math
from .optics import beam_radius


def beams(p):
    wavelength = p['wavelengthNm'] * 1e-6
    zr = math.pi * p['waistMm'] ** 2 / wavelength
    q_in = complex(p['firstPositionMm'] - p['waistPositionMm'], zr)
    q1 = 1 / (1 / q_in - 1 / (p['firstKind'] * p['firstFocalMm']))
    q2 = 1 / (1 / (q1 + p['secondPositionMm'] - p['firstPositionMm']) - 1 / p['secondFocalMm'])
    return wavelength, zr, q_in, q1, q2


def collimated_position(p):
    _, _, _, q1, _ = beams(p)
    discriminant = p['secondFocalMm'] ** 2 - 4 * q1.imag ** 2
    if discriminant < 0:
        raise ValueError('当前输入与第二镜焦距没有平波前解。')
    position = p['firstPositionMm'] + (p['secondFocalMm'] + math.sqrt(discriminant)) / 2 - q1.real
    if not p['firstPositionMm'] + 1 <= position <= 1100:
        raise ValueError('准直镜距超出当前可调范围。')
    return position


def calculate_expander(state, definition, revision=''):
    p = state['parameters']
    wavelength, zr, q_in, q1, q2 = beams(p)
    d = p['secondPositionMm'] - p['firstPositionMm']
    w1, w2 = beam_radius(q_in, wavelength), beam_radius(q1 + d, wavelength)
    waist = math.sqrt(wavelength * q2.imag / math.pi)
    divergence = wavelength / (math.pi * waist) * 1000
    observation = (complex(p['observationMm'] - p['waistPositionMm'], zr) if p['observationMm'] < p['firstPositionMm']
                   else q1 + p['observationMm'] - p['firstPositionMm'] if p['observationMm'] < p['secondPositionMm']
                   else q2 + p['observationMm'] - p['secondPositionMm'])
    radii = [beam_radius(q2 + offset, wavelength) for offset in [0, 50, 100]]
    if 0 <= -q2.real <= 100:
        radii.append(waist)
    status = '近准直' if max(radii) / min(radii) < 1.01 else '出射会聚' if q2.real < 0 else '出射发散'
    region = '观察面在第一镜前' if p['observationMm'] < p['firstPositionMm'] else '观察面在两镜之间' if p['observationMm'] < p['secondPositionMm'] else ''
    metrics = []
    def metric(key, label, value, unit='mm', note=''):
        metrics.append(dict(key=key, label=label, value=value, unit=unit, note=note))
    metric('expansion', '实际扩束倍率', w2 / w1, '×', '第二镜处半径 / 第一镜处半径')
    metric('divergenceMrad', '出射发散半角', divergence, 'mrad')
    metric('observationRadiusMm', '观察光斑半径', beam_radius(observation, wavelength), note=region)
    metric('nominalExpansion', '名义扩束倍率', p['secondFocalMm'] / p['firstFocalMm'], '×')
    metric('inputDivergenceMrad', '入射发散半角', wavelength / (math.pi * p['waistMm']) * 1000, 'mrad')
    metric('spacingMm', '镜间距', d)
    metric('firstRadiusMm', '第一镜处半径', w1)
    metric('secondRadiusMm', '第二镜处半径', w2)
    metric('outputWaistMm', '出射束腰半径', waist)
    metric('outputWaistPositionMm', '出射束腰位置', p['secondPositionMm'] - q2.real, note='位置在第二镜前时仅为出射光束反向延拓')
    metric('curvaturePerMm', '第二镜后波前曲率', (1 / q2).real, '1/mm', '0 表示平波前；仍存在衍射发散')
    angles = [wavelength / (math.pi * math.sqrt(wavelength * q.imag / math.pi)) for q in [q_in, q1, q2]]
    warnings = ['超出小角度范围。'] if max(angles) >= .1 else []
    return dict(revision=revision, input=state, modelVersion='gaussian-expander-q-1', model='gaussian-expander',
                scope=definition['scope'], status=status, metrics=metrics, warnings=warnings,
                bounds=[0, 600, -max(w1, w2), max(w1, w2)], segments=[], markers=[], regions=[], curve=[],
                chart=dict(xLabel='位置 / mm', yLabel='光斑半径 / mm', currentX=p['observationMm'], currentY=beam_radius(observation, wavelength)))
