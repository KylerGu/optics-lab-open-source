import json
import unittest
from unittest.mock import patch
import httpx
from backend.spatial_agent import SpatialWorkspace
from backend.research_agent import ResearchAgentRequest, ResearchObject, ResearchWorkspace, run_research_agent
from backend.tests.test_research_builder import SETTINGS, apparatus, call, message, response, verified_proposal


def focus_proposal(goal, base):
    candidate = base.model_copy(deep=True)
    candidate.elements[1].focalLengthMm += 20
    w = SpatialWorkspace(candidate)
    w.execute('set_goal', {'criteria': [{'label': '焦距', 'elementId': 'lens', 'metric': 'element_field', 'field': 'focalLengthMm', 'operator': 'eq', 'value': candidate.elements[1].focalLengthMm}]})
    checks = w.calculate()['checks']
    return {'requestId': 'edit-focus', 'inputSnapshot': base.model_dump(), 'experiment': candidate.model_dump(),
            'changed': True, 'applyAllowed': True, 'checks': checks, 'evidence': w.evidence,
            'comparisons': [], 'trace': [], 'answer': '焦距已核验。'}


class UnifiedConversationTests(unittest.TestCase):
    def test_greeting_and_concept_use_same_rules_without_builder(self):
        for area, question in [('builder', '你好'), ('research', '移动屏会移动焦点吗')]:
            requests = []
            def provider(request):
                payload = json.loads(request.content)
                requests.append(payload)
                context = payload['messages'][0]['content']
                self.assertIn('"workspace": "' + area + '"', context)
                self.assertIn('"selectedElementId": "lens"', context)
                return response(message(text='你好！' if question == '你好' else '不会，屏只改变观察位置。'))
            seed = apparatus()
            request = ResearchAgentRequest(requestId='chat', message=question, experiment=seed,
                objects=[ResearchObject(id='o', source='draft', experiment=seed)], activeObjectId='o',
                conversationContext={'workspace': area, 'selectedElementId': 'lens'})
            with httpx.Client(transport=httpx.MockTransport(provider)) as client:
                result = run_research_agent(request, SETTINGS, client=client)
            self.assertEqual(len(requests), 1)
            self.assertEqual(result['apparatusEdits'], [])
            self.assertEqual(result['apparatusBuilds'], [])

    def test_modify_delegates_and_recomputes_then_keeps_same_object(self):
        original = apparatus()
        candidate = original.model_copy(deep=True)
        candidate.elements[1].focalLengthMm = 120
        counts = {'research': 0, 'builder': 0}
        def provider(request):
            payload = json.loads(request.content)
            research = any(t['function']['name'] == 'modify_research_apparatus' for t in payload['tools'])
            role = 'research' if research else 'builder'
            counts[role] += 1
            if research:
                if counts[role] == 1:
                    return response(message([call('simulate_apparatus', {}, 'before')]))
                if counts[role] == 2:
                    return response(message([call('modify_research_apparatus', {'goal':'把选中透镜焦距改为120mm，其余保持不变。'}, 'edit')]))
                if counts[role] == 3:
                    return response(message([call('simulate_apparatus', {}, 'after')]))
                self.assertIn('120', payload['messages'][0]['content'])
                return response(message(text='透镜焦距已核验为120mm。'))
            if counts['builder'] > 1:
                return response(message(text='焦距改为120mm，已计算。'))
            self.assertIn('lens', payload['messages'][-1]['content'])
            return response(message([
                call('set_goal', {'criteria':[{'label':'透镜焦距','elementId':'lens','metric':'element_field','field':'focalLengthMm','operator':'eq','value':120}]}, 'goal'),
                call('set_apparatus', {'experiment':candidate.model_dump()}, 'layout'),
                call('trace_light', {}, 'trace')]))
        request = ResearchAgentRequest(requestId='edit', message='先算原装置，再把选中透镜焦距改为120mm，再计算', experiment=original,
            objects=[ResearchObject(id='o',source='saved',experiment=original)],activeObjectId='o',
            conversationContext={'workspace':'builder','selectedElementId':'lens'})
        with httpx.Client(transport=httpx.MockTransport(provider)) as client:
            result = run_research_agent(request, SETTINGS, client=client)
        self.assertEqual(counts, {'research':4,'builder':2})
        self.assertEqual(result['activeObjectId'], 'o')
        self.assertEqual(len(result['objectSnapshots']), 1)
        self.assertEqual(result['apparatusBuilds'], [])
        self.assertEqual(result['apparatusEdits'][0]['reply']['inputSnapshot'], original.model_dump())
        self.assertEqual(result['inputSnapshot'], candidate.model_dump())
        self.assertTrue(result['evidence']['screens'])
        self.assertEqual(result['parameterHistory'][0]['inputSnapshot'], original.model_dump())
        self.assertNotEqual(result['parameterHistory'][0]['evidence']['screens'], result['evidence']['screens'])

    def test_failed_edit_keeps_original_and_edit_after_computation_preserves_evidence(self):
        original=apparatus()
        def fail(goal, base):
            raise ValueError('目标未通过核验')
        w=ResearchWorkspace(objects=[ResearchObject(id='o',source='draft',experiment=original)],active_object_id='o',builder=fail)
        with self.assertRaisesRegex(ValueError,'未通过'):
            w.execute('modify_research_apparatus',{'goal':'改焦距'})
        self.assertEqual(w.original, original)
        self.assertEqual(w.reply('r','完成',[])['apparatusEdits'],[])
        w=ResearchWorkspace(objects=[ResearchObject(id='o',source='draft',experiment=original)],active_object_id='o',builder=lambda goal,base:verified_proposal(base))
        w.execute('simulate_apparatus',{})
        w.execute('modify_research_apparatus',{'goal':'改焦距'})
        result = w.reply('r','完成',[])
        self.assertIsNotNone(result['evidence'])
        self.assertIsNotNone(result['parameterHistory'][0]['evidence'])

    def test_calculate_edit_calculate_and_repeat_retains_each_stage_and_references(self):
        seed = apparatus()
        w = ResearchWorkspace(objects=[ResearchObject(id='o', source='draft', experiment=seed)], active_object_id='o', builder=focus_proposal)
        initial, _ = w.execute('simulate_apparatus', {})
        scan = {'elementId':'lens','field':'focalLengthMm','start':80,'stop':120,'count':3}
        first_scan, _ = w.execute('compare_parameter', scan)
        w.execute('offer_visual_action', {'elementId':'lens','kind':'adjust','field':'focalLengthMm','explanation':'看焦距'})
        for index in range(1, 4):
            w.execute('modify_research_apparatus', {'goal':'增加20mm焦距'})
            result, _ = w.execute('simulate_apparatus', {})
            self.assertEqual(result['recordReference']['recordId'], f'v{index}:simulation')
            self.assertEqual(w.original.elements[1].focalLengthMm, 100 + 20 * index)
            if index == 1:
                second_scan, _ = w.execute('compare_parameter', scan)
        reply = w.reply('r', '完成前后比较', [])
        self.assertTrue(reply['editsApplyAllowed'])
        self.assertEqual([r['inputSnapshot']['elements'][1]['focalLengthMm'] for r in reply['parameterHistory']], [100,120,140])
        self.assertEqual(reply['objectResults'][0]['revision'], 3)
        self.assertEqual(reply['parameterHistory'][0]['evidence']['screens'], initial['screens'])
        radii = [r['evidence']['screens'][0]['gaussianRadiusMm'] for r in reply['parameterHistory']] + [reply['evidence']['screens'][0]['gaussianRadiusMm']]
        self.assertEqual(len(set(radii)), 4)
        self.assertEqual(seed.elements[1].focalLengthMm, 100)
        self.assertEqual(reply['visualActions'], [])
        self.assertIn(initial['recordReference'], w.available_evidence())
        self.assertIn(first_scan['recordReference'], w.available_evidence())
        self.assertIn(second_scan['recordReference'], w.available_evidence())
        self.assertNotEqual(first_scan['recordReference'], second_scan['recordReference'])
        with self.assertRaisesRegex(ValueError, '3次'):
            w.execute('modify_research_apparatus', {'goal':'再改'})
        self.assertFalse(w.reply('r','未完成',[])['editsApplyAllowed'])

    def test_later_failure_or_incomplete_turn_keeps_candidate_readings_but_disallows_application(self):
        w = ResearchWorkspace(objects=[ResearchObject(id='o', source='draft', experiment=apparatus())], active_object_id='o', builder=focus_proposal)
        w.execute('simulate_apparatus', {})
        w.execute('modify_research_apparatus', {'goal':'改焦距'})
        self.assertFalse(w.reply('r','超时',[],completed=False)['editsApplyAllowed'])
        def fail(goal, base):
            raise ValueError('第二次修改未通过')
        w.builder = fail
        with self.assertRaisesRegex(ValueError,'第二次'):
            w.execute('modify_research_apparatus', {'goal':'再改'})
        result = w.reply('r','完成',[])
        self.assertFalse(result['editsApplyAllowed'])
        self.assertEqual(len(result['apparatusEdits']), 1)
        self.assertTrue(result['parameterHistory'][0]['evidence']['screens'])
        self.assertTrue(result['evidence']['screens'])

    def test_object_comparison_keeps_its_original_versions(self):
        w = ResearchWorkspace(objects=[ResearchObject(id=id, source='draft', experiment=apparatus()) for id in ['a','b']], active_object_id='a', builder=focus_proposal)
        group, _ = w.execute('compare_objects', {'objectIds':['a','b']})
        w.execute('modify_research_apparatus', {'goal':'改焦距'})
        self.assertEqual(w.reply('r','完成',[])['objectComparisons'][0]['revisions'], {'a':0,'b':0})
        self.assertIn(group['recordReference'], w.available_evidence())

    def test_computation_failure_after_edit_disallows_partial_application(self):
        responses = iter([
            message([call('simulate_apparatus', {}, 'before')]),
            message([call('modify_research_apparatus', {'goal':'改焦距'}, 'edit')]),
            message([call('compare_parameter', {'elementId':'missing','field':'focalLengthMm','start':80,'stop':120,'count':3}, 'invalid')]),
            message(text='比较未完成。')])
        request = ResearchAgentRequest(requestId='failure', message='先算再改再比较', experiment=apparatus(), objects=[ResearchObject(id='o',source='draft',experiment=apparatus())], activeObjectId='o')
        with patch('backend.research_agent.build_research_apparatus', side_effect=lambda goal, base, *args, **kwargs: focus_proposal(goal, base)), httpx.Client(transport=httpx.MockTransport(lambda _: response(next(responses)))) as client:
            result = run_research_agent(request, SETTINGS, client=client)
        self.assertFalse(result['editsApplyAllowed'])
        self.assertTrue(result['parameterHistory'][0]['evidence']['screens'])
        self.assertTrue(result['evidence']['screens'])


if __name__ == '__main__':
    unittest.main()
