"""Illuminance at the normally illuminated centre of a receiving plane."""
import math


def illuminance(p, distance=None):
    return p['intensityCd'] / (p['distanceM'] if distance is None else distance) ** 2


def target_distance(p, value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        raise ValueError('目标照度须为大于零的有限数值，单位 lx。')
    if p['intensityCd'] == 0:
        raise ValueError('光源已关闭，仅改变距离不能达到正照度。')
    distance = math.sqrt(p['intensityCd'] / value)
    if not .2 <= distance <= 10:
        low, high = illuminance(p, 10), illuminance(p, .2)
        raise ValueError(f'保持光强不变时，当前距离范围内照度为 {low:.6g}–{high:.6g} lx。')
    return distance


def calculate_point(state, definition, revision=''):
    p = state['parameters']
    e = illuminance(p)
    return dict(revision=revision, input=state, modelVersion='point-source-illuminance-1', model='point-source',
                scope=definition['scope'], status='光源关闭' if p['intensityCd'] == 0 else '垂直接收', warnings=[],
                metrics=[dict(key='illuminance', label='照度', value=e, unit='lx', note='接收面中心，入射角为零'),
                         dict(key='doubleDistanceIlluminance', label='距离加倍后的照度', value=e / 4, unit='lx', note='理论比较，不改变当前距离')],
                bounds=[0, 10, -2, 2], segments=[], markers=[], regions=[],
                curve=[dict(x=.2 + 9.8 * j / 400, y=illuminance(p, .2 + 9.8 * j / 400)) for j in range(401)],
                chart=dict(xLabel='距离 r / m', yLabel='照度 E / lx', currentX=p['distanceM'], currentY=e))
