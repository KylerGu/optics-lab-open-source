"""Independent complex-q calculation for the focusing scene's assistant."""
import math
from .optics import beam_radius


def calculate_focus(state, definition, revision=''):
    p = state['parameters']
    wavelength = p['wavelengthNm'] * 1e-6
    zr = math.pi * p['waistMm'] ** 2 / wavelength
    q_in = complex(p['lensPositionMm'] - p['waistPositionMm'], zr)
    q_out = 1 / (1 / q_in - 1 / p['focalLengthMm'])
    position = p['lensPositionMm'] - q_out.real
    waist = math.sqrt(wavelength * q_out.imag / math.pi)
    virtual = position < p['lensPositionMm'] - 1e-8
    upstream = p['observationMm'] < p['lensPositionMm']
    q_observation = (complex(p['observationMm'] - p['waistPositionMm'], zr) if upstream
                     else q_out + p['observationMm'] - p['lensPositionMm'])
    lens_radius = beam_radius(q_in, wavelength)
    metrics = []
    def metric(key, label, value, note=''):
        metrics.append(dict(key=key, label=label, value=value, unit='mm', note=note))
    metric('outputWaistPositionMm', '出射束腰位置 z′₀', position, '透镜前方（反向延拓）' if virtual else '透镜后方')
    metric('outputWaistMm', '延拓束腰半径 w′₀' if virtual else '最小光斑半径 w′₀', waist)
    metric('observationRadiusMm', '观察光斑半径 w(z)', beam_radius(q_observation, wavelength), '观察面在透镜前' if upstream else '')
    metric('minimumForwardMm', '透镜后实际最小半径', lens_radius if virtual else waist)
    metric('waistDistanceMm', '出射束腰距透镜的有向距离', -q_out.real)
    metric('lensRadiusMm', '透镜处光斑半径', lens_radius)
    metric('outputRayleighMm', '出射瑞利长度', q_out.imag)
    warnings = []
    if max(wavelength / (math.pi * p['waistMm']), wavelength / (math.pi * waist)) >= .1:
        warnings.append('传播角度较大，超出小角度近似的可靠范围。')
    return dict(revision=revision, input=state, modelVersion='gaussian-focus-q-1', model='gaussian-focus',
                scope=definition['scope'], status='透镜前方（延拓）' if virtual else '透镜后方束腰', metrics=metrics,
                warnings=warnings, bounds=[0, 600, -lens_radius, lens_radius], segments=[], markers=[], regions=[], curve=[],
                chart=dict(xLabel='位置 / mm', yLabel='光斑半径 / mm', currentX=p['observationMm'], currentY=beam_radius(q_observation, wavelength)))
