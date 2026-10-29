import unittest
from pydantic import ValidationError
from backend.research_method import ResearchMethod
from backend.research_agent import ResearchWorkspace
from backend.tests.test_research_agent import apparatus


def method(required=None, used=None, remaining=''):
    return {'question': '核对研究问题中的物理现象', 'method': '固定其他参数并观察可区分解释的读数',
            'questionRequires': required or ['gaussian-envelope'],
            'calculationUses': ['gaussian-envelope'] if used is None else used,
            'calculationQuestion': '固定条件下的高斯光束读数' if used != [] else '',
            'remainingQuestion': remaining}


class ResearchMethodTests(unittest.TestCase):
    def test_unknown_empty_or_unsupported_physics_cannot_be_declared_supported(self):
        self.assertEqual(ResearchMethod.model_validate(method()).coverage, 'supported')
        with self.assertRaises(ValidationError):
            ResearchMethod.model_validate(method(required=['invented-model']))
        with self.assertRaises(ValidationError):
            ResearchMethod.model_validate({**method(), 'questionRequires': []})
        unsupported = method(required=['coherent-path-interference'], used=['coherent-path-interference'], remaining='两路光的相位相干叠加')
        self.assertEqual(ResearchMethod.model_validate(unsupported).coverage, 'unsupported')
        with self.assertRaises(ValidationError):
            ResearchMethod.model_validate({**unsupported, 'remainingQuestion': ''})

    def test_calculation_requires_preflight_and_blocked_attempt_cannot_be_reported_completed(self):
        w = ResearchWorkspace(apparatus(), require_method=True)
        with self.assertRaises(ValueError):
            w.execute('simulate_apparatus', {})
        reply = w.reply('r', '实验做出来了，已验证原问题。', [])
        self.assertNotIn('实验做出来了', reply['answer'])
        self.assertIn('没有完成实验验证', reply['answer'])
        self.assertIsNone(reply['evidence'])
        with self.assertRaises(ValueError):
            w.execute('assess_research_method', method())
        w.execute('read_research', {})
        w.execute('assess_research_method', method())
        result, _ = w.execute('simulate_apparatus', {})
        self.assertEqual(result['questionScope']['coverage'], 'supported')
        self.assertEqual(w.reply('r', '实际参数下的读数。', [])['methodAssessment']['coverage'], 'supported')

    def test_partial_validation_stays_partial_without_changing_calculation_data(self):
        original = apparatus()
        w = ResearchWorkspace(original, require_method=True)
        w.execute('read_research', {})
        scope = method(required=['coherent-path-interference'], used=['ray-geometry'], remaining='两路相消时的能量分布')
        assessed, _ = w.execute('assess_research_method', scope)
        self.assertEqual(assessed['coverage'], 'partial')
        data, _ = w.execute('simulate_apparatus', {})
        independent = ResearchWorkspace(original)
        reference, _ = independent.execute('simulate_apparatus', {})
        self.assertEqual(data['screens'], reference['screens'])
        self.assertEqual(w.reply('r', '说明', [])['inputSnapshot'], original.model_dump())
        self.assertEqual(data['questionScope']['coverage'], 'partial')
        reply = w.reply('r', '这是相关计算，不是原现象的验证。', [])
        self.assertEqual(reply['answer'], '这是相关计算，不是原现象的验证。')
        self.assertNotIn(scope['remainingQuestion'], reply['answer'].split('\n\n')[0])
        self.assertEqual(reply['methodAssessment']['coverage'], 'partial')
        with self.assertRaises(ValueError):
            w.execute('assess_research_method', {**method(required=['ray-geometry'], used=['ray-geometry']), 'question': scope['question']})

    def test_no_supported_method_blocks_building_and_scans_without_consuming_builder(self):
        called = []
        w = ResearchWorkspace(apparatus(), require_method=True, builder=lambda *args: called.append(args))
        w.execute('read_research', {})
        w.execute('assess_research_method', method(required=['general-wave-propagation'], used=[], remaining='一般孔径后的波动传播'))
        with self.assertRaises(ValueError):
            w.execute('build_research_apparatus', {'goal': '创建替代装置'})
        with self.assertRaises(ValueError):
            w.execute('compare_parameter', {'elementId': 'lens', 'field': 'focalLengthMm', 'start': 80, 'stop': 120, 'count': 5})
        self.assertEqual(called, [])
        self.assertEqual(w.available_evidence(), [])
        self.assertFalse(w.build_attempted)
        self.assertNotIn('实验已经完成', w.reply('r', '实验已经完成', [])['answer'])

    def test_declared_capability_is_not_verified_if_actual_readings_do_not_contain_it(self):
        w = ResearchWorkspace(apparatus(), require_method=True)
        w.execute('read_research', {})
        w.execute('assess_research_method', method(required=['parameter-errors'], used=['parameter-errors']))
        data, _ = w.execute('simulate_apparatus', {})
        self.assertEqual(data['questionScope']['coverage'], 'partial')
        self.assertIn('位置与焦距偏差', data['questionScope']['remainingQuestion'])
        self.assertEqual(w.reply('r', '当前装置读数', [])['answer'], '当前装置读数')

    def test_pure_knowledge_or_planning_is_allowed_without_artificial_experiments(self):
        w = ResearchWorkspace(require_method=True)
        reply = w.reply('r', '理论说明，没有宣称进行实验。', [])
        self.assertEqual(reply['answer'], '理论说明，没有宣称进行实验。')
        self.assertIsNone(reply['methodAssessment'])
        self.assertIsNone(reply['evidence'])
