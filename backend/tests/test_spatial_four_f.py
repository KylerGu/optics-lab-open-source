import math
import unittest
import numpy as np
from scipy.integrate import quad
from backend.spatial import SpatialElement,SpatialExperiment,trace
from backend.scene_four_f import FourF
from backend.spatial_four_f import field_at,calculate_spatial_four_f
from backend.spatial_components import slit_passes
from backend.spatial_agent import SpatialWorkspace


def apparatus(mode=0,w=.8,f=120,width=200,offset=0,m=1,probe=0,radius=20):
    def e(kind,id,x,**kw):return SpatialElement(kind=kind,id=id,name=id,position=[x,60,0],**kw)
    elements=[e('laser','s',38,beamModel='gaussian',beamRadiusMm=w,waistOffsetMm=2,rayCount=17),e('amplitude-grating','g',40,gratingProfile='sinusoidal',gratingModulation=m,gratingPeriodUm=160,gratingWidthMm=12*w,gratingHeightMm=12*w),e('lens','l1',40+f,focalLengthMm=f,diameterMm=60)]
    if mode!=2:
        mask=e('slit','mask',40+2*f,slitMode='pass' if mode==0 else 'stop',slitWidthMm=width*.001,slitHeightMm=30);mask.position=(40+2*f,60,offset*.001);elements.append(mask)
    elements.extend([e('lens','l2',40+3*f,focalLengthMm=f,diameterMm=60),e('screen','o',40+4*f,diameterMm=2*radius,probeOffsetMm=probe)])
    return SpatialExperiment(schemaVersion=2,name='4f',elements=elements)


class SpatialFourFTests(unittest.TestCase):
    def test_actual_apparatus_reproduces_low_high_all_and_selected_order(self):
        for mode,offset,T,I in [(0,0,2/3,.25),(1,0,1/3,.25),(2,0,1,1),(0,399,1/6,.0625)]:
            result=trace(apparatus(mode=mode,offset=offset));wave=result['fourF']
            self.assertAlmostEqual(wave['transmission'],T,places=7);self.assertAlmostEqual(wave['pointIntensity'],I,places=7)
            self.assertAlmostEqual(wave['inputPowerMw'],3.75,places=7);self.assertAlmostEqual(wave['outputPowerMw'],3.75*T,places=7)
            self.assertAlmostEqual(wave['capturedPowerMw'],wave['outputPowerMw'],places=6)
            self.assertFalse(result['warnings']);self.assertEqual(len(result['gratingOrders'][0]['orders']),3)
            self.assertAlmostEqual(wave['points'][400]['xMm'],0,places=10)

    def test_analytic_field_matches_independent_frequency_quadrature(self):
        rng=np.random.default_rng(87)
        for _ in range(10):
            p=calculate_spatial_four_f(apparatus(width=float(rng.uniform(10,600)),offset=float(rng.uniform(-500,500)),w=float(rng.uniform(.5,2)),m=float(rng.uniform(0,1))))['parameters'];model=FourF(p)
            for x in [0,.12,1.5,5,20]:
                def frequency(nu):return math.sqrt(math.pi)*p['waistMm']/(1+p['modulation'])*sum(a*math.exp(-(model.alpha*(nu-c))**2) for c,a in model.components)
                real=quad(lambda nu:frequency(nu)*math.cos(2*math.pi*nu*x),model.lo,model.hi,epsabs=1e-10,limit=300)[0]
                imag=quad(lambda nu:-frequency(nu)*math.sin(2*math.pi*nu*x),model.lo,model.hi,epsabs=1e-10,limit=300)[0]
                self.assertLess(abs(field_at(model,x)-complex(real,imag)),2e-9)

    def test_finite_screen_power_is_integral_not_infinite_plane_transmission(self):
        doc=apparatus(mode=2,radius=.5,m=.6);wave=calculate_spatial_four_f(doc);p=wave['parameters'];b=FourF(p)
        value=quad(lambda x:b.input(x)**2*p['waistMm']*math.sqrt(math.pi/2)*math.erf(math.sqrt(2)*math.sqrt(.25-x*x)/p['waistMm']),-.5,.5,epsabs=1e-10)[0]*20/(math.pi*p['waistMm']**2)
        self.assertAlmostEqual(wave['capturedPowerMw'],value,places=7);self.assertLess(wave['capturedPowerMw'],wave['outputPowerMw'])
        narrow=calculate_spatial_four_f(apparatus(width=10,radius=.5));self.assertLess(narrow['capturedPowerMw'],.8*narrow['outputPowerMw'])
        blocked_rays=trace(apparatus(mode=1,width=800));self.assertGreater(blocked_rays['fourF']['capturedPowerMw'],0);self.assertFalse(blocked_rays['screens'][0]['hits']);self.assertFalse(blocked_rays['warnings'])

    def test_edits_recompute_or_invalidate_instead_of_replaying_scene(self):
        for w,f in [(.5,80),(2,130)]:
            doc=apparatus(w=w,f=f,probe=.31);wave=calculate_spatial_four_f(doc);self.assertAlmostEqual(wave['pointIntensity'],FourF(wave['parameters']).at(.31),places=6)
        for id,field,value in [('l1','position',(159,60,0)),('s','waistOffsetMm',0),('l2','focalLengthMm',100),('mask','position',(281,60,0)),('g','gratingProfile','binary'),('mask','rollDeg',90),('g','gratingWidthMm',1),('o','probeOffsetMm',21)]:
            doc=apparatus();element=next(e for e in doc.elements if e.id==id);setattr(element,field,value)
            self.assertIsNone(calculate_spatial_four_f(doc))
        doc=apparatus();doc.elements[3].position=(280,60,.399);self.assertAlmostEqual(calculate_spatial_four_f(doc)['transmission'],1/6,places=7)

    def test_stop_mask_geometry_and_builder_assistant_keep_wave_evidence(self):
        doc=apparatus();w=SpatialWorkspace(doc)
        w.execute('update_apparatus',dict(elementId='mask',patch=dict(slitMode='stop')))
        data,_=w.execute('trace_light',{});self.assertIn('fourF',data);self.assertAlmostEqual(data['fourF']['transmission'],1/3,places=7)
        mask=w.element('mask');self.assertFalse(slit_passes(mask,mask.position));self.assertTrue(slit_passes(mask,(280,60,1)))
        original=w.experiment.model_dump();data,_=w.execute('compare_parameter',dict(elementId='mask',field='slitWidthMm',start=.1,stop=.4,count=3))
        self.assertEqual(w.experiment.model_dump(),original);self.assertTrue(all(row['fourF'] for row in data['rows']))
        w.execute('set_goal',dict(criteria=[dict(label='高通透过功率比',metric='four_f_transmission',elementId='o',operator='eq',value=1/3,tolerance=1e-6)]))
        self.assertTrue(w.calculate()['checks'][0]['passed'])


if __name__=='__main__':unittest.main()
