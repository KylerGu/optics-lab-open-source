"""Straight, circular step-index fibre: meridional rays and weak-guide cutoff."""
import math

CUTOFF = 2.404825557695773


def fiber_values(p):
    n1, n2 = p['coreIndex'], p['claddingIndex']
    guiding = n1 > n2
    na = math.sqrt((n1 - n2) * (n1 + n2)) if guiding else None
    acceptance = math.degrees(math.asin(na)) if guiding else None
    critical = math.degrees(math.asin(n2 / n1)) if guiding else None
    internal = math.degrees(math.asin(math.sin(math.radians(p['angleDeg'])) / n1))
    v = 2 * math.pi * p['radiusUm'] * na / (p['wavelengthNm'] * .001) if guiding else None
    cutoff = 2 * math.pi * p['radiusUm'] * na / CUTOFF * 1000 if guiding else None
    ray = 'unguided' if not guiding else 'critical' if abs(p['angleDeg'] - acceptance) <= 1e-9 else 'guided' if p['angleDeg'] < acceptance else 'escaping'
    mode = '无折射率导光' if v is None else '截止边界' if abs(v - CUTOFF) <= 1e-9 else '单模' if v < CUTOFF else '多模'
    return dict(na=na, acceptanceDeg=acceptance, criticalDeg=critical, internalDeg=internal,
                incidenceDeg=90-internal, v=v, cutoffNm=cutoff, rayStatus=ray, mode=mode)


def fiber_target(p, target, value=None):
    b = fiber_values(p)
    if b['na'] is None:
        raise ValueError('纤芯折射率须高于包层，才能设置导光目标。')
    if target == 'accepted_ray':
        return dict(angleDeg=b['acceptanceDeg'] * .5)
    if target == 'single_mode':
        # Choose V=2, with finite margin below the cutoff; only change radius.
        radius = 2 * p['wavelengthNm'] * .001 / (2 * math.pi * b['na'])
        if not 1 <= radius <= 25:
            raise ValueError('仅调整纤芯半径，当前范围不能达到 V=2 的单模目标。')
        return dict(radiusUm=radius)
    raise ValueError('未知的光纤目标。')


def calculate_fiber(state, definition, revision=''):
    p = state['parameters']
    b = fiber_values(p)
    labels = [('na', '数值孔径', '', '接收角范围的指标；不表示实际耦合效率'),
              ('acceptanceDeg', '接收半角', '°', '空气入射，相对光纤轴线'),
              ('criticalDeg', '临界角', '°', '纤芯到包层，相对界面法线'),
              ('internalDeg', '芯内角', '°', '相对光纤轴线'),
              ('incidenceDeg', '界面入射角', '°', '相对纤芯与包层界面法线'),
              ('v', '归一化频率', '', 'V<2.4048255577 为弱导近似的单模区；模式数不由光线反弹次数确定'),
              ('cutoffNm', '截止波长', 'nm', '保持折射率不随波长变化；λ>λc 为单模区')]
    metrics = [dict(key=k, label=label, value=b[k], unit=unit, note=note) for k, label, unit, note in labels]
    status = {'guided': '全反射导光', 'critical': '临界掠射', 'escaping': '超出接收角', 'unguided': '无折射率导光'}[b['rayStatus']]
    curve = [dict(x=400+1300*j/260, y=2*math.pi*p['radiusUm']*b['na']/((400+1300*j/260)*.001) if b['na'] is not None else None) for j in range(261)]
    return dict(revision=revision, input=state, modelVersion='fiber-modes-1', model='fiber-modes',
                scope=definition['scope'], status=status+' · '+b['mode'], warnings=[] if b['na'] is not None else ['n₁≤n₂，无纤芯折射率导光；NA、V及截止波长不适用。'],
                metrics=metrics, bounds=[0, 80, -2.25, 2.25], segments=[], markers=[], regions=[],
                curve=curve, chart=dict(xLabel='波长 λ / nm', yLabel='归一化频率 V', currentX=p['wavelengthNm'], currentY=b['v']))
