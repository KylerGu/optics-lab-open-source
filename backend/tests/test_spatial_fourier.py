import math
import unittest
from scipy.integrate import quad
from backend.spatial import SpatialElement,SpatialExperiment,trace
from backend.spatial_fourier import calculate_spatial_fourier,spectrum_screen_power
from backend.scene_fourier_lens import fourier_values,fourier_at
from backend.spatial_agent import SpatialWorkspace


def apparatus(w=.8,f=120,d=160,m=1,probe=0,radius=20):
    def e(kind,id,x,**kw):return SpatialElement(kind=kind,id=id,name=id,position=[x,60,0],**kw)
    return SpatialExperiment(schemaVersion=2,name='Fourier',elements=[
        e('laser','s',10,beamModel='gaussian',beamRadiusMm=w,waistOffsetMm=30,rayCount=17),
        e('amplitude-grating','g',40,gratingProfile='sinusoidal',gratingModulation=m,gratingPeriodUm=d,gratingWidthMm=12*w,gratingHeightMm=12*w),
        e('lens','l',40+f,focalLengthMm=f,diameterMm=60),
        e('screen','o',40+2*f,diameterMm=2*radius,probeOffsetMm=probe)])


class SpatialFourierTests(unittest.TestCase):
    def test_copy_reproduces_spectrum_and_selected_observer(self):
        for m,probe in [(1,0),(1,.399),(.4,-.399),(0,.03)]:
            result=trace(apparatus(m=m,probe=probe));wave=result['fourier'];p=wave['parameters']
            self.assertAlmostEqual(wave['orderPositionUm'],399)
            self.assertAlmostEqual(wave['pointIntensity'],fourier_at(p)['intensity'])
            self.assertAlmostEqual(wave['capturedPowerMw'],wave['inputPowerMw'],places=8)
            self.assertFalse(result['warnings']);self.assertIsNone(result['fourF'])
        self.assertAlmostEqual(trace(apparatus())['fourier']['capturedPowerMw'],3.75)

    def test_spectrum_matches_independent_input_field_transform(self):
        for w,d,m in [(.5,.4,.7),(.8,.16,1),(2,.08,.4),(.5,.4,0)]:
            p=calculate_spatial_fourier(apparatus(w=w,d=d*1000,m=m))['parameters'];b=fourier_values(p)
            def transform(x):
                nu=x*.001/(p['wavelengthNm']*1e-6*p['focalLengthMm'])
                return quad(lambda t:math.exp(-(t/w)**2)*(1+m*math.cos(2*math.pi*t/d))/(1+m)*math.cos(2*math.pi*t*nu),-7*w,7*w,epsabs=1e-11,limit=500)[0]
            centre=transform(0)
            for x in [0,b['spotRadiusUm']/2,b['orderPositionUm'],b['orderPositionUm']+b['spotRadiusUm']]:
                self.assertAlmostEqual(fourier_at(p,x)['intensity'],(transform(x)/centre)**2,places=8)

    def test_finite_screen_resolves_narrow_orders_and_clipping(self):
        wave=calculate_spatial_fourier(apparatus(f=250,d=80,radius=.5))
        self.assertAlmostEqual(wave['capturedPowerMw'],2.5,places=8)
        self.assertAlmostEqual(wave['inputPowerMw'],3.75,places=8)
        p=calculate_spatial_fourier(apparatus(m=0))['parameters'];radius=fourier_values(p)['spotRadiusUm']*.001/2
        self.assertAlmostEqual(spectrum_screen_power(p,10,radius),10*(1-math.exp(-.5)),places=8)
        wave=calculate_spatial_fourier(apparatus(w=.5,d=400,radius=.5));p=wave['parameters'];b=fourier_values(p);wf=b['spotRadiusUm']*.001;order=b['orderPositionUm']*.001
        def integrand(x):
            amplitude=sum(a*math.exp(-((x-c)/wf)**2) for c,a in [(0,1),(-order,.5),(order,.5)])/2
            return amplitude**2*wf*math.sqrt(math.pi/2)*math.erf(math.sqrt(2)*math.sqrt(max(0,.25-x*x))/wf)
        independent=quad(integrand,-.5,.5,points=[-order,0,order],epsabs=1e-12,limit=300)[0]*20/(math.pi*wf**2)
        self.assertAlmostEqual(wave['capturedPowerMw'],independent,places=8)

    def test_device_edits_recalculate_or_invalidate_wave_result(self):
        for id,field,value in [('l','position',(161,60,0)),('s','waistOffsetMm',0),('g','gratingProfile','binary'),('g','gratingWidthMm',1),('o','yawDeg',1)]:
            doc=apparatus();setattr(next(e for e in doc.elements if e.id==id),field,value)
            self.assertIsNone(calculate_spatial_fourier(doc))
        doc=apparatus(d=200);self.assertAlmostEqual(calculate_spatial_fourier(doc)['orderPositionUm'],319.2)
        doc=apparatus();doc.elements.append(SpatialElement(kind='filter',id='extra',name='extra',position=[60,60,0]))
        self.assertIsNone(calculate_spatial_fourier(doc))
        doc=apparatus();doc.elements[2].position=(161,60,0);result=trace(doc)
        self.assertIsNone(result['fourier']);self.assertTrue(any('傅里叶' in x for x in result['warnings']))

    def test_assistant_keeps_real_evidence_and_readonly_comparisons(self):
        workspace=SpatialWorkspace(apparatus(probe=.399));original=workspace.experiment.model_dump()
        data,_=workspace.execute('trace_light',{});self.assertAlmostEqual(data['fourier']['pointIntensity'],.25)
        data,_=workspace.execute('compare_parameter',dict(elementId='g',field='gratingPeriodUm',start=160,stop=200,count=3))
        self.assertEqual(workspace.experiment.model_dump(),original)
        self.assertTrue(all(row['fourier'] for row in data['rows']))
        self.assertAlmostEqual(workspace.comparisons[-1]['rows'][-1]['fourier']['orderPositionUm'],319.2)
        workspace.execute('set_goal',dict(criteria=[dict(label='一级光强',metric='fourier_intensity',elementId='o',operator='eq',value=.25,tolerance=1e-6)]))
        self.assertTrue(workspace.calculate()['checks'][0]['passed'])


if __name__=='__main__':unittest.main()
