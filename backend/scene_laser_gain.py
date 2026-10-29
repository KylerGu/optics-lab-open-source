"""Single-mode intensity threshold with lumped homogeneous gain saturation."""
import math


def gain_values(p):
    length = p['lengthMm'] / 1000
    r1, r2 = p['firstReflectivityPct'] / 100, p['secondReflectivityPct'] / 100
    mirror_loss = -math.log(r1) - math.log(r2)
    threshold = p['lossPerM'] + mirror_loss / (2 * length)
    margin = p['smallSignalGain'] - threshold
    tolerance = 1e-10 * max(1, threshold, p['smallSignalGain'])
    lossless = threshold == 0
    above, at = margin > tolerance, abs(margin) <= tolerance
    status = ('无有限稳态' if p['smallSignalGain'] > 0 else '理想无损') if lossless else '阈值以上' if above else '达到阈值' if at else '阈值以下'
    intensity = None if lossless else margin / threshold if above else 0
    return dict(thresholdGain=threshold, logRoundTrip=2 * length * margin,
                roundTrip=r1 * r2 * math.exp(2 * (p['smallSignalGain'] - p['lossPerM']) * length),
                gainMargin=margin, steadyIntensity=intensity, outputIntensity=None if intensity is None else (1 - r2) * intensity,
                steadyGain=None if lossless else threshold if above or at else p['smallSignalGain'],
                probeGain=p['smallSignalGain'] / (1 + p['probeIntensity']),
                mirrorLoss=mirror_loss, internalLoss=2 * p['lossPerM'] * length, status=status, lossless=lossless)


def target_gain(p, above=False):
    b = gain_values(p)
    target = b['thresholdGain'] * (1.2 if above else 1)
    if b['lossless']:
        raise ValueError('理想无损腔没有可由该饱和模型确定的有限稳态，不能按此目标调参。')
    if target > 50:
        raise ValueError('目标增益超出当前可调范围。')
    return target


def calculate_laser_gain(state, definition, revision=''):
    p, metrics = state['parameters'], []
    b = gain_values(p)
    for key, label, unit in [('thresholdGain', '阈值增益', 'm⁻¹'), ('roundTrip', '小信号往返倍率', '×'), ('gainMargin', '增益余量', 'm⁻¹'), ('steadyIntensity', '稳态相对光强', ''), ('outputIntensity', '相对出射光强', ''), ('steadyGain', '稳态增益', 'm⁻¹'), ('probeGain', '试算增益', 'm⁻¹'), ('mirrorLoss', '镜面往返对数损耗', ''), ('internalLoss', '内部往返对数损耗', '')]:
        metrics.append(dict(key=key, label=label, value=b[key], unit=unit, note='相对饱和光强 Iₛ' if key in ('steadyIntensity', 'outputIntensity') else ''))
    warnings = ['理想无损模型无法唯一确定有限稳态光强。'] if b['lossless'] else []
    curve = [dict(x=i / 5, y=None if b['lossless'] else (1 - p['secondReflectivityPct'] / 100) * max(0, (i / 5) / b['thresholdGain'] - 1)) for i in range(251)]
    return dict(revision=revision, input=state, modelVersion='laser-threshold-saturation-1', model='laser-gain', scope=definition['scope'],
                status=b['status'], metrics=metrics, warnings=warnings, bounds=[0, 50, 0, max(1, max((v['y'] or 0) for v in curve))],
                segments=[], markers=[], regions=[], curve=curve,
                chart=dict(xLabel='小信号增益 / m⁻¹', yLabel='出射光强 / Iₛ', currentX=p['smallSignalGain'], currentY=b['outputIntensity']))
