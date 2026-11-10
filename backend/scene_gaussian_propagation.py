"""Free-propagation Gaussian readings for the shared scene assistant."""
import math


def calculate_propagation(state, definition, revision=''):
    p = state['parameters']
    wavelength = p['wavelengthNm'] * 1e-6
    distance = p['observationMm'] - p['waistPositionMm']
    rayleigh = math.pi * p['waistMm'] ** 2 / wavelength
    radius = p['waistMm'] * math.hypot(1, distance / rayleigh)
    divergence = wavelength / (math.pi * p['waistMm']) * 1000
    curvature = None if distance == 0 else distance + rayleigh ** 2 / distance
    if distance <= rayleigh:
        region = '近场束腰区'
    elif distance < 3 * rayleigh:
        region = '过渡区'
    else:
        region = '远场近似区'
    metrics = [
        dict(key='radiusMm', label='观察光斑半径 w(z)', value=radius, unit='mm', note=''),
        dict(key='rayleighMm', label='瑞利长度 z_R', value=rayleigh, unit='mm', note=''),
        dict(key='divergenceMrad', label='发散半角 θ', value=divergence, unit='mrad', note=''),
        dict(key='distanceMm', label='传播距离 d', value=distance, unit='mm', note=''),
        dict(key='curvatureMm', label='波前曲率半径 R', value=curvature, unit='mm', note='束腰平面曲率无限大' if curvature is None else ''),
        dict(key='peakRelative', label='相对束腰峰值', value=(p['waistMm'] / radius) ** 2, unit='', note=''),
    ]
    warnings = []
    if divergence >= 100:
        warnings.append('传播角度较大，超出小角度近似的可靠范围。')
    return dict(revision=revision, input=state, modelVersion='gaussian-propagation-1', model='gaussian-propagation',
                scope=definition['scope'], status=region, metrics=metrics, warnings=warnings,
                bounds=[0, 600, -radius, radius], segments=[], markers=[], regions=[], curve=[],
                chart=dict(xLabel='位置 / mm', yLabel='光斑半径 / mm', currentX=p['observationMm'], currentY=radius))
