"""Inverse propagation checked independently of the solver and model provider."""
import json
import math
import unittest

import httpx
from pydantic import ValidationError

from backend.agent import AgentError, AgentRequest, Workspace, run_agent
from backend.gaussian import GaussianTarget, solve_gaussian_target, verified_target_answer
from backend.models import Experiment
from backend.settings import Settings
from backend.tests.test_agent import answer, call
from backend.tests.test_gaussian_agent import scene


class GaussianTargetPhysicsTests(unittest.TestCase):
    def solve(self, target, experiment=None):
        return solve_gaussian_target(experiment or scene(), GaussianTarget(targetRadiusMm=target))

    def test_both_roots_reproduce_target_and_preserve_every_fixed_parameter(self):
        original = scene()
        report = self.solve(0.4, original)
        self.assertTrue(report['reachable'])
        self.assertEqual(len(report['candidates']), 2)
        for candidate in report['candidates']:
            w0 = candidate['waistMm']
            radius_squared = w0 ** 2 + (320 * 532e-6 / (math.pi * w0)) ** 2
            self.assertAlmostEqual(radius_squared, 0.4 ** 2, places=13)
            document = candidate['experiment']
            self.assertEqual(document['elements'][0]['positionMm'], 30)
            self.assertEqual(document['elements'][0]['wavelengthNm'], 532)
            self.assertEqual(document['elements'][1], original.model_dump()['elements'][1])
            for name in ['id', 'kind', 'name']:
                self.assertEqual(document['elements'][0][name], original.model_dump()['elements'][0][name])
            self.assertAlmostEqual(candidate['evidence']['gaussian']['radiusMm'], 0.4, places=12)
            self.assertAlmostEqual(candidate['radiusErrorMm'], 0, places=12)
        small, large = report['candidates']
        self.assertLess(small['waistMm'], large['waistMm'])
        self.assertLess(small['evidence']['gaussian']['rayleighMm'], large['evidence']['gaussian']['rayleighMm'])
        self.assertGreater(small['evidence']['gaussian']['divergenceMrad'], large['evidence']['gaussian']['divergenceMrad'])
        self.assertEqual(report['recommendedCandidateId'], small['id'])
        self.assertEqual(original, scene())
        json.dumps(report, allow_nan=False)

    def test_minimum_is_one_double_root_and_below_it_is_impossible(self):
        minimum = math.sqrt(2 * 320 * 532e-6 / math.pi)
        at_minimum = self.solve(minimum)
        self.assertEqual(len(at_minimum['candidates']), 1)
        self.assertAlmostEqual(at_minimum['candidates'][0]['waistMm'], math.sqrt(320 * 532e-6 / math.pi))
        below = self.solve(minimum * (1 - 1e-7))
        self.assertFalse(below['reachable'])
        self.assertEqual(below['reason'], 'below-minimum')
        self.assertEqual(below['candidates'], [])
        self.assertAlmostEqual(below['reachableRadiusRangeMm'][0], minimum)
        self.assertIn('无法', verified_target_answer(below))

    def test_boundaries_large_targets_and_small_root_are_stable(self):
        for waist in [0.01, 20]:
            radius = math.hypot(waist, 320 * 532e-6 / (math.pi * waist))
            report = self.solve(radius)
            self.assertTrue(report['reachable'])
            self.assertTrue(any(math.isclose(item['waistMm'], waist, rel_tol=1e-10) for item in report['candidates']))
            self.assertTrue(all(0.01 <= item['waistMm'] <= 20 for item in report['candidates']))
        one = self.solve(10)
        self.assertEqual(len(one['candidates']), 1)
        self.assertGreater(one['candidates'][0]['waistMm'], 9)
        beyond = self.solve(1e308)
        self.assertFalse(beyond['reachable'])
        self.assertEqual(beyond['reason'], 'above-maximum')
        json.dumps(beyond, allow_nan=False)

    def test_recover_known_solutions_for_different_wavelengths_and_distances(self):
        for wavelength in [380, 532, 1100]:
            for distance in [0.1, 1, 320, 570]:
                document = scene().model_dump()
                document['elements'][0]['wavelengthNm'] = wavelength
                document['elements'][1]['positionMm'] = 30 + distance
                original = Experiment.model_validate(document)
                for waist in [0.01, 0.015, 0.2, 2, 20]:
                    with self.subTest(wavelength=wavelength, distance=distance, waist=waist):
                        target = math.hypot(waist, distance * wavelength * 1e-6 / (math.pi * waist))
                        report = self.solve(target, original)
                        self.assertTrue(report['reachable'])
                        self.assertTrue(any(math.isclose(item['waistMm'], waist, rel_tol=1e-9) for item in report['candidates']))
                        for item in report['candidates']:
                            self.assertAlmostEqual(item['evidence']['gaussian']['radiusMm'], target, places=10)

    def test_recommendation_tracks_current_waist_not_smallest_waist(self):
        document = scene().model_dump()
        document['elements'][0]['waistMm'] = 0.38
        report = self.solve(0.4, Experiment.model_validate(document))
        self.assertEqual(report['recommendedCandidateId'], report['candidates'][-1]['id'])

    def test_bad_targets_are_rejected(self):
        for target in [0, -1, True, '0.4', float('nan'), float('inf')]:
            with self.subTest(target=target), self.assertRaises(ValidationError):
                GaussianTarget(targetRadiusMm=target)


