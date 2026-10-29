"""Authoritative scene calculations, shared by the diagram, formulas and assistant."""
import json
import math
from pathlib import Path
from pydantic import Field, model_validator
from .models import StrictModel
from .scene_microscope_focus import normalize_microscope

DEFINITIONS = json.loads((Path(__file__).resolve().parents[1] / 'src' / 'sceneDefinitions.json').read_text(encoding='utf-8'))
RAD = math.pi / 180
VERSION = 'scene-physics-1'
FORMULAS = json.loads((Path(__file__).resolve().parents[1] / 'src' / 'opticsFormulas.json').read_text(encoding='utf-8'))


def solve_formula(formula_id, target, values):
    formula = next((f for f in FORMULAS if f['id'] == formula_id), None)
    if formula is None or target not in formula.get('targets', [f['key'] for f in formula['fields']]):
        raise ValueError('该公式不支持这个未知量。')
    fields = {f['key']: f for f in formula['fields']}
    required = set(formula.get('inputs', {}).get(target, set(fields)-{target}))
    if not isinstance(values, dict) or set(values) - set(fields) or required-set(values):
        raise ValueError('缺少公式已知量。')
    for key in required:
        value, field = values[key], fields[key]
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or not field['min'] <= value <= field['max']:
            raise ValueError(f"{field['label']}超出可计算范围。")
    def asin(value):
        if abs(value)>1+1e-12: raise ValueError('这些已知量没有实数角度解；请检查是否全反射或参数不一致。')
        return math.asin(max(-1,min(1,value)))/RAD
    def divide(a,b):
        if abs(b)<1e-14: raise ValueError('这组已知量无法确定有限且唯一的未知量。')
        return a/b
    note=''
    v=values
    if formula_id == 'brewster-angle':
        if abs(v['n1']-v['n2'])<1e-12:raise ValueError('两侧折射率相等，没有特定布儒斯特角。')
        result=math.degrees(math.atan(v['n2']/v['n1']))
        note='入射角从法线量起；此时p偏振反射率为零。'
    elif formula_id == 'crystal-separation':
        from .scene_polarization_refraction import crystal_values
        result=crystal_values(dict(ordinaryIndex=v['no'],extraordinaryIndex=v['ne'],axisAngleDeg=v['gamma'],thicknessMm=v['L']))['separationMm']
        note='单轴晶体平行平板正入射；忽略表面反射，出射光平行。'
    elif formula_id == 'waveplate-s3':
        from .scene_waveplate import tidy
        result=tidy(-math.sin(2*(v['alpha']-v['beta'])*RAD)*math.sin(v['delta']*RAD))
        note='归一化S₃=2Im(Ex Ey共轭)，绝对值1为圆偏振；符号使用本场景约定。'
    elif formula_id == 'malus-power':
        if target == 'Pout':
            result = 0. if v['theta']==90 else v['Pin']*math.cos(v['theta']*RAD)**2
        elif target == 'Pin':
            result = divide(v['Pout'],0. if v['theta']==90 else math.cos(v['theta']*RAD)**2)
        else:
            if v['Pin']==0:raise ValueError('零入射功率不能唯一确定夹角。')
            if v['Pout']>v['Pin']:raise ValueError('透射功率不能大于入射功率。')
            result = math.degrees(math.acos(math.sqrt(v['Pout']/v['Pin'])))
        if not fields[target]['min']<=result<=fields[target]['max']:raise ValueError('结果超出该公式支持的范围。')
        note = 'θ为两条轴的较小夹角，0–90°；只适用于线偏振光和理想偏振片。'
    elif formula_id == 'fiber-coupling-efficiency':
        from .scene_fiber_coupling import coupling_values
        result = coupling_values(dict(beamRadiusUm=v['w'],modeRadiusUm=v['wf'],offsetUm=v['d'],tiltDeg=v['theta'],wavelengthNm=v['lambda'],powerMw=1))['efficiencyPct']
        note = '高斯光场重叠；效率以百分比显示，不含端面反射。'
    elif formula_id == 'fiber-coupled-power':
        if target == 'Pout': result=v['Pin']*v['eta']/100
        elif target == 'Pin': result=divide(v['Pout']*100,v['eta'])
        else: result=divide(v['Pout']*100,v['Pin'])
        if not fields[target]['min'] <= result <= fields[target]['max']: raise ValueError('结果超出物理范围；耦合功率不能大于入射功率。')
        note = 'η以百分比输入，计算时除以100；不含后续传播损耗。'
    elif formula_id == 'fiber-na':
        if target == 'NA':
            if v['n1'] <= v['n2']: raise ValueError('纤芯折射率须高于包层；此时数值孔径不适用。')
            result = math.sqrt((v['n1']-v['n2'])*(v['n1']+v['n2']))
        elif target == 'n1':
            if v['NA'] <= 0: raise ValueError('导光要求正数值孔径。')
            result = math.hypot(v['NA'],v['n2'])
        else:
            if v['NA'] <= 0 or v['NA'] >= v['n1']: raise ValueError('需要正数值孔径且小于纤芯折射率。')
            result = math.sqrt(v['n1']**2-v['NA']**2)
        if not fields[target]['min'] <= result <= fields[target]['max']: raise ValueError('结果超出该公式支持的范围。')
        note = '理想过轴光线；空气中 sinθₐ=NA，不代表实际耦合效率。'
    elif formula_id == 'fiber-v':
        if target == 'V': result = 2*math.pi*v['a']*v['NA']/(v['lambda']*.001)
        elif target == 'a': result = v['V']*v['lambda']*.001/(2*math.pi*v['NA'])
        elif target == 'NA': result = v['V']*v['lambda']*.001/(2*math.pi*v['a'])
        else: result = 2*math.pi*v['a']*v['NA']/v['V']*1000
        note = 'a为半径，λ为真空波长；弱导近似下，V小于约2.405为单模区。'
    elif formula_id == 'fiber-cutoff':
        from .scene_fiber_modes import CUTOFF
        if target == 'lambdaC': result = 2*math.pi*v['a']*v['NA']/CUTOFF*1000
        elif target == 'a': result = v['lambdaC']*.001*CUTOFF/(2*math.pi*v['NA'])
        else: result = v['lambdaC']*.001*CUTOFF/(2*math.pi*v['a'])
        note = '固定折射率，λ>λc为单模；截止边界不是基模消失。'
    elif formula_id == 'directional-illuminance':
        order = math.log(.5) / math.log(math.cos(v['beta']*RAD))
        factor = (max(0., math.cos(v['alpha']*RAD)) if v['alpha'] < 90 else 0.)**order * (math.cos(v['gamma']*RAD) if v['gamma'] < 90 else 0.) / v['r']**2
        result = v['I0']*factor if target == 'E' else divide(v['E'], factor)
        note = '半强角β不是截止角；I₀为主轴光强，改变配光宽度不保持总光通量。'
    elif formula_id == 'point-source-illuminance':
        if target == 'E': result = v['I'] / v['r']**2
        elif target == 'I': result = v['E'] * v['r']**2
        else:
            if v['E'] <= 0 or v['I'] <= 0: raise ValueError('反求距离须有正光强和正照度；零照度不能确定唯一有限距离。')
            result = math.sqrt(v['I'] / v['E'])
        note = '点光源，中心垂直接收；光强 cd，距离 m，照度 lx。'
    elif formula_id == 'four-f-length':
        result=4*v['f'] if target=='L' else v['L']/4
        note='两镜间距2f，输入与输出各距相邻透镜f；全通时等大小倒像。'
    elif formula_id == 'four-f-bandwidth':
        if target=='nu':result=v['a']*.001/(2*v['lambda']*1e-6*v['f'])
        elif target=='a':result=v['nu']*2*v['lambda']*1e-6*v['f']*1000
        elif target=='lambda':result=divide(v['a']*.001,2*v['nu']*v['f']*1e-6)
        else:result=divide(v['a']*.001,2*v['nu']*v['lambda']*1e-6)
        note='a为全宽；居中狭缝保留±νc，偏移时该值为半带宽。'
    elif formula_id == 'four-f-output':
        from .scene_four_f import FourF
        if v['mode'] not in (0,1,2):raise ValueError('滤波方式必须为0、1或2。')
        p=dict(wavelengthNm=v['lambda'],periodMm=v['d'],waistMm=v['w'],modulation=v['m'],focalLengthMm=v['f'],filterWidthUm=v['a'],filterOffsetUm=v['c'],filterMode=v['mode'],observationMm=v['x'])
        result=FourF(p).at(v['x'])
        note='以输入中心光强为共同基准；先变换复振幅再取模平方。'
    elif formula_id == 'fourier-position':
        if target=='x1':result=v['lambda']*.001*v['f']/v['d']
        elif target=='d':result=divide(v['lambda']*.001*v['f'],v['x1'])
        elif target=='lambda':result=divide(v['x1']*v['d'],.001*v['f'])
        else:result=divide(v['x1']*v['d'],.001*v['lambda'])
        note='频率±1/d对应位置±x₁；m=0时该一级分量不存在。'
    elif formula_id == 'fourier-width':
        if target=='wF':result=v['lambda']*.001*v['f']/(math.pi*v['w'])
        elif target=='w':result=divide(v['lambda']*.001*v['f'],math.pi*v['wF'])
        elif target=='lambda':result=divide(v['wF']*math.pi*v['w'],.001*v['f'])
        else:result=divide(v['wF']*math.pi*v['w'],.001*v['lambda'])
        note='单个高斯频谱分量的1/e²光强半径，不是直径。'
    elif formula_id == 'fourier-intensity':
        from .scene_fourier_lens import fourier_at
        result=fourier_at(dict(wavelengthNm=v['lambda'],periodMm=v['d'],waistMm=v['w'],modulation=v['m'],focalLengthMm=v['f'],observationUm=v['xF']))['intensity']
        note='先对振幅作傅里叶变换，再取模平方；以当前中心光强归一化。'
    elif formula_id == 'circular-intensity':
        from .scene_circular_diffraction import circular_at
        result=circular_at(dict(wavelengthNm=v['lambda'],apertureDiameterMm=v['D'],focalLengthMm=v['f'],observationRadiusUm=v['r']))['intensity']
        note='圆孔焦平面归一化光强；中央极限为1，不代表总功率。'
    elif formula_id == 'circular-diameter':
        from .scene_circular_diffraction import AIRY_FACTOR
        c=2*AIRY_FACTOR*.001
        if target=='dA':result=c*v['lambda']*v['f']/v['D']
        elif target=='D':result=c*v['lambda']*v['f']/v['dA']
        elif target=='lambda':result=v['dA']*v['D']/(c*v['f'])
        else:result=v['dA']*v['D']/(c*v['lambda'])
        note='第一暗环以内的直径；计算采用首个零点系数1.21966989，显示公式约写为1.22。'
    elif formula_id == 'circular-angle':
        result=math.degrees(math.atan2(v['r']*.001,v['f']))
    elif formula_id == 'single-slit-intensity':
        from .scene_single_slit import slit_at
        result = slit_at(dict(wavelengthNm=v['lambda'],slitWidthMm=v['a'],screenDistanceM=v['L'],observationMm=v['y']))['intensity']
        note = '归一化远场光强；中央为1，不代表总功率。'
    elif formula_id == 'single-slit-width':
        if target=='w':
            from .scene_single_slit import slit_minimum
            result = 2*slit_minimum(dict(wavelengthNm=v['lambda'],slitWidthMm=v['a'],screenDistanceM=v['L']))
        elif target=='a': result = v['lambda']*1e-6*math.hypot(2*v['L']*1000,v['w'])/v['w']
        elif target=='lambda': result = v['a']*v['w']/math.hypot(2*v['L']*1000,v['w'])*1e6
        else:
            ratio=v['lambda']*1e-6/v['a']
            if ratio>=1: raise ValueError('当前缝宽下没有有限的第一暗纹。')
            result=v['w']*math.sqrt(1-ratio*ratio)/(2*ratio*1000)
        note = '两侧第一暗纹之间的距离；按正弦角关系计算，已统一单位。'
    elif formula_id == 'single-slit-angle':
        result = math.degrees(math.atan2(v['y'],v['L']*1000))
    elif formula_id == 'film-path':
        factor=2*v['n']*math.cos(v['theta']*RAD)
        result=v['t']*factor if target=='delta' else divide(v['delta'],factor)
        note='t和δ均用nm；不把界面反射的π相位反转计入传播光程差。'
    elif formula_id == 'film-reflection':
        from .scene_film_interference import thin_values
        result=thin_values(dict(filmIndex=v['n'],substrateIndex=v['ns'],incidentAngleDeg=v['theta0'],thicknessNm=v['t'],wavelengthNm=v['lambda']))['current']['reflectance']*100
        note='s偏振单层膜，包含多次反射；结果为实际反射率百分比。'
    elif formula_id == 'newton-thickness':
        if target=='t':result=v['t0']+v['r']**2/(v['R']+math.sqrt(v['R']**2-v['r']**2))*1e6
        else:
            sag=(v['t']-v['t0'])*1e-6
            if sag<0 or sag>v['R']:raise ValueError('此处膜厚须不小于中心间隙，且属于球面有效范围。')
            result=math.sqrt(2*v['R']*sag-sag*sag)
        note='完整球面间隙；膜厚nm，半径mm。'
    elif formula_id == 'newton-dark-radius':
        from .scene_film_interference import newton_values
        result=newton_values(dict(curvatureRadiusMm=v['R'],gapIndex=v['n'],centralGapNm=v['t0'],wavelengthNm=v['lambda'],observationRadiusMm=0))['firstDarkRadiusMm']
        if result is None:raise ValueError('中心间隙超过λ/(2n)，一阶暗环不存在。')
        note='一阶指传播光程差δ=λ；使用完整球面几何。'
    elif formula_id == 'michelson-path':
        result=2*(v['D']+v['s'])*v['f']/math.hypot(v['f'],v['r'])
        note='等倾干涉；角度由焦平面半径确定，输出 μm。'
    elif formula_id == 'michelson-intensity':
        result=math.cos(math.pi*math.fmod(v['delta']*1000/v['lambda'],1))**2
        result=0. if result<1e-12 else 1. if 1-result<1e-12 else result
        note='归一化时间平均光强；本输出端等臂时取亮。'
    elif formula_id == 'michelson-displacement':
        if target=='N':result=2*v['s']/(v['lambda']/1000)
        elif target=='s':result=v['N']*v['lambda']/2000
        else:
            result=divide(2000*v['s'],v['N'])
            if result<=0:raise ValueError('移镜量与条纹位移须同号，才能得到正波长。')
        note='轴上相对于s=0的连续条纹位移；不是自动计数结果。'
    elif formula_id == 'young-path-difference':
        from .scene_young_double_slit import young_at
        result = young_at(dict(wavelengthNm=600,slitDistanceMm=v['d'],screenDistanceM=v['L'],observationMm=v['y']))['deltaUm']
        note = '按完整几何距离计算 r₂−r₁，输出单位 μm。'
    elif formula_id == 'young-fringe-spacing':
        if target == 's': result=v['lambda']*.001*v['L']/v['d']
        elif target == 'lambda': result=divide(v['s']*v['d'],.001*v['L'])
        elif target == 'd': result=divide(v['lambda']*.001*v['L'],v['s'])
        else: result=divide(v['s']*v['d'],v['lambda']*.001)
        note = '近轴近似；已统一 nm、mm 与 m 的单位。'
    elif formula_id == 'young-intensity':
        result = math.cos(math.pi*math.fmod(v['delta']*1000/v['lambda'],1))**2
        result = 0. if result<1e-12 else 1. if 1-result<1e-12 else result
        note = '等强完全相干双缝的归一化时间平均光强；最亮为1。'
    elif formula_id in ('wave-field-sum', 'wave-resultant-amplitude', 'wave-average-intensity'):
        from .scene_wave_superposition import wave_values
        p = dict(amplitude1=v['A1'], amplitude2=v['A2'], phaseDeg=v.get('phi', 0), wavelengthNm=v.get('lambda', 600), observationUm=v.get('z', 0))
        if target == 'phi':
            a, b = v['A1'], v['A2']
            wanted = v['A']**2 if formula_id == 'wave-resultant-amplitude' else v['I']
            if a*b == 0: raise ValueError('有一束振幅为零，相位差不能由该目标唯一确定。')
            cosine = (wanted-a*a-b*b)/(2*a*b)
            if abs(cosine)>1+1e-12: raise ValueError('保持两束振幅不变时，这个目标超出可达到的范围。')
            angle = math.degrees(math.acos(max(-1, min(1, cosine))))
            return dict(values=sorted(set([angle, 360-angle])), note='返回0°至360°内的相位差；0°与360°物理等价。', infinite=False)
        result = wave_values(p)[{'E':'sum', 'A':'amplitude', 'I':'intensity'}[target]]
    elif formula_id=='camera-field':
        result=v['S']*v['u']/v['s'] if target=='W' else v['u']*v['S']/(v['W']+v['S'])
    elif formula_id=='camera-depth':
        if v['s']<=v['f']:raise ValueError('感光面距离必须大于焦距，才能有有限正对焦物距。')
        denominator=1/v['f']-1/v['s']+(1 if target=='un' else -1)*v['c0']/(v['a']*v['s'])
        if denominator<=1e-12:return dict(values=[],note='几何景深的远界延伸至无穷远。',infinite=True)
        result=1/denominator
    elif formula_id=='camera-diffraction':
        if target=='dA':result=2.44*v['lambda']*v['v']/v['a']
        elif target=='a':result=2.44*v['lambda']*v['v']/v['dA']
        elif target=='v':result=v['dA']*v['a']/(2.44*v['lambda'])
        else:result=v['dA']*v['a']/(2.44*v['v'])
    elif formula_id=='camera-sampling':
        result=500/v['p'] if target=='nu' else v['p']*v['u']/v['s']
    elif formula_id=='microscope-resolution':
        if target=='r':result=.61*v['lambda']/v['NA']
        elif target=='lambda':result=v['r']*v['NA']/.61
        else:result=.61*v['lambda']/v['r']
    elif formula_id=='microscope-depth':
        if target=='D':result=v['n']*v['lambda']/v['NA']**2+v['n']*v['e']/(v['M']*v['NA'])
        elif target=='NA':
            b=v['n']*v['e']/v['M']
            result=(b+math.sqrt(b*b+4*v['D']*v['n']*v['lambda']))/(2*v['D'])
        elif target=='n':result=v['D']/(v['lambda']/v['NA']**2+v['e']/(v['M']*v['NA']))
        elif target=='lambda':result=(v['D']-v['n']*v['e']/(v['M']*v['NA']))*v['NA']**2/v['n']
        elif target=='e':result=(v['D']-v['n']*v['lambda']/v['NA']**2)*v['M']*v['NA']/v['n']
        else:result=divide(v['n']*v['e'],v['NA']*(v['D']-v['n']*v['lambda']/v['NA']**2))
        if target=='e' and -1e-10<result<0:result=0
        if result<0 or target!='e' and result==0:raise ValueError('已知量没有满足该景深模型的物理解。')
        na=result if target=='NA' else v['NA']
        medium=result if target=='n' else v['n']
        if na>medium+1e-12:raise ValueError('数值孔径不能大于介质折射率。')
    elif formula_id=='pupil-imaging':
        factor=abs(v['f']/(v['up']-v['f'])) if target!='up' and abs(v['up']-v['f'])>1e-12 else None
        if target=='Dp':
            if factor is None:return dict(values=[],note='光阑处于焦平面，光瞳位于无穷远，不能赋予有限直径。',infinite=True)
            result=factor*v['Ds']
        elif target=='Ds':
            if factor is None:raise ValueError('无穷远光瞳不能由有限直径反求光阑。')
            result=v['Dp']/factor
        else:
            offset=v['f']*v['Ds']/v['Dp']
            answers=sorted(set(x for x in (v['f']-offset,v['f']+offset) if x>0))
            return dict(values=answers,note='返回满足该孔径像直径的所有正光阑距离；须结合光瞳的实虚与位置选择。',infinite=False)
    elif formula_id=='aperture-effective':
        factor=abs(1+v['z']/v['u']-v['z']/v['f'])
        if factor<1e-12:
            if target=='Dl':return dict(values=[],note='光阑处于该物体像面，轴上折算口径不构成有限限制。',infinite=True)
            raise ValueError('零系数不能由有限折算口径反求正光阑直径。')
        result=v['Ds']/factor if target=='Dl' else v['Dl']*factor
    elif formula_id=='lensmaker-thick':
        n=v['n']
        if target=='F':
            if v['t']>=2*v['R']:raise ValueError('对称球面几何要求中心厚度小于两倍曲率半径。')
            power=(n-1)*(2/v['R']-(n-1)*v['t']/(n*v['R']**2))
            result=divide(1,power)
        elif target=='t':result=n*v['R']**2/(n-1)*(2/v['R']-1/((n-1)*v['F']))
        else:
            disc=((n-1)*v['F'])**2-(n-1)**2*v['F']*v['t']/n
            if disc<0:raise ValueError('这组已知量没有实数曲率半径解。')
            roots=[(n-1)*v['F']-math.sqrt(disc),(n-1)*v['F']+math.sqrt(disc)]
            answers=sorted(set(x for x in roots if x>v['t']/2))
            if not answers:raise ValueError('没有满足对称球面几何的曲率半径。')
            return dict(values=answers,note='只保留中心厚度小于两倍曲率半径的正解。',infinite=False)
        if result<=0 or target=='t' and result>=2*v['R']:raise ValueError('这些已知量不能形成所述正厚球面透镜。')
    elif formula_id=='back-focal':
        factor=1-(v['n']-1)*v['t']/(v['n']*v['R'])
        if factor<=0:raise ValueError('当前主面位置不对应正后焦距。')
        result=v['F']*factor if target=='bfl' else v['bfl']/factor
    elif formula_id=='cauchy-index':
        if target=='n':result=v['A']+v['B']/(v['wavelength']/1000)**2
        elif target=='A':result=v['n']-v['B']/(v['wavelength']/1000)**2
        elif target=='B':
            result=(v['n']-v['A'])*(v['wavelength']/1000)**2
            if result<0:raise ValueError('此教学正常色散模型要求 B ≥ 0。')
        else:
            if v['B']<=0 or v['n']<=v['A']:raise ValueError('无法唯一反求正波长；需要 B > 0 且 n > A。')
            result=1000*math.sqrt(v['B']/(v['n']-v['A']))
    elif formula_id=='reflection-law': result=v['i' if target=='r' else 'r']
    elif formula_id=='snell-law':
        if target=='t': result=asin(v['n1']/v['n2']*math.sin(v['i']*RAD))
        elif target=='i': result=asin(v['n2']/v['n1']*math.sin(v['t']*RAD))
        elif target=='n1': result=divide(v['n2']*math.sin(v['t']*RAD),math.sin(v['i']*RAD))
        else: result=divide(v['n1']*math.sin(v['i']*RAD),math.sin(v['t']*RAD))
    elif formula_id=='critical-angle':
        if target=='c':
            if v['n1']<=v['n2']: raise ValueError('入射折射率须大于透射折射率，才存在全反射临界角。')
            result=asin(v['n2']/v['n1'])
        elif target=='n1': result=v['n2']/math.sin(v['c']*RAD)
        else: result=v['n1']*math.sin(v['c']*RAD)
    elif formula_id=='fresnel-power':
        if target=='R': result=100*fresnel(v['n1'],v['n2'],v['i'])['R']
        else:
            if v['n1']==v['n2']: raise ValueError('等折射率时所有角度的反射率均为零，无法唯一求角度。')
            base=100*fresnel(v['n1'],v['n2'],0)['R']
            high=math.asin(v['n2']/v['n1'])/RAD if v['n1']>v['n2'] else 89.999
            if v['R']<base-1e-10 or v['R']>100*fresnel(v['n1'],v['n2'],high)['R']+1e-8: raise ValueError('反射比例超出该界面的入射角求解范围。')
            if abs(v['R']-base)<1e-12:
                return dict(values=[0.],note='垂直入射附近反射率变化很小，反求角度对输入精度敏感。',infinite=False)
            lo,hi=0,high
            for _ in range(70):
                mid=(lo+hi)/2
                if 100*fresnel(v['n1'],v['n2'],mid)['R']<v['R']: lo=mid
                else: hi=mid
            result=(lo+hi)/2
            if v['R']==100 and v['n1']>v['n2']: note='返回临界角；超过该角度的所有入射角也都为全反射，解不唯一。'
    elif formula_id=='prism-deviation':
        if target=='delta': result=2*asin(v['n']/v['n0']*math.sin(v['A']*RAD/2))-v['A']
        else:
            angle=(v['A']+v['delta'])/2
            if not 0<angle<=90: raise ValueError('对称光路的入射角须在 0° 到 90° 之间。')
            ratio=math.sin(angle*RAD)/math.sin(v['A']*RAD/2)
            result=v['n0']*ratio if target=='n' else v['n']/ratio
    elif formula_id=='thin-lens':
        a,b=[v[k] for k in ('f','u','v') if k!=target]
        if a==0 or b==0: raise ValueError('有向焦距和距离不能为零。')
        den=1/a+1/b if target=='f' else 1/v['f']-1/(v['u'] if target=='v' else v['v'])
        if abs(den)<1e-14:
            if target=='v': return dict(values=[],note='像在无穷远，出射光平行。',infinite=True)
            raise ValueError('没有有限的焦距或实物物距解。')
        result=1/den
        if target=='u' and result<=0: raise ValueError('这些已知量不能形成实物 u > 0 的成像。')
    elif formula_id=='mirror-focal':
        result=v['R']/2 if target=='f' else 2*v['f']
        if result==0:raise ValueError('有限球面镜的曲率半径和焦距不能为零。')
    elif formula_id=='system-focal':
        if any(v.get(k)==0 for k in ('f1','f2','F') if k!=target):raise ValueError('有向焦距不能为零。')
        if target=='F':
            power=1/v['f1']+1/v['f2']-v['d']/(v['f1']*v['f2'])
            if abs(power)<1e-14:return dict(values=[],note='系统等效焦距趋于无穷大，为无焦系统。',infinite=True)
            result=1/power
        elif target=='d':
            result=v['f1']+v['f2']-v['f1']*v['f2']/v['F']
            if result<0:raise ValueError('这组焦距不对应非负透镜间距。')
        elif target=='f1':result=divide(v['F']*(v['f2']-v['d']),v['f2']-v['F'])
        else:result=divide(v['F']*(v['f1']-v['d']),v['f1']-v['F'])
        if target!='d' and result==0:raise ValueError('没有非零焦距解。')
    elif formula_id=='matrix-imaging':
        if target=='v':
            if v['D']==0:
                if v['B']==0:raise ValueError('B、D 均为零，不能确定像面，且不是有效无损光线矩阵。')
                return dict(values=[],note='像在无穷远；D = 0 且 B ≠ 0。',infinite=True)
            result=-v['B']/v['D']
        elif target=='B':result=-v['v']*v['D']
        else:result=divide(-v['B'],v['v'])
    elif formula_id=='microscope-camera-magnification':
        if target=='M':result=v['ft']/v['fo']*v['a']
        elif target=='fo':result=v['ft']*v['a']/v['M']
        elif target=='ft':result=v['M']*v['fo']/v['a']
        else:result=v['M']*v['fo']/v['ft']
    elif formula_id in ('microscope-camera-field','microscope-eye-field'):
        if target=='L':result=v['S']/v['M']
        elif target=='S':result=v['L']*v['M']
        else:result=v['S']/v['L']
    elif formula_id=='microscope-angular':
        if target=='M':result=v['mo']*v['near']/v['fe']
        elif target=='mo':result=v['M']*v['fe']/v['near']
        elif target=='near':result=divide(v['M']*v['fe'],v['mo'])
        else:result=divide(v['mo']*v['near'],v['M'])
        if target in ('near','fe') and result<=0:raise ValueError('常规目视配置要求参考距离与目镜焦距为正。')
    elif formula_id=='telescope-resolution':
        factor=1.22/1e6/RAD*3600
        if target=='r':result=factor*v['lambda']/v['D']
        elif target=='lambda':result=v['r']*v['D']/factor
        else:result=factor*v['lambda']/v['r']
    elif formula_id=='telescope-pupil-position':
        if target=='q':
            if v['fe']==0:raise ValueError('目镜有向焦距不能为零。')
            if abs(v['d']-v['fe'])<1e-12:return dict(values=[],note='物镜的孔径像位于无穷远。',infinite=True)
            result=v['fe']*v['d']/(v['d']-v['fe'])
        elif target=='fe':result=divide(v['q']*v['d'],v['q']+v['d'])
        else:result=divide(v['q']*v['fe'],v['q']-v['fe'])
        if target=='d' and result<=0 or target=='fe' and result==0:raise ValueError('需要正镜距和非零目镜焦距。')
    elif formula_id=='telescope-pupil-diameter':
        if target=='Dp':result=v['D']/v['M']
        elif target=='D':result=v['Dp']*v['M']
        else:result=v['D']/v['Dp']
    elif formula_id=='telescope-angular':
        if target=='M':result=divide(-v['fo'],v['fe'])
        elif target=='fo':result=-v['M']*v['fe']
        else:result=divide(-v['fo'],v['M'])
        if target=='fo' and result<=0 or target=='fe' and result==0:raise ValueError('该配置没有物镜正焦距或目镜非零焦距解。')
    elif formula_id=='camera-defocus':
        if target=='c':result=v['a']*abs(1-divide(v['s'],v['v']))
        elif target=='a':result=divide(v['c'],abs(1-divide(v['s'],v['v'])))
        elif target=='s':
            ratio=v['c']/v['a'];answers=[v['v']*(1-ratio),v['v']*(1+ratio)];answers=sorted(set(x for x in answers if x>0 and math.isfinite(x)))
            if not answers:raise ValueError('没有正感光面距离解。')
            return dict(values=answers,note='像面前后可形成同一直径的弥散圆；返回所有正感光面距离。',infinite=False)
        else:
            ratio=v['c']/v['a'];answers=[v['s']/(1+ratio)]
            if abs(1-ratio)>1e-14:answers.append(v['s']/(1-ratio))
            return dict(values=sorted(set(answers)),note='几何离焦允许两个有向像距；仍需检查物像关系是否满足实际镜头。',infinite=False)
        if target=='a' and result<=0:raise ValueError('需要正光圈直径；完美对焦时无法由零弥散圆唯一反求孔径。')
    elif formula_id=='magnification':
        if target=='m': result=-v['v']/v['u']
        elif target=='v': result=-v['m']*v['u']
        else: result=divide(-v['v'],v['m'])
        if target=='u' and result<=0: raise ValueError('这组参数没有正实物物距。')
    else: raise ValueError('公式尚未实现。')
    if not math.isfinite(result): raise ValueError('结果超出计算范围。')
    if formula_id in ('microscope-resolution','microscope-depth','telescope-resolution','telescope-pupil-position','telescope-pupil-diameter') and not fields[target]['min']<=result<=fields[target]['max']:
        raise ValueError('结果超出该公式支持的物理范围。')
    return dict(values=[result],note=note,infinite=False)


