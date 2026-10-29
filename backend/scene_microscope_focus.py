"""Shared microscope sample position; u in mm, signed defocus in micrometres."""
import math


def focus_distance(p):
    image_distance = p['d']-p['f2']
    u = p['f1'] if p['mode']==1 else p['f1']*image_distance/(image_distance-p['f1']) if image_distance>p['f1'] else math.nan
    return u if math.isfinite(u) and 5<=u<=100 else None


def normalize_microscope(state):
    if state['sceneId']!='instruments-0':return state
    p=state['parameters'];focus=focus_distance(p)
    z=0 if focus is None else (p['u']-focus)*1000
    return {**state,'parameters':{**p,'defocus':0 if abs(z)<1e-8 else z,'depthCriterion':p['depthCriterion'] if p['mode']==1 else 0}}


def patch_scene_parameters(state,patch):
    candidate={**state,'parameters':{**state['parameters'],**patch}}
    if state['sceneId']=='instruments-0' and 'defocus' in patch and 'u' not in patch:
        focus=focus_distance(candidate['parameters'])
        if focus is None:raise ValueError('当前镜组没有可调范围内的焦平面。')
        u=focus+patch['defocus']/1000
        if u<5-1e-10 or u>100+1e-10:raise ValueError('离焦位置超出物距调节范围。')
        candidate['parameters']['u']=max(5,min(100,u))
    return normalize_microscope(candidate)