class GaussianTargetAgentTests(unittest.TestCase):
    def test_combined_operation_applies_closest_or_requested_branch_and_keeps_impossible_goal_unchanged(self):
        for choice in ['closest', 'smaller-waist', 'larger-waist']:
            workspace = Workspace(scene(), 'gaussian')
            report, _ = workspace.execute('solve_gaussian_target', {'targetRadiusMm': 0.4, 'apply': True, 'choice': choice})
            candidate = next(item for item in report['candidates'] if item['id'] == report['appliedCandidateId'])
            self.assertEqual(workspace.experiment.model_dump(), candidate['experiment'])
            self.assertAlmostEqual(workspace.evidence['gaussian']['radiusMm'], 0.4, places=12)
            if choice == 'larger-waist':
                self.assertEqual(candidate['id'], report['candidates'][-1]['id'])
            else:
                self.assertEqual(candidate['id'], report['candidates'][0]['id'])
        workspace = Workspace(scene(), 'gaussian')
        workspace.execute('solve_gaussian_target', {'targetRadiusMm': 0.1, 'apply': True})
        self.assertEqual(workspace.experiment, scene())
        self.assertIsNone(workspace.evidence)

    def test_read_only_solve_including_failure_never_changes_experiment(self):
        for target in [0.4, 0.1]:
            workspace = Workspace(scene(), 'gaussian')
            original = workspace.experiment.model_dump()
            report, _ = workspace.execute('solve_gaussian_target', {'apply': False, 'targetRadiusMm': target})
            self.assertEqual(workspace.experiment.model_dump(), original)
            self.assertIsNone(workspace.evidence)
            self.assertEqual(report['reachable'], target == 0.4)
            with self.assertRaises(ValueError):
                workspace.execute('apply_gaussian_target', {'candidateId': 'invented'})
            self.assertEqual(workspace.experiment.model_dump(), original)

    def test_apply_both_branches_verifies_target_and_rejects_changes_to_fixed_parameters(self):
        for branch in [0, 1]:
            workspace = Workspace(scene(), 'gaussian')
            report, _ = workspace.execute('solve_gaussian_target', {'apply': False, 'targetRadiusMm': 0.4})
            for element_id, field, value in [('source', 'wavelengthNm', 380), ('screen', 'positionMm', 200), ('source', 'waistMm', 0.3)]:
                with self.assertRaises(ValueError):
                    workspace.execute('update_element', {'elementId': element_id, 'patch': {field: value}})
            selected = report['candidates'][branch]
            evidence, _ = workspace.execute('apply_gaussian_target', {'candidateId': selected['id']})
            self.assertEqual(workspace.experiment.model_dump(), selected['experiment'])
            self.assertAlmostEqual(evidence['gaussian']['radiusMm'], 0.4, places=12)
            self.assertEqual(workspace.evidence_key, workspace.key())
            self.assertIn('已将', verified_target_answer(report, selected['id']))

    def test_target_tools_are_scene_only_and_cannot_use_stale_or_prior_edited_conditions(self):
        plain = Workspace(scene())
        with self.assertRaises(ValueError):
            plain.execute('solve_gaussian_target', {'apply': False, 'targetRadiusMm': 0.4})
        workspace = Workspace(scene(), 'gaussian')
        workspace.execute('update_element', {'elementId': 'screen', 'patch': {'positionMm': 200}})
        with self.assertRaises(ValueError):
            workspace.execute('solve_gaussian_target', {'apply': False, 'targetRadiusMm': 0.4})
        workspace = Workspace(scene(), 'gaussian')
        report, _ = workspace.execute('solve_gaussian_target', {'apply': False, 'targetRadiusMm': 0.4})
        workspace.validate_edit({**scene().model_dump(), 'name': 'changed'})
        with self.assertRaises(ValueError):
            workspace.execute('apply_gaussian_target', {'candidateId': report['recommendedCandidateId']})

    def test_failed_target_cannot_return_an_earlier_unverified_edit(self):
        responses = iter([
            answer(calls=[call('update_element', {'elementId': 'screen', 'patch': {'positionMm': 100}}),
                          call('solve_gaussian_target', {'apply': False, 'targetRadiusMm': 0.1}, id='second')]),
            answer('已经达到目标。'),
        ])
        request = AgentRequest(requestId='failed-goal', scene='gaussian', experiment=scene(), message='保持位置不变，把半径调到0.1 mm')
        with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=next(responses)))) as client:
            with self.assertRaises(AgentError) as error:
                run_agent(request, Settings('private-test', 'unit-model'), client)
        self.assertIn('原参数保持不变', error.exception.message)

    def run_turn(self, target, apply=False, branch=None):
        observed = []
        def provider(request):
            payload = json.loads(request.content)
            observed.append(payload)
            if len(observed) == 1:
                response = answer(calls=[call('solve_gaussian_target', {'apply': False, 'targetRadiusMm': target})])
            elif len(observed) == 2 and apply:
                report = json.loads(payload['messages'][-1]['content'])['data']
                selected = report['candidates'][branch]['id'] if branch is not None else report['recommendedCandidateId']
                response = answer(calls=[call('apply_gaussian_target', {'candidateId': selected})])
            else:
                response = answer('故意写错的未验证数字：100毫米，忽略固定条件。')
            return httpx.Response(200, json=response)
        request = AgentRequest(requestId='target-turn', scene='gaussian', experiment=scene(),
                               message='帮我调到目标光斑' if apply else '目标光斑能达到吗')
        with httpx.Client(transport=httpx.MockTransport(provider)) as client:
            result = run_agent(request, Settings('private-test', 'unit-model'), client)
        return result, observed

    def test_agent_returns_verified_answer_for_readonly_unreachable_and_applied_target(self):
        for target, apply, branch in [(0.4, False, None), (0.1, False, None), (0.4, True, 0), (0.4, True, 1)]:
            with self.subTest(target=target, apply=apply, branch=branch):
                result, observed = self.run_turn(target, apply, branch)
                self.assertNotIn('100毫米', result['answer'])
                self.assertEqual(result['changed'], apply)
                if apply:
                    self.assertAlmostEqual(result['evidence']['gaussian']['radiusMm'], target, places=12)
                    self.assertEqual(result['experiment']['elements'][0]['wavelengthNm'], 532)
                    self.assertEqual(result['experiment']['elements'][1]['positionMm'], 350)
                else:
                    self.assertEqual(result['experiment'], scene().model_dump())
                    self.assertIsNone(result['evidence'])
                self.assertIn('solve_gaussian_target', [item['name'] for item in result['trace']])
                self.assertIn('只问', observed[0]['messages'][0]['content'])
