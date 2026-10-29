import unittest
from backend.scene_agent import SceneAgentRequest, scene_change_context
from backend.scene_physics import DEFINITIONS, calculate
from backend.tests.test_scene_physics import state

class GeometricalInteractionTests(unittest.TestCase):
    def test_each_imaging_scene_recalculates_recent_change(self):
        ids=[key for key in DEFINITIONS if key.startswith(('reflection-refraction-', 'paraxial-', 'instruments-', 'aberrations-')) and key != 'instruments-0']
        self.assertEqual(len(ids), 10)
        for key in ids:
            with self.subTest(scene=key):
                field=next(p for p in DEFINITIONS[key]['parameters'] if not p.get('options') and p['default']+p['step']<=p['max'])
                before=state(key)
                after=state(key, **{field['key']:field['default']+field['step']})
                request=SceneAgentRequest(requestId='change',state=after,message='刚才改了什么？',recentChange={'before':before,'after':after,'source':'user'})
                context=scene_change_context(request.recentChange)
                self.assertEqual([p['key'] for p in context['parameters']], [field['key']])
                for side, snapshot in [('before', before), ('after', after)]:
                    expected={m['key']:m['value'] for m in calculate(snapshot)['metrics']}
                    for metric in context[side]['metrics']:
                        self.assertEqual(metric['value'], expected[metric['key']])
