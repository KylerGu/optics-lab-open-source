"""Opt-in real-model checks for natural conversation and focused experiments.

Run: python scripts/validate_inquiry_responses.py --live
No model calls without --live. Each run keeps its own raw replies. Tool/parameter
checks are automatic; teaching tone and explanation quality need human review.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.research_agent import PROMPT, ResearchAgentRequest, run_research_agent
from backend.settings import get_settings


APPARATUS = {
    'schemaVersion': 2, 'name': '透镜与观察屏示范', 'elements': [
        {'id': 'source', 'name': '激光', 'kind': 'laser', 'position': [0, 60, 0],
         'beamModel': 'gaussian', 'beamRadiusMm': 1, 'wavelengthNm': 532},
        {'id': 'lens', 'name': '透镜', 'kind': 'lens', 'position': [100, 60, 0], 'focalLengthMm': 100},
        {'id': 'screen', 'name': '观察屏', 'kind': 'screen', 'position': [200, 60, 0]},
    ],
}
MODEL = {'id': 'existing-double-slit', 'state': {'sceneId': 'interference-0',
         'parameters': {'wavelengthNm': 532, 'slitDistanceMm': .4, 'screenDistanceM': 1.5, 'observationMm': .2}}}
CASES = [
    {'id': 'visual_locate', 'message': '请在画面中帮我定位当前装置的透镜。', 'experiment': APPARATUS,
     'review': '提供透镜定位入口，不声称已经跳页，不擅自修改或计算。'},
    {'id': 'visual_adjust', 'message': '我想自己调透镜焦距，请给我跳到对应参数的入口，先不要替我修改或计算。', 'experiment': APPARATUS,
     'review': '提供透镜焦距参数入口，不改成坐标，不预先执行计算。'},
    {'id': 'visual_compare', 'message': '我想亲自移动当前观察屏，边调X位置边对比调整前后的光斑，给我打开这个对照的入口，不用先扫描。', 'experiment': APPARATUS,
     'review': '提供观察屏X位置的前后对照入口，解释等用户点击与调整，不预先扫描。'},
    {'id': 'hello', 'message': '你好', 'titleNeeded': True,
     'review': '自然简短回应，不猜测知识障碍，不启动实验、计划或测验。'},
    {'id': 'hello_after_experiment', 'message': '你好', 'experiment': APPARATUS,
     'history': [{'role': 'user', 'content': '我不明白移动观察屏和焦点的关系。'},
                 {'role': 'assistant', 'content': '观察屏是读数平面；移动它不改变光束最细的位置。'}],
     'review': '已有实验上下文也不擅自恢复讲课或要求预测。'},
    {'id': 'definition', 'message': '瑞利长度是什么？',
     'review': '直接解释概念，不先调查水平、要求预测或自动安排实验。'},
    {'id': 'why', 'message': '为什么激光传播时会变宽？',
     'review': '直接回答原因，不仅因为出现“为什么”就推定误解或启动实验。'},
    {'id': 'compute', 'message': '计算当前装置在观察屏上的高斯光斑半径，给出结果即可。',
     'experiment': APPARATUS, 'review': '实际调用计算并简短返回读数，不先讲课或要求填写学习目标。'},
    {'id': 'change_parameter', 'message': '把当前双缝模型的波长改成650 nm并计算，其他参数不变。',
     'modelExperiments': [MODEL], 'review': '直接按指定波长计算，其他参数保留，不附加对照扫描或知识测验。'},
    {'id': 'distinction', 'message': '移动观察屏，焦点也会跟着移动吗？', 'experiment': APPARATUS,
     'review': '针对观察位置与光束最细位置解释，不给学生贴理解错误标签，不强制先做实验。'},
    {'id': 'demonstration', 'message': '请用当前装置做个对照实验，让我直观看到只移动观察屏时光斑怎么变。你可以选示范范围。',
     'experiment': APPARATUS, 'review': '选择针对移动观察屏的实际对照计算，保持光源和透镜不变，说明观察哪里。'},
]


def objective_checks(case, request, reply):
    actions = [step['name'] for step in reply['trace']]
    checks = {
        'no_unrequested_plan': not reply['plan'] and not any(
            name in actions for name in ['set_research_plan', 'update_research_step', 'assess_research_method']),
        'no_tool_errors': all(step['status'] == 'ok' for step in reply['trace']),
        'no_unrequested_build': not reply.get('apparatusBuilds'),
    }
    if case['id'].startswith('visual_'):
        wanted = {'visual_locate': ('locate', 'lens', None), 'visual_adjust': ('adjust', 'lens', 'focalLengthMm'), 'visual_compare': ('compare', 'screen', 'x')}[case['id']]
        visual = reply.get('visualActions', [])
        checks['correct_visual_target'] = len(visual) == 1 and (visual[0]['kind'], visual[0]['elementId'], visual[0]['field']) == wanted and (case['id'] != 'visual_compare' or visual[0]['screenId'] == 'screen')
        checks['no_premature_computation'] = not reply['evidence'] and not reply['comparisons'] and not reply.get('modelResults')
    if case['id'] in {'hello', 'hello_after_experiment', 'definition', 'why', 'compute', 'change_parameter'}:
        checks['no_unrequested_visual_action'] = not reply.get('visualActions')
    if case['id'] in {'hello', 'hello_after_experiment', 'definition', 'why', 'distinction'}:
        checks['direct_answer_without_tools'] = not actions
    if request.experiment:
        checks['original_apparatus_preserved'] = reply['inputSnapshot'] == request.experiment.model_dump()
    if case['id'] == 'compute':
        screens = (reply.get('evidence') or {}).get('screens', [])
        checks['computed_screen_radius'] = 'simulate_apparatus' in actions and any(
            s['elementId'] == 'screen' and s.get('gaussianRadiusMm') is not None for s in screens)
        checks['no_extra_scan'] = not reply['comparisons']
    if case['id'] == 'change_parameter':
        records = reply.get('modelResults', [])
        wanted = {**MODEL['state']['parameters'], 'wavelengthNm': 650}
        checks['only_requested_parameter_changed'] = len(records) == 1 and records[0]['state']['parameters'] == wanted
        checks['no_extra_scan'] = len(records) == 1 and not records[0]['scans']
    if case['id'] == 'demonstration':
        scans = reply['comparisons']
        checks['screen_position_comparison'] = bool(scans) and all(
            c['elementId'] == 'screen' and c['field'] == 'x' and len(c['rows']) >= 3 for c in scans)
    return checks


def run_case(case, settings, output):
    request = ResearchAgentRequest(requestId=case['id'], **{
        k: v for k, v in case.items() if k not in {'id', 'review'}})
    record = {'case': case['id'], 'request': request.model_dump(), 'reviewCriteria': case['review'],
              'humanReview': 'pending'}
    try:
        reply = run_research_agent(request, settings)
        record.update(reply=reply, checks=objective_checks(case, request, reply))
    except Exception as error:
        # Preserve failures instead of silently retrying or selecting good answers.
        record.update(error=type(error).__name__, checks={'completed': False})
    (output / f"{case['id']}.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'case': case['id'], 'checks': record['checks'],
                      'answer': record.get('reply', {}).get('answer', ''), 'error': record.get('error')},
                     ensure_ascii=False), flush=True)
    return {'case': case['id'], 'checks': record['checks'], 'humanReview': 'pending'}


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true', help='Call the locally configured model; may incur API costs.')
    parser.add_argument('--case', choices=[c['id'] for c in CASES], action='append')
    args = parser.parse_args()
    cases = [c for c in CASES if not args.case or c['id'] in args.case]
    if not args.live:
        print(json.dumps([{'id': c['id'], 'message': c['message'], 'review': c['review']} for c in cases], ensure_ascii=False, indent=2))
        return
    settings = get_settings(research=True)
    if not settings.configured:
        raise SystemExit('AI服务未配置，未运行真实模型检查。')
    output = ROOT / 'output' / 'inquiry-responses' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    output.mkdir(parents=True)
    (output / 'manifest.json').write_text(json.dumps({'model': settings.model,
        'effort': settings.reasoning_effort, 'prompt': PROMPT, 'cases': cases,
        'scope': '开发者行为自测；客观检查不代替逐条审阅回复，不证明所有问法都可靠。'}, ensure_ascii=False, indent=2), encoding='utf-8')
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(run_case, case, settings, output) for case in cases]
        summaries = [future.result() for future in as_completed(futures)]
    (output / 'summary.json').write_text(json.dumps(summaries, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'结果已保存：{output}', flush=True)
    if not all(all(item['checks'].values()) for item in summaries):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
