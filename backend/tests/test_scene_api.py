import unittest
import json
from fastapi.testclient import TestClient
from backend.app import app
from backend.tests.test_scene_physics import state


class SceneApiTests(unittest.TestCase):
    def test_scene_request_response_identity_and_validation(self):
        client=TestClient(app)
        source=state('reflection-refraction-0').model_dump()
        response=client.post('/api/scenes/calculate',json={'state':source,'revision':'test'})
        self.assertEqual(response.status_code,200)
        result=response.json();self.assertEqual(result['input'],source);self.assertEqual(result['revision'],'test')
        source['parameters']['n1']=True
        self.assertEqual(client.post('/api/scenes/calculate',json={'state':source}).status_code,422)
        self.assertEqual(client.post('/api/scenes/formula',json={'formulaId':'thin-lens','target':'v','values':{'f':100,'u':200}}).json()['values'],[200])
        self.assertEqual(client.post('/api/scenes/formula',json={'formulaId':'thin-lens','target':'v','values':{'f':None,'u':200}}).status_code,422)

    def test_full_precision_scene_parameters_survive_api_identity(self):
        client=TestClient(app)
        source=state('aberrations-1',R=60.12345678901234,diameter=30.12345678901234,edge=2.12345678901234,A=1.51234567890123,B=.00412345678901234,wavelength=550.1234567890123,screen=60.12345678901234).model_dump()
        revision=json.dumps([source['sceneId'],*source['parameters'].values()])
        self.assertGreater(len(revision),100)
        response=client.post('/api/scenes/calculate',json={'state':source,'revision':revision})
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['revision'],revision)
        self.assertEqual(response.json()['input'],source)
