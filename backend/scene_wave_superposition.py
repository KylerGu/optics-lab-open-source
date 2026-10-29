"""Two coherent co-propagating plane waves, same frequency and polarization."""
import math


def wave_values(p):
    phi = math.radians(p['phaseDeg'])
    re = p['amplitude1'] + p['amplitude2'] * math.cos(phi)
    im = p['amplitude2'] * math.sin(phi)
    amplitude = math.hypot(re, im)
    if amplitude < 1e-12 * (p['amplitude1'] + p['amplitude2']):
        amplitude = 0.
    theta = 2 * math.pi * p['observationUm'] / (p['wavelengthNm'] / 1000)
    first = p['amplitude1'] * math.cos(theta)
    second = p['amplitude2'] * math.cos(theta + phi)
    return dict(amplitude=amplitude, intensity=amplitude**2, firstIntensity=p['amplitude1']**2,
                secondIntensity=p['amplitude2']**2, first=first, second=second,
                sum=first + second if amplitude else 0.,
                resultantPhaseDeg=math.degrees(math.atan2(im, re)) if amplitude else None)


def target_phase(p, target, value=None):
    if target == 'constructive':
        return 0.
    if target == 'destructive':
        return 180.
    if target != 'relative_intensity':
        raise ValueError('未知的光波叠加目标。')
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError('请给出有限的平均相对光强。')
    a, b = p['amplitude1'], p['amplitude2']
    low, high = (a-b)**2, (a+b)**2
    if value < low-1e-12 or value > high+1e-12:
        raise ValueError(f'保持振幅不变时，相对光强只能在 {low:.6g} 至 {high:.6g} 之间。')
    if a*b == 0:
        return p['phaseDeg']
    cosine = (value-a*a-b*b)/(2*a*b)
    angle = math.degrees(math.acos(max(-1., min(1., cosine))))
    candidates = [angle, 360-angle]
    return min(candidates, key=lambda x: min(abs(x-p['phaseDeg']), 360-abs(x-p['phaseDeg'])))


def calculate_wave(state, definition, revision=''):
    p = state['parameters']
    b = wave_values(p)
    metrics = [dict(key=key, label=label, value=b[key], unit=unit, note=note) for key, label, unit, note in [
        ('amplitude', '合成振幅', '相对单位', '同一电场基准'),
        ('intensity', '平均相对光强', '相对单位', '以振幅为1的单束光平均光强为1；不是瞬时电场平方'),
        ('firstIntensity', '第一束相对光强', '相对单位', ''),
        ('secondIntensity', '第二束相对光强', '相对单位', ''),
        ('first', '观察点第一束电场', '相对单位', '固定参考时刻的电场值'),
        ('second', '观察点第二束电场', '相对单位', '固定参考时刻的电场值'),
        ('sum', '观察点合成电场', '相对单位', '固定参考时刻的电场值'),
        ('resultantPhaseDeg', '合成初相位', '°', '合成振幅为零时相位不定义')]]
    status = '完全相消' if b['amplitude'] == 0 else '同相增强' if p['phaseDeg'] % 360 == 0 else '反相抵消' if p['phaseDeg'] == 180 else '光强等于两束之和' if abs(math.cos(math.radians(p['phaseDeg']))) < 1e-10 else '部分增强' if math.cos(math.radians(p['phaseDeg'])) > 0 else '部分抵消'
    if p['amplitude1'] == 0 or p['amplitude2'] == 0:
        status = '两束振幅均为零' if p['amplitude1'] == p['amplitude2'] == 0 else '仅一束光'
    return dict(revision=revision, input=state, modelVersion='wave-superposition-1', model='wave-superposition',
                scope=definition['scope'], status=status, warnings=[], metrics=metrics,
                bounds=[0, 4, -4.4, 4.4], segments=[], markers=[], regions=[], curve=[],
                chart=dict(xLabel='位置 z / μm', yLabel='电场 / 相对单位', currentX=p['observationUm'], currentY=b['sum']))
