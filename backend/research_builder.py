"""Delegate apparatus generation to the existing builder, then verify the handoff."""
from copy import deepcopy
from uuid import uuid4

from .agent import AgentError
from .spatial import SpatialExperiment
from .spatial_agent import GoalArgs, SpatialAgentRequest, SpatialWorkspace, run_spatial_agent


def build_research_apparatus(goal, base, settings, client, progress, cancelled, diagnostics=None, original_message=None):
    seed = base.model_copy(deep=True) if base else SpatialExperiment(schemaVersion=2, name='待设计探究装置', elements=[])
    request = SpatialAgentRequest(requestId=str(uuid4()), experiment=seed, message=goal)
    proposal = run_spatial_agent(request, settings, client=client, progress=progress,
                                 cancelled=cancelled, delegated=True, diagnostics=diagnostics, original_message=original_message)
    if cancelled and cancelled():
        raise AgentError('已停止本轮探究，未加入生成装置。', 499)
    if not proposal['applyAllowed'] or not proposal['evidence']:
        raise ValueError('生成装置未完成计算，未加入探究对象。')
    candidate = SpatialExperiment.model_validate(proposal['experiment'])
    if not any(e.kind in {'laser', 'object'} for e in candidate.elements) or not any(e.kind in {'screen', 'power-meter', 'sensor', 'eye'} for e in candidate.elements):
        raise ValueError('生成方案缺少光源或探测器，不能继续计算探究。')
    # Reuse server-computed evidence only for the identical final parameters.
    verifier = SpatialWorkspace(candidate)
    verifier.criteria = GoalArgs.model_validate({'criteria': [c['criterion'] for c in proposal['checks']]}).criteria if proposal['checks'] else []
    verifier.comparisons = deepcopy(proposal['comparisons'])
    if proposal['evidence'].get('inputSnapshot') == candidate.model_dump():
        verifier.evidence = deepcopy(proposal['evidence'])
        verifier.evidence_key = verifier.key()
    verified = verifier.calculate()
    if any('停止追踪' in w or '上限' in w for w in verified['warnings']):
        raise ValueError('生成方案未能完整计算，未加入探究对象。')
    return proposal | {'checks': verified['checks'], 'evidence': verifier.evidence}
