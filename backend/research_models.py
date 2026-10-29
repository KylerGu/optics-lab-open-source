"""Research access to existing scene calculations; no new physics formulas."""
from copy import deepcopy
from uuid import uuid4

from pydantic import Field, model_validator
from .models import StrictModel
from .scene_physics import DEFINITIONS, SceneState, calculate, validate_parameters
from .scene_microscope_focus import patch_scene_parameters


INTERFERENCE_MODELS = {'wave-superposition', 'young-double-slit', 'michelson', 'film-interference'}
INSTRUMENT_MODELS = {'microscope', 'camera', 'telescope'}
RESEARCH_MODELS = {key: value for key, value in DEFINITIONS.items() if value['model'] in INTERFERENCE_MODELS | INSTRUMENT_MODELS}
MODEL_LIMIT = '仅验证所选理想模型中的光场或条纹。不是任意三维装置的多路相干计算，也不提供完整空间能流或干涉仪双端口功率测量，不能据此声称能量消失或全局能量去向已验证。'
MICROSCOPE_LIMIT = '复用显微镜场景的理想成像、视场、瑞利分辨率与物方全景深估计；景深取决于所选清晰度判据。不是三维搭建装置的实际性能或实测结果，不包含真实像差与照明。'
INSTRUMENT_LIMITS = {
    'microscope': MICROSCOPE_LIMIT,
    'camera': '复用相机场景的理想薄透镜成像、取景、几何景深、对焦衍射及像素采样计算。景深按允许光斑直径判定，不能将缩小光圈理解为无限提高清晰度；不是三维装置或真实相机的实际性能。',
    'telescope': '复用望远镜场景的理想近轴成像、视场、出瞳和物镜瑞利角分辨率计算。角放大率仅在平行出射时定义，物镜分辨极限不等于实际入眼分辨能力；不含像差与大气扰动，也不是三维装置的实际性能。',
}


def model_physics(scene_id):
    model = RESEARCH_MODELS[scene_id]['model']
    return 'ideal-' + model if model in INSTRUMENT_MODELS else 'ideal-coherent-interference'


def model_limit(scene_id):
    return INSTRUMENT_LIMITS.get(RESEARCH_MODELS[scene_id]['model'], MODEL_LIMIT)


class ResearchModelInput(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    state: SceneState

    @model_validator(mode='after')
    def supported(self):
        if not self.id.strip() or self.state.sceneId not in RESEARCH_MODELS:
            raise ValueError('请选择已接入的探究计算模型。')
        return self


def model_catalog():
    return [{'sceneId': key, 'title': definition['title'], 'model': definition['model'],
             'scope': definition['scope'], 'parameters': definition['parameters'],
             'physics': [model_physics(key)], 'limits': model_limit(key)}
            for key, definition in RESEARCH_MODELS.items()]


def compact(result):
    return {key: deepcopy(result[key]) for key in ['input', 'modelVersion', 'scope', 'status', 'metrics', 'warnings']}


class ResearchModels:
    def __init__(self, inputs=None, cancelled=None):
        self.inputs = {item.id: item.state.model_dump() for item in inputs or []}
        self.records = {}
        self.cancelled = cancelled

    def execute(self, args):
        if len(self.records) >= 3:
            raise ValueError('每轮最多完成三组模型实验。')
        scene_id, base_id = args['sceneId'], args.get('baseModelId')
        if scene_id not in RESEARCH_MODELS:
            raise ValueError('该模型尚未接入探究计算。')
        definition = RESEARCH_MODELS[scene_id]
        base = self.inputs.get(base_id) if base_id is not None else None
        if base_id is not None and (base is None or base['sceneId'] != scene_id):
            raise ValueError('原模型参数不存在或属于另一场景。')
        patch = validate_parameters(scene_id, args.get('parameters', {}), partial=True)
        parameters = deepcopy(base['parameters']) if base else {p['key']: p['default'] for p in definition['parameters']}
        state = SceneState.model_validate(patch_scene_parameters({'version': 1, 'sceneId': scene_id, 'parameters': parameters}, patch)).model_dump()
        scan = args.get('scan')
        candidates = []
        if scan is not None:
            if not isinstance(scan, dict) or set(scan) != {'field', 'values'} or not isinstance(scan['field'], str) or not isinstance(scan['values'], list) or not 2 <= len(scan['values']) <= 21:
                raise ValueError('请提供一个有效扫描参数及2至21个取值。')
            for value in scan['values']:
                row_patch = validate_parameters(scene_id, {scan['field']: value}, partial=True)
                candidates.append(SceneState.model_validate(patch_scene_parameters(state, row_patch)).model_dump())
        def compute(candidate):
            if self.cancelled and self.cancelled():
                from .agent import AgentError
                raise AgentError('已停止本轮探究，未保存不完整的模型结果。', 499)
            return calculate(candidate)
        evidence = compute(state)
        rows = [{'value': value, 'result': compact(compute(candidate))} for value, candidate in zip(scan['values'] if scan else [], candidates)]
        id = base_id if base and state == base else str(uuid4())
        prior = self.records.get(id)
        scans = deepcopy(prior['scans']) if prior else []
        if scan:
            if len(scans) >= 2:
                raise ValueError('每个模型每轮最多两组扫描。')
            scans.append({'field': scan['field'], 'rows': rows})
        result = {'id': id, 'state': state, 'evidence': evidence, 'scans': scans,
                  'limits': model_limit(scene_id), 'defaultParameters': [] if base else [p['key'] for p in definition['parameters'] if p['key'] not in patch]}
        self.inputs[id] = deepcopy(state)
        self.records.pop(id, None)
        self.records[id] = result
        # Keep full plotting data in the research record, not in model context.
        return deepcopy(result | {'evidence': compact(evidence)})
