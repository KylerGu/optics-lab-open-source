"""Two spherical mirrors, air, paraxial fundamental Gaussian mode."""
import math


def resonator_mode(p):
    length = p['lengthMm']
    rho1, rho2 = p['firstKind'] / p['firstRadiusMm'], p['secondKind'] / p['secondRadiusMm']
    g1, g2 = 1 - length * rho1, 1 - length * rho2
    product = g1 * g2
    confocal = g1 == 0 and g2 == 0
    stable = 0 < product < 1
    status = '共焦（简并）' if confocal else '稳定' if stable else '临界' if product in (0, 1) else '不稳定'
    mode = None
    if stable or confocal:
        denominator = g1 + g2 - 2 * product
        z0 = length / 2 if confocal else length * g2 * (1 - g1) / denominator
        zr = length / 2 if confocal else length * math.sqrt(product * (1 - product)) / abs(denominator)
        w0 = math.sqrt(p['wavelengthNm'] * 1e-6 * zr / math.pi)
        mode = dict(waistPositionMm=z0, rayleighMm=zr, waistMm=w0,
                    firstSpotMm=w0 * math.hypot(1, z0 / zr), secondSpotMm=w0 * math.hypot(1, (length - z0) / zr))
    return g1, g2, product, stable, confocal, status, mode


def stable_length(p):
    if resonator_mode(p)[3]:
        return p['lengthMm']
    r1 = p['firstKind'] * p['firstRadiusMm'] if p['firstKind'] else None
    r2 = p['secondKind'] * p['secondRadiusMm'] if p['secondKind'] else None
    roots = [10, 2000, r1, r2, r1 + r2 if r1 is not None and r2 is not None else None]
    boundaries = sorted(set(n for n in roots if n is not None and 10 <= n <= 2000))
    candidates = [(a + b) / 2 for a, b in zip(boundaries, boundaries[1:]) if resonator_mode({**p, 'lengthMm': (a + b) / 2})[3]]
    if not candidates:
        raise ValueError('这组腔镜在可调镜距内没有稳定区域。')
    return min(candidates, key=lambda n: abs(n - p['lengthMm']))


def calculate_resonator(state, definition, revision=''):
    p = state['parameters']
    g1, g2, product, stable, confocal, status, mode = resonator_mode(p)
    observation = None
    if mode and 0 <= p['observationMm'] <= p['lengthMm']:
        observation = mode['waistMm'] * math.hypot(1, (p['observationMm'] - mode['waistPositionMm']) / mode['rayleighMm'])
    metrics = [dict(key=k, label=label, value=v, unit='', note='') for k, label, v in [('g1', '第一镜稳定参数 g₁', g1), ('g2', '第二镜稳定参数 g₂', g2), ('stabilityProduct', '稳定乘积 g₁g₂', product)]]
    for key, label in [('waistMm', '束腰半径'), ('waistPositionMm', '束腰位置'), ('rayleighMm', '瑞利长度'), ('firstSpotMm', '第一镜处光束半径'), ('secondSpotMm', '第二镜处光束半径')]:
        value = mode[key] if mode else None
        note = '共焦腔取对称高斯解' if confocal else '腔外延拓位置' if key == 'waistPositionMm' and mode and not 0 <= value <= p['lengthMm'] else ''
        metrics.append(dict(key=key, label=label, value=value, unit='mm', note=note))
    metrics.append(dict(key='observationRadiusMm', label='观察光斑半径', value=observation, unit='mm', note='观察面在腔外' if p['observationMm'] > p['lengthMm'] else ''))
    warnings = ['超出小角度范围。'] if mode and p['wavelengthNm'] * 1e-6 / (math.pi * mode['waistMm']) >= .1 else []
    if not mode:
        warnings.append('没有有限的稳定腔内高斯解。')
    extent = max(mode['firstSpotMm'], mode['secondSpotMm']) if mode else 1
    return dict(revision=revision, input=state, modelVersion='two-mirror-resonator-1', model='two-mirror-resonator',
                scope=definition['scope'], status=status, metrics=metrics, warnings=warnings,
                bounds=[0, p['lengthMm'], -extent, extent], segments=[], markers=[], regions=[], curve=[],
                chart=dict(xLabel='g₁', yLabel='g₂', currentX=g1, currentY=g2))
