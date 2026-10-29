"""Validated, optional links into the existing apparatus editor; no UI execution."""


def action_key(action):
    return tuple(action.get(key) for key in ('objectId', 'elementId', 'kind', 'field', 'screenId'))


def visual_action(args, workspaces, active_id):
    object_id = args.get('objectId', active_id)
    if not isinstance(object_id, str) or object_id not in workspaces:
        raise ValueError('请选择已有装置。')
    experiment = workspaces[object_id].original
    element = next((e for e in experiment.elements if e.id == args['elementId']), None)
    kind, field = args['kind'], args.get('field')
    explanation = args['explanation']
    if element is None or element.kind not in {'lens', 'screen'}:
        raise ValueError('画面定位目前支持已有薄透镜和观察屏。')
    if kind not in {'locate', 'adjust', 'compare'} or not isinstance(explanation, str) or not 1 <= len(explanation.strip()) <= 240:
        raise ValueError('画面操作或说明无效。')
    allowed = {'x', 'y', 'z'} | ({'focalLengthMm'} if element.kind == 'lens' else set())
    if (kind == 'locate' and field is not None) or (kind != 'locate' and field not in allowed):
        raise ValueError('locate不填field；adjust/compare必须填field：位置用小写x/y/z，薄透镜焦距用focalLengthMm。')
    screen_id = args.get('screenId')
    if kind == 'compare':
        if not any(e.id == screen_id and e.kind == 'screen' for e in experiment.elements):
            raise ValueError('请选择已有观察屏作为对照读数。')
        if not any(e.kind == 'laser' and e.beamModel == 'gaussian' for e in experiment.elements):
            raise ValueError('光斑对照目前需要高斯光源。')
    elif screen_id is not None:
        raise ValueError('只有前后对照需要指定观察屏。')
    return {'objectId': object_id, 'elementId': element.id, 'kind': kind,
            'field': field, 'screenId': screen_id, 'explanation': explanation.strip()}
