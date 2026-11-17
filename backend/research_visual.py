"""Validated, optional links into the existing apparatus editor; no UI execution."""

from .profile_lenses import CYLINDER_KINDS, PHYSICAL_KINDS
from .spherical_lenses import SPHERICAL_KINDS

ROLL_KINDS = {
    'right-prism',
    'dispersion-prism',
    'slit',
    'amplitude-grating',
    'cylindrical-lens',
    'polarizer',
    'half-wave-plate',
    'quarter-wave-plate',
} | CYLINDER_KINDS

TRANSMISSION_KINDS = {
    'splitter',
    'filter',
    'polarizer',
    'half-wave-plate',
    'quarter-wave-plate',
}

DIAMETER_KINDS = {
    'aperture',
    'lens',
    'mirror',
    'splitter',
    'polarizing-splitter',
    'filter',
    'polarizer',
    'half-wave-plate',
    'quarter-wave-plate',
    'screen',
    'power-meter',
    'right-prism',
    'dispersion-prism',
}

VISUAL_FIELD_ENUM = (
    'x',
    'y',
    'z',
    'yawDeg',
    'pitchDeg',
    'rollDeg',
    'focalLengthMm',
    'wavelengthNm',
    'beamRadiusMm',
    'waistOffsetMm',
    'powerMw',
    'polarizationDeg',
    'diameterMm',
    'transmission',
    'slitWidthMm',
    'gratingPeriodUm',
    'apexAngleDeg',
    'frontRadiusMm',
    'backRadiusMm',
)


def allowed_visual_fields(element):
    fields = {'x', 'y', 'z', 'yawDeg', 'pitchDeg'}
    if element.kind in ROLL_KINDS:
        fields.add('rollDeg')
    if element.kind in {'lens', 'cylindrical-lens'}:
        fields.add('focalLengthMm')
    if element.kind == 'laser':
        fields.update({'wavelengthNm', 'beamRadiusMm', 'powerMw'})
        if element.beamModel == 'gaussian':
            fields.add('waistOffsetMm')
        if element.polarization == 'linear':
            fields.add('polarizationDeg')
    elif element.kind == 'object':
        fields.add('wavelengthNm')
    if element.kind in DIAMETER_KINDS or (element.kind in PHYSICAL_KINDS and element.kind not in CYLINDER_KINDS):
        fields.add('diameterMm')
    if element.kind in TRANSMISSION_KINDS:
        fields.add('transmission')
    if element.kind == 'slit':
        fields.add('slitWidthMm')
    if element.kind == 'amplitude-grating':
        fields.add('gratingPeriodUm')
    if element.kind == 'dispersion-prism':
        fields.add('apexAngleDeg')
    if element.kind in PHYSICAL_KINDS:
        fields.add('frontRadiusMm')
        if element.kind in SPHERICAL_KINDS and not element.kind.startswith('plano'):
            fields.add('backRadiusMm')
    return fields


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
    if element is None:
        raise ValueError('画面定位引用的器件不存在。')
    if kind not in {'locate', 'adjust', 'compare'} or not isinstance(explanation, str) or not 1 <= len(explanation.strip()) <= 240:
        raise ValueError('画面操作或说明无效。')
    allowed = allowed_visual_fields(element)
    if (kind == 'locate' and field is not None) or (kind != 'locate' and field not in allowed):
        raise ValueError('locate不填field；adjust/compare须填写该器件支持的参数字段。')
    screen_id = args.get('screenId')
    if kind == 'compare':
        if not any(e.id == screen_id and e.kind in {'screen', 'power-meter', 'sensor'} for e in experiment.elements):
            raise ValueError('请选择已有观察屏、功率计或传感器作为对照读数。')
        if not any(e.kind in {'laser', 'object'} for e in experiment.elements):
            raise ValueError('前后对照需要装置中有光源或样品。')
    elif screen_id is not None:
        raise ValueError('只有前后对照需要指定探测器。')
    return {'objectId': object_id, 'elementId': element.id, 'kind': kind,
            'field': field, 'screenId': screen_id, 'explanation': explanation.strip()}
