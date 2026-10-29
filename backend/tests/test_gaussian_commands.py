"""Regression for explicit edits, including the two instructions in the report."""
import math
import unittest
from unittest.mock import patch

import httpx

from backend.agent import AgentError, AgentRequest, Workspace, run_agent
from backend.gaussian_commands import gaussian_action, gaussian_command
from backend.settings import Settings
from backend.tests.test_agent import answer, call
from backend.tests.test_gaussian_agent import scene


class GaussianCommandTests(unittest.TestCase):
    def test_reported_target_and_exact_waist_command_are_different_operations(self):
        target = gaussian_command('保持波长、束腰位置和观察位置不变，帮我把观察处的光斑半径调到 0.4 mm。')
        self.assertEqual((target.kind, target.value_mm), ('target', 0.4))
        waist = gaussian_command('调整到束腰半径为0.210448mm')
        self.assertEqual((waist.kind, waist.value_mm), ('waist', 0.210448))

    def test_units_diameter_and_branch_selection(self):
        for message, kind, value, choice in [
            ('把光斑直径设置成800微米', 'target', 0.4, 'closest'),
            ('把光斑半径调到0.4毫米，采用较大束腰的解', 'target', 0.4, 'larger-waist'),
            ('把光斑半径调到0.4mm，采用较小束腰的解', 'target', 0.4, 'smaller-waist'),
            ('把光斑半径调到0.4mm，如果有两个解选大的', 'target', 0.4, 'larger-waist'),
            ('把束腰半径改成150 μm，再计算观察处光斑', 'waist', 0.15, 'closest'),
        ]:
            with self.subTest(message=message):
                command = gaussian_command(message)
                self.assertEqual((command.kind, command.value_mm, command.choice), (kind, value, choice))

    def test_queries_previews_and_quoted_commands_are_not_edits(self):
        for message in [
            '光斑半径0.4mm能达到吗？',
            '光斑半径调到0.4mm能达到吗？',
            '如果把光斑半径调到0.4mm会怎样？',
            '把束腰半径调到0.2mm会不会更好？',
            '不要调整，先算算光斑半径0.4mm需要多大的束腰',
            '如何把光斑半径调到0.4mm？',
            '只计算，把光斑半径调到0.4mm有哪些解',
            '解释“把束腰半径调整到0.2mm”这句话',
        ]:
            with self.subTest(message=message):
                self.assertIsNone(gaussian_command(message))
                self.assertIs(gaussian_action(message), False)

    def test_missing_definition_units_and_compound_edits_stay_with_the_assistant(self):
        for message in ['把光斑调到0.4mm', '把光斑半径调到0.4', '把束腰半径改成0.2mm，波长改成600nm',
                        '把束腰半径改成0.2mm，再把波长调大']:
            self.assertIsNone(gaussian_command(message))

    def execute(self, message, history=None):
        request = AgentRequest(requestId='explicit-edit', scene='gaussian', experiment=scene(), message=message, history=history or [])
        with patch('backend.agent.completion') as provider:
            result = run_agent(request, Settings('private-test', 'unit-model'))
            provider.assert_not_called()
        return result

    def test_explicit_target_applies_every_time_without_provider_decision(self):
        message = '保持波长、束腰位置和观察位置不变，帮我把观察处的光斑半径调到 0.4 mm。'
        for _ in range(5):
            result = self.execute(message)
            self.assertTrue(result['changed'])
            self.assertAlmostEqual(result['evidence']['gaussian']['radiusMm'], 0.4, places=12)
            self.assertEqual(result['experiment']['elements'][0]['wavelengthNm'], 532)
            self.assertEqual(result['experiment']['elements'][0]['positionMm'], 30)
            self.assertEqual(result['experiment']['elements'][1]['positionMm'], 350)
            self.assertNotIn('尚未修改', result['answer'])

    def test_exact_waist_wins_over_previous_target_context(self):
        history = [
            {'role': 'user', 'content': '把光斑半径调到0.4mm'},
            {'role': 'assistant', 'content': '对应两个束腰，当前参数尚未修改。'},
        ]
        result = self.execute('调整到束腰半径为0.210448mm', history)
        self.assertTrue(result['changed'])
        self.assertEqual(result['experiment']['elements'][0]['waistMm'], 0.210448)
        expected = math.hypot(0.210448, 320 * 532e-6 / (math.pi * 0.210448))
        self.assertAlmostEqual(result['evidence']['gaussian']['radiusMm'], expected, places=12)
        self.assertEqual([step['name'] for step in result['trace']], ['update_element', 'simulate_experiment'])
        self.assertNotIn('两种束腰', result['answer'])

    def test_impossible_target_and_invalid_waist_never_apply(self):
        result = self.execute('把光斑半径调到0.1mm')
        self.assertFalse(result['changed'])
        self.assertEqual(result['experiment'], scene().model_dump())
        self.assertIn('无法', result['answer'])
        for message in ['把束腰半径改成0mm', '把束腰半径改成25mm']:
            with self.assertRaises(AgentError):
                self.execute(message)

    def test_model_apply_flag_cannot_override_readonly_question_or_clear_edit_request(self):
        for intent, proposed_apply, changed in [(False, True, False), (True, False, True)]:
            workspace = Workspace(scene(), 'gaussian', intent)
            workspace.execute('solve_gaussian_target', {'targetRadiusMm': 0.4, 'apply': proposed_apply})
            self.assertEqual(workspace.experiment != scene(), changed)
            if not intent:
                for name, args in [('update_element', {'elementId': 'source', 'patch': {'waistMm': 0.1}}),
                                   ('apply_gaussian_target', {'candidateId': workspace.gaussian_target['recommendedCandidateId']})]:
                    with self.assertRaises(ValueError):
                        workspace.execute(name, args)

    def test_followup_edit_intent_overrides_model_false_flag(self):
        responses = iter([answer(calls=[call('solve_gaussian_target', {'targetRadiusMm': 0.4, 'apply': False})]), answer('没有修改。')])
        request = AgentRequest(requestId='followup', scene='gaussian', experiment=scene(), message='你调整啊',
                               history=[{'role':'user','content':'观察处光斑半径0.4mm能达到吗？'}])
        with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200,json=next(responses)))) as client:
            result = run_agent(request, Settings('private-test', 'unit-model'), client)
        self.assertTrue(result['changed'])
        self.assertAlmostEqual(result['evidence']['gaussian']['radiusMm'], 0.4, places=12)
