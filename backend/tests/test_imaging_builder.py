import copy
import json
import time
import unittest
from unittest.mock import patch

import httpx

from backend.research_builder import build_research_apparatus
from backend.spatial import SpatialExperiment
from backend.spatial_agent import SpatialWorkspace
from backend.tests.test_research_builder import SETTINGS, call, message, response


def apparatus():
    return SpatialExperiment.model_validate({'schemaVersion': 2, 'name': '凸透镜成像', 'elements': [
        {'id': 'object', 'name': '物体', 'kind': 'object', 'position': [0, 60, 0]},
        {'id': 'lens', 'name': '凸透镜', 'kind': 'lens', 'position': [200, 60, 0], 'focalLengthMm': 100, 'diameterMm': 25},
        {'id': 'screen', 'name': '观察屏', 'kind': 'screen', 'position': [400, 60, 0], 'diameterMm': 40},
    ]})


def criteria():
    return [{'label': '清晰成像', 'elementId': 'screen', 'otherId': 'object', 'metric': 'image_focused', 'operator': 'eq', 'value': 1},
            {'label': '倒立等大', 'elementId': 'screen', 'otherId': 'object', 'metric': 'image_magnification', 'operator': 'eq', 'value': -1, 'tolerance': 1e-6}]


class ImagingBuilderTests(unittest.TestCase):
    def test_imaging_checks_use_image_not_laser_power_and_react_to_geometry(self):
        workspace = SpatialWorkspace(apparatus())
        workspace.execute('set_goal', {'criteria': criteria()})
        result = workspace.calculate()
        self.assertTrue(all(c['passed'] for c in result['checks']))
        self.assertEqual(result['screens'][0]['sampledPowerMw'], 0)
        observation = result['imaging'][0]['observations'][0]
        self.assertEqual(observation['magnification'], -1)
        self.assertGreater(observation['hits'], 0)
        self.assertNotIn('segments', result['imaging'][0])
        workspace.update('screen', {'position': [410, 60, 0]})
        self.assertFalse(any(c['passed'] for c in workspace.calculate()['checks']))
        workspace.update('screen', {'position': [400, 160, 0]})
        self.assertFalse(workspace.calculate()['checks'][0]['passed'])

    def test_unsupported_lens_and_ambiguous_objects_cannot_pass(self):
        for change in ['physical', 'two-objects']:
            document = apparatus().model_dump()
            if change == 'physical':
                document['elements'][1]['kind'] = 'biconvex-lens'
            else:
                document['elements'].append(document['elements'][0] | {'id': 'other'})
            workspace = SpatialWorkspace(SpatialExperiment.model_validate(document))
            goal = criteria()[0] | {'otherId': None}
            workspace.execute('set_goal', {'criteria': [goal]})
            self.assertFalse(workspace.calculate()['checks'][0]['passed'])

    def test_real_calculation_finishes_delegated_imaging_in_one_model_round(self):
        requests = []
        def provider(request):
            requests.append(json.loads(request.content))
            if len(requests) > 1:
                return response(message(text='已成倒立等大的像。'))
            return response(message([call('set_goal', {'criteria': criteria()}, 'goal'),
                                     call('set_apparatus', {'experiment': apparatus().model_dump()}, 'build')]))
        with httpx.Client(transport=httpx.MockTransport(provider)) as client:
            result = build_research_apparatus('搭建凸透镜成像光路', None, SETTINGS, client, None, None)
        self.assertEqual(len(requests), 2)
        self.assertTrue(result['applyAllowed'])
        self.assertTrue(all(c['passed'] for c in result['checks']))
        self.assertEqual([e['kind'] for e in result['experiment']['elements']], ['object', 'lens', 'screen'])
        # Handoff independently recalculates geometry instead of trusting a flag.
        forged = copy.deepcopy(result)
        forged['experiment']['elements'][-1]['position'] = [410, 60, 0]
        with patch('backend.research_builder.run_spatial_agent', return_value=forged):
            recalculated = build_research_apparatus('搭建凸透镜成像光路', None, SETTINGS, None, None, None)
            self.assertFalse(recalculated['checks'][0]['passed'])