def validate_parameters(scene_id, parameters, partial=False):
    if scene_id not in DEFINITIONS:
        raise ValueError('场景尚未接入计算。')
    fields = {p['key']: p for p in DEFINITIONS[scene_id]['parameters']}
    if not isinstance(parameters, dict) or set(parameters) - set(fields) or (not partial and set(parameters) != set(fields)):
        raise ValueError('参数不属于当前场景或缺少必要参数。')
    for key, value in parameters.items():
        field = fields[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not field['min'] <= value <= field['max']:
            raise ValueError(f"{field['label']}应在{field['min']}至{field['max']} {field['unit']}之间。")
        if 'options' in field and value not in [option['value'] for option in field['options']]:
            raise ValueError('请选择有效的器件类型。')
    if scene_id=='instruments-0' and not partial and parameters['NA']>parameters['medium']:
        raise ValueError('数值孔径不能大于物镜前介质折射率。')
    if scene_id=='beam-transformation-1' and not partial and parameters['secondPositionMm']-parameters['firstPositionMm']<1:
        raise ValueError('第二镜需在第一镜右侧，至少相隔 1 mm。')
    return parameters.copy()


class SceneState(StrictModel):
    version: int = Field(default=1, ge=1, le=1)
    sceneId: str
    parameters: dict[str, float]

    @model_validator(mode='before')
    @classmethod
    def raw_parameters(cls, value):
        if isinstance(value, dict):
            validate_parameters(value.get('sceneId'), value.get('parameters'))
            value=normalize_microscope(value)
        return value


class SceneRequest(StrictModel):
    state: SceneState
    revision: str = Field(default='', max_length=2000)


def refraction(n1, n2, angle):
    s = n1 / n2 * math.sin(angle * RAD)
    if s > 1 + 1e-12:
        return None
    if abs(abs(s)-1)<1e-12:
        s=math.copysign(1,s)
    return math.asin(max(-1, min(1, s))) / RAD


def fresnel(n1, n2, angle):
    transmitted = refraction(n1, n2, angle)
    if transmitted is None:
        return {'angle': None, 'Rs': 1., 'Rp': 1., 'R': 1., 'T': 0., 'tir': True}
    ci, ct = math.cos(angle * RAD), math.cos(transmitted * RAD)
    if n1 == n2:
        rs = rp = 0.
    else:
        rs = ((n1 * ci - n2 * ct) / (n1 * ci + n2 * ct)) ** 2
        rp = ((n2 * ci - n1 * ct) / (n2 * ci + n1 * ct)) ** 2
    reflectance = (rs + rp) / 2
    return {'angle': transmitted, 'Rs': rs, 'Rp': rp, 'R': reflectance, 'T': 1 - reflectance, 'tir': False}


def calculate(state, revision=''):
    if isinstance(state, SceneState):
        state = state.model_dump()
    p = validate_parameters(state['sceneId'], state['parameters'])
    state=normalize_microscope(state)
    p=state['parameters']
    definition = DEFINITIONS[state['sceneId']]
    metrics, segments, curve, markers, regions = [], [], [], [], []
    warnings = []
    def metric(key, label, value, unit='', note=''):
        metrics.append(dict(key=key, label=label, value=value, unit=unit, note=note))
    def segment(start, end, role, dashed=False, power=1):
        segments.append(dict(start=start, end=end, role=role, dashed=dashed, power=power))
    def marker(x, y, label, role='annotation'):
        markers.append(dict(x=x, y=y, label=label, role=role))
    model = definition['model']
    if model == 'polarization-refraction':
        from .scene_polarization_refraction import calculate_polarization_refraction
        return calculate_polarization_refraction(state,definition,revision)
    if model == 'waveplate':
        from .scene_waveplate import calculate_waveplate
        return calculate_waveplate(state,definition,revision)
    if model == 'malus':
        from .scene_malus import calculate_malus
        return calculate_malus(state, definition, revision)
    if model == 'fiber-coupling':
        from .scene_fiber_coupling import calculate_coupling
        return calculate_coupling(state, definition, revision)
    if model == 'fiber-modes':
        from .scene_fiber_modes import calculate_fiber
        return calculate_fiber(state, definition, revision)
    if model == 'illumination-map':
        from .scene_illumination import calculate_illumination
        return calculate_illumination(state, definition, revision)
    if model == 'point-source':
        from .scene_point_source import calculate_point
        return calculate_point(state, definition, revision)
    if model == 'film-interference':
        from .scene_film_interference import calculate_film
        return calculate_film(state,definition,revision)
    if model == 'michelson':
        from .scene_michelson import calculate_michelson
        return calculate_michelson(state,definition,revision)
    if model == 'four-f':
        from .scene_four_f import calculate_four_f
        return calculate_four_f(state,definition,revision)
    if model == 'fourier-lens':
        from .scene_fourier_lens import calculate_fourier
        return calculate_fourier(state,definition,revision)
    if model == 'circular-diffraction':
        from .scene_circular_diffraction import calculate_circular
        return calculate_circular(state,definition,revision)
    if model == 'single-slit':
        from .scene_single_slit import calculate_slit
        return calculate_slit(state, definition, revision)
    if model == 'young-double-slit':
        from .scene_young_double_slit import calculate_young
        return calculate_young(state, definition, revision)
    if model == 'wave-superposition':
        from .scene_wave_superposition import calculate_wave
        return calculate_wave(state, definition, revision)
    if model == 'gaussian-focus':
        from .scene_gaussian_focus import calculate_focus
        return calculate_focus(state, definition, revision)
    if model == 'laser-gain':
        from .scene_laser_gain import calculate_laser_gain
        return calculate_laser_gain(state, definition, revision)
    if model == 'two-mirror-resonator':
        from .scene_resonator import calculate_resonator
        return calculate_resonator(state, definition, revision)
    if model == 'gaussian-expander':
        from .scene_gaussian_expander import calculate_expander
        return calculate_expander(state, definition, revision)
    if model == 'camera':
        from .scene_camera import calculate_camera
        return calculate_camera(state,definition,revision)
    if model in ('mirror','double-lens','microscope','telescope'):
        from .scene_geometrical import calculate_geometrical
        return calculate_geometrical(state,definition,revision)
    if model in ('aperture','aberration'):
        from .scene_aperture import calculate_aperture
        return calculate_aperture(state,definition,revision)
    if model == 'interface':
        n1, n2, i = p['n1'], p['n2'], p['angle']
        r = fresnel(n1, n2, i)
        critical = math.asin(n2 / n1) / RAD if n1 > n2 else None
        metric('reflectedAngle', '反射角', i, '°')
        metric('transmittedAngle', '折射角', r['angle'], '°', '无传播折射光' if r['tir'] else '')
        metric('criticalAngle', '临界角', critical, '°', 'n₁ ≤ n₂，无全反射临界角' if critical is None else '')
        metric('R', '反射功率比例 R', r['R'] * 100, '%')
        metric('T', '透射功率比例 T', r['T'] * 100, '%')
        segment([-math.sin(i * RAD), math.cos(i * RAD)], [0, 0], 'incident')
        segment([0, 0], [math.sin(i * RAD), math.cos(i * RAD)], 'reflected', power=r['R'])
        if r['angle'] is not None:
            t = r['angle'] * RAD
            segment([0, 0], [math.sin(t), -math.cos(t)], 'transmitted', power=r['T'])
        regions = [dict(points=[[-1.25, 0], [1.25, 0], [1.25, -1.15], [-1.25, -1.15]], label=f'n₂ = {n2:g}')]
        marker(-1.05, .92, f'n₁ = {n1:g}')
        marker(-1.05, -.92, f'n₂ = {n2:g}')
        marker(0, 1.04, '法线')
        marker(.58, .85, f'θᵢ = θᵣ = {i:.2f}°')
        marker(.62, -.65, '全反射' if r['tir'] else f'θₜ = {r["angle"]:.2f}°')
        bounds = [-1.25, 1.25, -1.15, 1.15]
        status = '全反射：透射功率为零' if r['tir'] else '临界角：折射光沿界面传播' if critical is not None and abs(i-critical)<1e-8 else '反射与折射同时存在' if r['R']>1e-12 else '无反射，光线继续传播'
        curve = [dict(x=a, y=fresnel(n1, n2, a)['R']*100) for a in [j*89.9/180 for j in range(181)]]
        chart = dict(xLabel='入射角 / °', yLabel='反射功率 / %', currentX=i, currentY=r['R']*100)
    elif model == 'prism':
        n, outside, A, i = p['n'], p['outside'], p['apex'], p['angle']
        r1 = refraction(outside, n, i)
        q = math.tan(A*RAD/2)
        entry = [-q*.5, .5]
        phi0 = (-A/2+i)*RAD
        segment([entry[0]-.8*math.cos(phi0), entry[1]-.8*math.sin(phi0)], entry, 'incident')
        regions = [dict(points=[[-q,0],[0,1],[q,0]],label='棱镜')]
        e = delta = r2 = None
        status = '第一面全反射，光未进入棱镜'
        if r1 is None:
            normal = [math.cos(-A*RAD/2),math.sin(-A*RAD/2)]
            dot = math.cos(phi0)*normal[0]+math.sin(phi0)*normal[1]
            direction = [math.cos(phi0)-2*dot*normal[0],math.sin(phi0)-2*dot*normal[1]]
            segment(entry,[entry[k]+.7*direction[k] for k in (0,1)],'reflected')
        else:
            r2 = A-r1
            phi = (-A/2+r1)*RAD
            dx,dy = math.cos(phi),math.sin(phi)
            length = (q*(1-entry[1])-entry[0])/(dx+q*dy)
            exit_point = [entry[0]+length*dx,entry[1]+length*dy]
            segment(entry,exit_point,'internal')
            if not 0 <= exit_point[1] <= 1:
                # A ray can hit the base instead of the nominated exit face.
                base_length = -entry[1]/dy if dy<0 else (1-entry[1])/dy
                segments[-1]['end']=[entry[0]+base_length*dx,entry[1]+base_length*dy]
                status = '主光线未到达第二斜面，此配置不适用两斜面偏折公式'
                warnings.append('主光线到达底面；本场景不追迹底面出射。')
            else:
                e = refraction(n,outside,r2)
                if e is None:
                    normal=[math.cos(A*RAD/2),math.sin(A*RAD/2)]
                    dot=dx*normal[0]+dy*normal[1]
                    reflected=[dx-2*dot*normal[0],dy-2*dot*normal[1]]
                    distances=[]
                    if reflected[1]<-1e-12: distances.append(-exit_point[1]/reflected[1])
                    den=reflected[0]-q*reflected[1]
                    if abs(den)>1e-12:
                        d=(-q*(1-exit_point[1])-exit_point[0])/den
                        if d>1e-9: distances.append(d)
                    length2=min(distances) if distances else .3
                    segment(exit_point,[exit_point[k]+length2*reflected[k] for k in (0,1)],'reflected')
                    status='第二面全反射，没有该面的出射主光线'
                else:
                    delta=i+e-A
                    outphi=(A/2-e)*RAD
                    segment(exit_point,[exit_point[0]+.8*math.cos(outphi),exit_point[1]+.8*math.sin(outphi)],'transmitted')
                    status='两次折射后的主光线'
                marker(exit_point[0]+.08,exit_point[1]+.15, '全反射' if e is None else f'e = {e:.2f}°')
        minimum_sine=n/outside*math.sin(A*RAD/2)
        minimum=2*math.asin(minimum_sine)/RAD-A if minimum_sine<=1 else None
        metric('r1','第一面折射角',r1,'°')
        metric('r2','第二面内部入射角',abs(r2) if r2 is not None else None,'°')
        metric('exitAngle','第二面出射角',abs(e) if e is not None else None,'°')
        metric('deviation','有向偏折角 δ',delta,'°')
        metric('minimumDeviation','对称光路偏折 δₛ',minimum,'°','n > n₀ 时为最小偏折；n < n₀ 时是负偏折的极值')
        marker(0,1.1,f'A = {A:.1f}°')
        marker(-.7,-.1,f'n = {n:g}，n₀ = {outside:g}')
        bounds=[-1.35,1.35,-.5,1.5]
        for j in range(181):
            a=j*89/180
            b=refraction(outside,n,a)
            c=refraction(n,outside,A-b) if b is not None else None
            if b is not None:
                phi_b=(-A/2+b)*RAD
                dx_b,dy_b=math.cos(phi_b),math.sin(phi_b)
                distance_b=(q*(1-entry[1])-entry[0])/(dx_b+q*dy_b)
                if not 0<=entry[1]+distance_b*dy_b<=1:
                    c=None
            curve.append(dict(x=a,y=a+c-A if c is not None else None))
        chart=dict(xLabel='第一面入射角 / °',yLabel='有向偏折角 / °',currentX=i,currentY=delta)
    elif model == 'lens':
        f,u,h=p['f']*p['kind'],p['u'],p['h']
        denominator=1/f-1/u
        v=1/denominator if abs(denominator)>1e-12 else None
        m=-v/u if v is not None else None
        image_h=m*h if m is not None else None
        metric('f','有向焦距',f,'mm')
        metric('v','像距 v',v,'mm','像在无穷远，出射光平行' if v is None else '负像距表示虚像' if v<0 else '正像距表示实像')
        metric('m','横向放大率 m',m)
        metric('imageHeight','像高 h′',image_h,'mm')
        extent=min(1600,max(u,abs(v or 0),abs(f)*2)*1.18)
        xmin=-max(u*1.2,abs(v)*1.15 if v is not None and v<0 else abs(f)*1.3)
        xmin=max(-1600,xmin)
        xmax=max(abs(f)*1.8,min(extent,(v or 0)*1.15))
        ymax=min(300,max(h*2.5,abs(image_h or 0)*1.25,25))
        bounds=[xmin,xmax,-ymax,ymax]
        if v is not None and abs(v)>1500:
            warnings.append('像接近无穷远，超出图中范围；读数仍为实际像距。')
        if h/u>.1 or h/abs(f)>.1:
            warnings.append('图中光线用于说明理想成像；物体高度相对距离较大时，真实透镜的近轴近似可能失效。')
        rays=[(h,-h/f),(0,-h/u)]
        for y0,slope in rays:
            segment([-u,h],[0,y0],'incident')
            segment([0,y0],[xmax,y0+slope*xmax],'transmitted')
            if v is not None and v<0: segment([0,y0],[v,image_h],'virtual',True)
        marker(-u,h,'物体','object')
        if v is not None and xmin<v<xmax and abs(image_h)<ymax: marker(v,image_h,'虚像' if v<0 else '实像','image')
        marker(f,0,'F′','focus'); marker(-f,0,'F','focus')
        marker(0,ymax*.88,'薄透镜')
        status='物在焦平面：出射光平行' if v is None else '倒立实像' if v>0 else '正立虚像'
        for j in range(241):
            distance=10+j*590/240
            den=1/f-1/distance
            curve.append(dict(x=distance,y=1/den if abs(den)>1e-9 and abs(1/den)<1500 else None))
        chart=dict(xLabel='物距 / mm',yLabel='像距 / mm',currentX=u,currentY=v)
    else:
        raise ValueError('该场景计算尚未实现。')
    return dict(revision=revision, input=state, modelVersion=VERSION, model=model, scope=definition['scope'], status=status,
                metrics=metrics,segments=segments,markers=markers,regions=regions,bounds=bounds,curve=curve,chart=chart,warnings=warnings)
