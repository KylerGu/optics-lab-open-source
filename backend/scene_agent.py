"""Scene capabilities using the existing model connection and verified physics."""
import json
import math
import re
from typing import Literal
import httpx
from pydantic import Field, model_validator
from .models import StrictModel
from .agent import ChatMessage, AgentError, completion, assistant_context
from .scene_physics import SceneState, DEFINITIONS, FORMULAS, calculate, validate_parameters, solve_formula
from .scene_microscope_focus import patch_scene_parameters
from .scene_agent_context import scene_context, context_state, calculation_context, model_tool_result


SCENE_ASSISTANT_INSTRUCTIONS='你是光学仿真助教，用清楚简短的中文回答本科生。保留 LaTeX 数学公式。不提模型供应商。概念问题直接解释，不为每句话调用计算。涉及当前数值必须用计算工具，回答的数值只能来自程序。参数比较不修改参数；仅用户明确要求调参时才能修改。网页会显示比较表，不再重复整表。'


class SceneChange(StrictModel):
    before: SceneState
    after: SceneState
    source: Literal['user','assistant','undo','redo','comparison','restore']


class SceneAgentRequest(StrictModel):
    requestId: str = Field(min_length=1,max_length=100)
    state: SceneState
    message: str = Field(min_length=1,max_length=2000)
    history: list[ChatMessage] = Field(default_factory=list,max_length=12)
    recentChange: SceneChange | None = None

    @model_validator(mode='after')
    def matching_change(self):
        change=self.recentChange
        if change and (change.before.sceneId!=self.state.sceneId or change.after.model_dump()!=self.state.model_dump()):
            raise ValueError('最近变化与提问时的场景不一致。')
        return self


def scene_change_context(change):
    """Recompute both snapshots; no client-supplied readings are trusted."""
    before=change.before.model_dump();after=change.after.model_dump()
    fields=DEFINITIONS[after['sceneId']]['parameters']
    source={'user':'手动调节','assistant':'AI调参','undo':'撤销','redo':'重做','comparison':'查看比较组','restore':'返回比较前状态'}[change.source]
    changes=[{'key':p['key'],'label':p['label'],'unit':p['unit'],'before':before['parameters'][p['key']],'after':after['parameters'][p['key']]} for p in fields if before['parameters'][p['key']]!=after['parameters'][p['key']]]
    return {'source':source,'parameters':changes,'before':model_tool_result(SceneWorkspace.summary(calculate(before))),'after':model_tool_result(SceneWorkspace.summary(calculate(after)))}


def editing_intent(message):
    """Conservative gate: explanation and comparison never grant mutation."""
    text=message.strip()
    if re.match(r'^(为什么|什么是|如何|怎样|怎么|解释|比较|计算|求|分析)',text):
        return False
    return bool(re.search(r'(^调节|^只调整.+(?:让|使|到)|调到|调成|改为|改成|改到|设为|设置|帮我调|帮我改|把.+调|把.+改|将.+调|将.+改|apply|set |change )',text,re.I))


def answer_conflicts(answer,evidence,scans):
    """Only explicit current readings are checked; hypothetical examples are untouched."""
    if evidence is None or scans:
        return []
    conflicts=[]
    for metric in evidence['metrics']:
        value=metric['value']
        if value is None or not metric['unit']: continue
        label=re.escape(metric['label'].split(' ')[0])
        unit=re.escape(metric['unit'])
        pattern=rf'(?:当前|此时|现在)[^。\n]{{0,10}}{label}(?:[^\d。\n]{{0,10}})(-?\d+(?:\.\d+)?)\s*{unit}'
        for match in re.finditer(pattern,answer):
            stated=float(match.group(1))
            if abs(stated-value)>max(.03,abs(value)*.005):
                conflicts.append(f"{metric['label']}实际为{value:.6g} {metric['unit']}")
    return conflicts


def tool(name, description, properties=None, required=None):
    return {'type':'function','function':{'name':name,'description':description,'parameters':{'type':'object','properties':properties or {},'required':required or [],'additionalProperties':False}}}


class SceneWorkspace:
    def __init__(self,state,allow_edit=True):
        self.state=state.model_dump() if isinstance(state,SceneState) else state.copy()
        self.state['parameters']=self.state['parameters'].copy()
        self.definition=DEFINITIONS[self.state['sceneId']]
        self.evidence=None
        self.scans=[]
        self.allow_edit=allow_edit
        numeric={'type':'number'}
        targets={'interface':['critical_angle'],'prism':['minimum_deviation'],'lens':['image_distance'],'mirror':['image_distance'],'double-lens':['image_distance'],'microscope':['image_distance','relaxed_eye','focus_sensor'],'telescope':['afocal'],'camera':['focus_sensor','image_distance'],'aperture':['entrance_pupil_position'],'aberration':['paraxial_screen','minimum_rms_screen']}.get(self.definition['model'],[])
        target_descriptions={
            'critical_angle':'临界角','minimum_deviation':'最小偏折',
            'image_distance':'指定像距(value，mm)反求物距','relaxed_eye':'显微镜最终像在无穷远',
            'afocal':'望远镜平行出射','focus_sensor':'相机感光面对焦',
            'entrance_pupil_position':'指定入瞳位置(value，从透镜量起，mm)，只移动后置外光阑',
            'paraxial_screen':'观察屏移至参考波长近轴焦点',
            'minimum_rms_screen':'只移屏，最小化当前颜色与圆形口径采样的几何均方根半径',
        }
        view_properties={}
        view_description=''
        if self.definition['model']=='microscope':
            view_properties={'study':{'type':'integer','enum':[0,1,2,3],'description':'计算/读取内容：0 成像光路（含倍率及对焦），1 分辨率，2 视场，3 景深。省略为当前页。'},'mode':{'type':'integer','enum':[0,1],'description':'0 目视，1 相机；省略为当前模式。只选择读取/计算模型，不修改页面或参数。'}}
            view_description=' 可选择其他页计算，不切换页面；分辨率结果不含倍率，核对倍率使用 study=0。'
        self.tools=[tool('read_scene','读取当前页背景；按公式目录 ID 获取所需公式，或按需读取预设。',{
                        **view_properties,'formula_ids':{'type':'array','items':{'type':'string','enum':self.definition['formulas']},'description':'省略时返回所选页的公式；指定时返回这些公式的完整物理说明。'},'include_presets':{'type':'boolean'}}),
                    tool('calculate_scene','按真实程序计算当前参数的物理量。'+view_description,view_properties),
                    tool('compare_parameter','比较一个参数；其余参数保持原值，不改变当前参数。'+view_description,{**view_properties,'field':{'type':'string'},'values':{'type':'array','items':numeric,'minItems':2,'maxItems':21}},['field','values']),
                    tool('set_parameters','用户要求修改时，修改本场景参数并立即真实计算。',{'parameters':{'type':'object','properties':{p['key']:numeric for p in self.definition['parameters']},'additionalProperties':False}},['parameters']),
                    tool('solve_target','求目标并可应用：'+'；'.join(f'{target} {target_descriptions[target]}' for target in targets),{'target':{'type':'string','enum':targets},'value':numeric,'apply':{'type':'boolean'}},['target','apply'])]
        if not targets:
            self.tools=[t for t in self.tools if t['function']['name']!='solve_target']
        if self.definition['model']=='gaussian-expander':
            self.tools.append(tool('solve_target','只移动第二镜，使其出射波前为平面；取较大出射束腰、较低发散角的解，仍有衍射发散。',{'target':{'type':'string','enum':['collimate']},'apply':{'type':'boolean'}},['target','apply']))
        if self.definition['model']=='two-mirror-resonator':
            self.tools.append(tool('solve_target','只调整镜间距，选取可调范围内严格稳定区间的内部值；保持两镜类型、曲率半径、波长和观察位置不变。',{'target':{'type':'string','enum':['stable_length']},'apply':{'type':'boolean'}},['target','apply']))
        if self.definition['model']=='laser-gain':
            self.tools.append(tool('solve_target','只调整小信号增益：threshold_gain 达到阈值；above_threshold 达到阈值的1.2倍。保留长度、损耗、反射率、试算光强。理想无损或超出范围时不能应用。',{'target':{'type':'string','enum':['threshold_gain','above_threshold']},'apply':{'type':'boolean'}},['target','apply']))
        if self.definition['model']=='illumination-map':
            self.tools.append(tool('solve_target','best_direction 只调x-z平面倾角，在允许范围内让观察点最亮；y不为0时不能完全对准。illuminance 给定目标照度(value，lx)，只调主轴光强，保持位置、方向和半强角。',{'target':{'type':'string','enum':['best_direction','illuminance']},'value':numeric,'apply':{'type':'boolean'}},['target','apply']))
        if self.definition['model']=='polarization-refraction':
            self.tools.append(tool('solve_target','当前模式内只调一个角度，不自动换模型或折射率。brewster只调界面入射角达到p光不反射；max_separation只调晶体光轴角让间距最大；no_walkoff只调光轴角至0让出射同轴。等折射率时不能产生分束或确定特定布儒斯特角。',{'target':{'type':'string','enum':['brewster','max_separation','no_walkoff']},'apply':{'type':'boolean'}},['target','apply']))
        if self.definition['model']=='waveplate':
            self.tools.append(tool('solve_target','只调整快轴，保留波片类型、入射功率和偏振方向。circular仅适用于四分之一波片；linear让偏振方向沿快轴；direction仅适用于半波片，value指定输出线偏振方向(°)。不自动换波片类型。',{'target':{'type':'string','enum':['circular','linear','direction']},'value':numeric,'apply':{'type':'boolean'}},['target','apply']))
        if self.definition['model']=='malus':
            self.tools.append(tool('solve_target','只调整偏振片透光轴，保留入射功率与偏振方向。maximum平行全透，minimum正交消光，half_power透过一半，power按value(mW)达到目标透射功率。',{'target':{'type':'string','enum':['maximum','minimum','half_power','power']},'value':numeric,'apply':{'type':'boolean'}},['target','apply']))
        if self.definition['model']=='fiber-coupling':
            self.tools.append(tool('solve_target','align仅调横向偏移和倾角为零；match_size仅调光斑半径等于模场半径；best_coupling调这三项达到理想高斯重叠100%。均保留波长、模场半径及入射功率；100%不包含实际端面反射。',{'target':{'type':'string','enum':['align','match_size','best_coupling']},'apply':{'type':'boolean'}},['target','apply']))
        if self.definition['model']=='fiber-modes':
            self.tools.append(tool('solve_target','accepted_ray 只调整入射角到接收半角的一半，满足几何全反射条件；不代表单模耦合效率。single_mode 只调整纤芯半径至V=2，保持波长与折射率；n₁≤n₂或超出范围时拒绝。模式形状与光线反弹次数无关。',{'target':{'type':'string','enum':['accepted_ray','single_mode']},'apply':{'type':'boolean'}},['target','apply']))
        if self.definition['model']=='point-source':
            self.tools.append(tool('solve_target','保持光强不变，只调整距离到目标照度 illuminance（value，lx）；目标为正且可达时才应用。光源关闭时不能靠距离获得正照度。',{'target':{'type':'string','enum':['illuminance']},'value':numeric,'apply':{'type':'boolean'}},['target','value','apply']))
        if self.definition['model']=='wave-superposition':
            self.tools.append(tool('solve_target','只调整相位差，保持波长、两束振幅与观察位置不变：constructive 同相增强；destructive 反相抵消（振幅不等时不完全相消）；relative_intensity 指定平均相对光强(value)。目标超出可达范围时拒绝应用。',{'target':{'type':'string','enum':['constructive','destructive','relative_intensity']},'value':numeric,'apply':{'type':'boolean'}},['target','apply']))
        if self.definition['model']=='film-interference':
            self.tools.append(tool('solve_target','当前模式内只改一个参数：薄膜模式仅改thicknessNm到反射最强bright或最弱dark（不一定为零）；牛顿环仅改observationRadiusMm到就近亮环bright或暗环dark。保留模式、波长、折射率及其余设置；无第二界面反射时拒绝膜厚调强弱。',{'target':{'type':'string','enum':['bright','dark']},'apply':{'type':'boolean'}},['target','apply']))
        if self.definition['model']=='michelson':
            self.tools.append(tool('solve_target','仅改变第二镜移镜量s，使当前观察半径的光强达到亮环bright或暗环dark；保留初始两臂长度差、波长、观察透镜焦距和半径。',{'target':{'type':'string','enum':['bright','dark']},'apply':{'type':'boolean'}},['target','apply']))
        if self.definition['model']=='four-f':
            self.tools.append(tool('solve_target','设置滤波目标：low_pass 居中低通；high_pass 居中高通；all_pass 全通；positive_order 只保留正一级。只改滤波方式、位置、宽度，保留输入、两镜焦距与观察点；无条纹拒绝一级目标。',{'target':{'type':'string','enum':['low_pass','high_pass','all_pass','positive_order']},'apply':{'type':'boolean'}},['target','apply']))
        if self.definition['model']=='fourier-lens':
            self.tools.append(tool('solve_target','只移动频谱屏观察点：central 零级中心；positive_order 正一级对应位置；negative_order 负一级对应位置。保留波长、条纹周期、光束半径、条纹对比和焦距；无条纹时不能定位一级。',{'target':{'type':'string','enum':['central','positive_order','negative_order']},'apply':{'type':'boolean'}},['target','apply']))
        if self.definition['model']=='circular-diffraction':
            self.tools.append(tool('solve_target','只移动焦平面观察点：central_bright 中心最亮；first_dark 第一暗环。保留波长、圆孔直径和透镜焦距。',{'target':{'type':'string','enum':['central_bright','first_dark']},'apply':{'type':'boolean'}},['target','apply']))
        if self.definition['model']=='single-slit':
            self.tools.append(tool('solve_target','仅移动观察点：central_bright 中央最亮；first_dark 上方第一暗纹。保留缝宽、波长、屏幕距离。',{'target':{'type':'string','enum':['central_bright','first_dark']},'apply':{'type':'boolean'}},['target','apply']))
        if self.definition['model']=='young-double-slit':
            self.tools.append(tool('solve_target','只移动观察点：central_bright 中央亮纹；first_bright 上方第一亮纹；first_dark 上方第一暗纹。用完整光程差求位置，保留波长、双缝间距、屏幕距离。',{'target':{'type':'string','enum':['central_bright','first_bright','first_dark']},'apply':{'type':'boolean'}},['target','apply']))
        if not allow_edit:
            self.tools=[t for t in self.tools if t['function']['name']!='set_parameters']

    @staticmethod
    def summary(result):
        return {**{key:result[key] for key in ['input','modelVersion','scope','status','metrics','warnings']},'calculation':calculation_context(result)}

    def reading_state(self,args):
        """A calculation view is a copy, never a parameter-edit operation."""
        view={key:args[key] for key in ('study','mode') if key in args}
        if view and self.definition['model']!='microscope':raise ValueError('本场景不支持选择其他计算页。')
        validate_parameters(self.state['sceneId'],view,partial=True)
        return patch_scene_parameters(self.state,view)

    def execute(self,name,args):
        if not isinstance(args,dict): raise ValueError('工具参数无效。')
        if name=='read_scene':
            state=self.reading_state(args)
            capabilities,knowledge=scene_context(self.definition,state,args.get('formula_ids'),args.get('include_presets',False))
            return {'state':context_state(state,[p['key'] for p in capabilities['parameters']]),'capabilities':capabilities,'formulas':knowledge}
        if name=='calculate_scene':
            state=self.reading_state(args)
            evidence=self.summary(calculate(state))
            if state==self.state:self.evidence=evidence
            return evidence
        if name=='set_parameters':
            if not self.allow_edit: raise ValueError('本轮仅解释或计算，不修改参数。')
            patch=validate_parameters(self.state['sceneId'],args.get('parameters'),partial=True)
            candidate=patch_scene_parameters(self.state,patch)
            result=calculate(candidate)
            self.state=candidate
            self.evidence=self.summary(result)
            return self.evidence
        if name=='compare_parameter':
            field,values=args.get('field'),args.get('values')
            if len(self.scans)>=2 or not isinstance(values,list) or not 2<=len(values)<=21: raise ValueError('每轮最多两组，每组2至21个取值。')
            state=self.reading_state(args)
            rows=[]
            for value in values:
                validate_parameters(self.state['sceneId'],{field:value},partial=True)
                candidate=patch_scene_parameters(state,{field:value})
                rows.append({'value':value,'result':self.summary(calculate(candidate))})
            scan={'field':field,'rows':rows,'input':state}
            if all('dependsOn' in row['result']['calculation'] and field not in row['result']['calculation']['dependsOn'] for row in rows):
                scan['calculationNote']='所比较参数未参与本次输出的计算。相同读数不能证明成像倍率或对焦状态如何变化；这些量需要成像光路计算。'
            self.scans.append(scan)
            return scan
        if name=='solve_target':
            target,p=args.get('target'),self.state['parameters']
            if self.definition['model']=='illumination-map':
                from .scene_illumination import illumination_target
                patch=illumination_target(p,target,args.get('value'))
            elif self.definition['model']=='polarization-refraction':
                from .scene_polarization_refraction import refraction_target
                patch=refraction_target(p,target)
            elif self.definition['model']=='waveplate':
                from .scene_waveplate import waveplate_target
                patch=waveplate_target(p,target,args.get('value'))
            elif self.definition['model']=='malus':
                from .scene_malus import malus_target
                patch=malus_target(p,target,args.get('value'))
            elif self.definition['model']=='fiber-coupling':
                from .scene_fiber_coupling import coupling_target
                patch=coupling_target(p,target)
            elif self.definition['model']=='fiber-modes':
                from .scene_fiber_modes import fiber_target
                patch=fiber_target(p,target,args.get('value'))
            elif self.definition['model']=='point-source':
                if target != 'illuminance': raise ValueError('未知的点光源目标。')
                from .scene_point_source import target_distance
                patch={'distanceM':target_distance(p,args.get('value'))}
            elif self.definition['model']=='four-f':
                from .scene_four_f import four_f_target
                patch=four_f_target(p,target)
            elif self.definition['model']=='fourier-lens':
                from .scene_fourier_lens import fourier_target
                patch={'observationUm':fourier_target(p,target)}
            elif self.definition['model']=='circular-diffraction':
                from .scene_circular_diffraction import circular_target
                patch={'observationRadiusUm':circular_target(p,target)}
            elif self.definition['model']=='single-slit':
                from .scene_single_slit import slit_target
                patch={'observationMm':slit_target(p,target)}
            elif self.definition['model']=='film-interference':
                from .scene_film_interference import film_target
                patch=film_target(p,target)
            elif self.definition['model']=='michelson':
                from .scene_michelson import michelson_target
                patch={'mirrorMoveUm':michelson_target(p,target)}
            elif self.definition['model']=='young-double-slit':
                from .scene_young_double_slit import young_target
                patch={'observationMm':young_target(p,target)}
            elif self.definition['model']=='wave-superposition':
                from .scene_wave_superposition import target_phase
                patch={'phaseDeg':target_phase(p,target,args.get('value'))}
            elif target=='collimate' and self.definition['model']=='gaussian-expander':
                from .scene_gaussian_expander import collimated_position
                patch={'secondPositionMm':collimated_position(p)}
            elif target=='stable_length' and self.definition['model']=='two-mirror-resonator':
                from .scene_resonator import stable_length
                patch={'lengthMm':stable_length(p)}
            elif target in ('threshold_gain','above_threshold') and self.definition['model']=='laser-gain':
                from .scene_laser_gain import target_gain
                patch={'smallSignalGain':target_gain(p, above=target=='above_threshold')}
            elif target=='critical_angle' and self.definition['model']=='interface':
                value=solve_formula('critical-angle','c',{'n1':p['n1'],'n2':p['n2']})['values'][0]
                patch={'angle':value}
            elif target=='minimum_deviation' and self.definition['model']=='prism':
                if p['n']<=p['outside']: raise ValueError('此折射率组合没有常规正最小偏折；可计算对称光路的有向偏折。')
                value=solve_formula('prism-deviation','delta',{'n':p['n'],'n0':p['outside'],'A':p['apex']})['values'][0]
                patch={'angle':(p['apex']+value)/2}
            elif target=='image_distance' and self.definition['model'] in ('lens','mirror','camera'):
                f=p['R']*p['kind']/2 if self.definition['model']=='mirror' else p['f']*p.get('kind',1)
                value=solve_formula('thin-lens','u',{'f':f,'v':args.get('value')})['values'][0]
                patch={'u':value}
            elif target=='image_distance' and self.definition['model'] in ('double-lens','microscope'):
                from .scene_geometrical import double_matrix
                v=args.get('value')
                if isinstance(v,bool) or not isinstance(v,(float,int)) or not math.isfinite(v):raise ValueError('请给出有限有向像距，单位 mm。')
                f2=p['tubeF'] if self.definition['model']=='microscope' and p.get('mode',0)==1 else p['f2']*p.get('k2',1)
                a,b,c,dd=double_matrix(p['f1']*p.get('k1',1),f2,p['d'])
                den=a+v*c
                if abs(den)<1e-12:raise ValueError('此目标像距没有有限物距解。')
                patch={'u':-(b+v*dd)/den}
            elif target=='relaxed_eye' and self.definition['model']=='microscope':
                if p.get('mode',0)==1:raise ValueError('相机模式请使用感光面对焦目标。')
                from .scene_geometrical import image_distance
                v1=image_distance(p['f1'],p['u'])
                if v1 is None or v1<=0:raise ValueError('物镜须先形成有限中间实像，才能调到常规放松眼配置。')
                patch={'d':v1+p['f2']}
            elif target=='afocal' and self.definition['model']=='telescope':
                patch={'d':p['f1']+p['f2']*p['k2']}
            elif target=='focus_sensor' and self.definition['model']=='microscope' and p.get('mode',0)==1:
                patch={'u':p['f1']}
            elif target=='focus_sensor' and self.definition['model']=='camera':
                from .scene_geometrical import image_distance
                v=image_distance(p['f'],p['u'])
                if v is None or v<=0:raise ValueError('当前物距不形成透镜后的有限实像，不能对焦到感光面。')
                patch={'sensor':v}
            elif target=='entrance_pupil_position' and self.definition['model']=='aperture':
                from .scene_aperture import aperture_geometry
                x=args.get('value')
                if isinstance(x,bool) or not isinstance(x,(int,float)) or not math.isfinite(x) or abs(p['f']+x)<1e-12:raise ValueError('请给出可形成有限入瞳的有向位置，单位 mm。')
                z=x*p['f']/(p['f']+x)
                if z<0:raise ValueError('本目标仅移动后置光阑；此入瞳位置没有后置光阑解。')
                candidate={**p,'z':z};validate_parameters(self.state['sceneId'],candidate)
                g=aperture_geometry(candidate)
                if g['active']!='stop' or g['entrance'][0] is None or abs(g['entrance'][0]-x)>1e-7:raise ValueError('在该位置外置孔径不再限制轴上光束，不能宣称其孔径像是实际入瞳；请比较口径后再调整。')
                patch={'z':z}
            elif target in ('paraxial_screen','minimum_rms_screen') and self.definition['model']=='aberration':
                from .scene_aperture import best_geometric_screen,lens_dimensions,cauchy_index,thick_lens
                r,_,t=lens_dimensions(p)
                patch={'screen':best_geometric_screen(p) if target=='minimum_rms_screen' else thick_lens(cauchy_index(p['A'],p['B'],p['wavelength']),r,t)[1]}
            else: raise ValueError('该目标不适用于当前场景。')
            validate_parameters(self.state['sceneId'],patch,partial=True)
            candidate=patch_scene_parameters(self.state,patch)
            evidence=self.summary(calculate(candidate))
            if args.get('apply'):
                if not self.allow_edit: raise ValueError('本轮未要求应用参数。')
                self.state=candidate; self.evidence=evidence
            return {'candidate':candidate,'evidence':evidence,'applied':bool(args.get('apply'))}
        raise ValueError('未知场景能力。')


def run_scene_agent(request,settings,client=None):
    if not settings.configured: raise AgentError('请先配置AI模型接口。',503)
    if not request.message.strip(): raise AgentError('请输入问题。',422)
    # The model understands intent first. Concept-only turns receive no edit tools.
    allow_edit=editing_intent(request.message)
    if request.state.sceneId in ('gaussian-focus','beam-transformation-1','resonators-0','laser-gain-0'):
        from .gaussian_commands import gaussian_action
        if gaussian_action(request.message) is False: allow_edit=False
    workspace=SceneWorkspace(request.state,allow_edit=allow_edit)
    history=[m.model_dump() for m in request.history]
    base=SCENE_ASSISTANT_INSTRUCTIONS
    if workspace.definition['model']=='illumination-map':
        if allow_edit:
            base+=' 本轮用户已明确要求修改，目标求解成功时以apply=true应用，无需再询问确认；网页提供撤销。'
        base+=' 本场景通常用两句中文回答。简化射灯为定向点光源，主轴仅在x-z平面转动，θ=0向下，正值朝+x。I₀是主轴光强cd，E是照度lx，不从cd擅自换算W。β为光强降至主轴一半的角度，不是完整束角或截止角；配光为前半空间cos^n，后半空间为零。E含距离平方反比和接收面入射余弦；亮区峰值一般不等于主轴交点。固定接收区域8m×8m，最大照度和最小照度为有限网格采样值，不宣称连续极值或真实实测；均匀度为网格最小照度/区域平均照度，光源关闭时不定义。改变半强角保持主轴光强，不保持总光通量。曲线穿过当前观察点的水平线y=observationYM，不是整个接收面的分布。只调整方向用solve_target best_direction；y非零时不能完全对准观察点。目标照度用solve_target illuminance仅改主轴光强。不要虚构实际器材或提供复制到光路搭建。'
    if workspace.definition['model']=='point-source':
        base+=' 当前场景通常用两句简短中文回答。I 是沿接收方向的发光强度（cd），r 是距离（m），E 是接收面中心照度（lx），E=I/r²；不是功率 W、辐射强度 W/sr 或辐照度 W/m²，不从 cd 擅自换算 W。只计算中心垂直接收，不代表整个接收面均匀照明。图中光线与颜色仅作示意。反求目标照度使用 solve_target，只调整距离，保持光强不变。零光强无法靠距离产生正照度。不要断言真实有限光源一定偏高或偏低，未给光源尺寸和分布时只能说明点光源近似可能不适用。不提供复制到光路搭建，不虚构照度计等器材。'
    if workspace.definition['model']=='two-mirror-resonator':
        base+=' 当前场景默认简短作答，最多三个短段；调参先报告改动和稳定结论，只列必要读数。对称腔 L=R 是共焦，L=2R 是共心，名称不可混用。'
    if workspace.definition['model']=='laser-gain':
        base+=' 当前场景默认最多三个短段；先报告阈值结论及必要读数。输出仅是相对饱和光强，不是瓦数。阈值以上钳位的是饱和增益，不是小信号增益；试算光强不等于自动稳态光强。'
    if workspace.definition['model']=='wave-superposition':
        base+=' 当前场景最多三个短段。两束光同向同频同偏振，相位差在空间上固定，所以平均光强不随位置变化；不要声称存在双缝条纹。电场和光强均为相对单位，Irel=A²，不是瞬时E²。图中展示固定时刻电场，观察点的彩色点与就近数值标注表示带正负号的电场相加；振幅不等时反相只能部分抵消。合成振幅为零时初相位不定义。'
    if workspace.definition['model']=='four-f':
        base+=' 默认用两句简短中文解释。两片等焦距f透镜，输入到第一镜f，镜间2f，第二镜到输出f，滤波片固定在公共焦面，输出是等大小倒像。本例输入为高斯包络乘余弦振幅条纹，w是半径，滤波宽度a是全宽，位置c从中心量起，以μm计。filterMode=0为通光狭缝，1为遮光挡片，2为全通；输入面/输出面x以mm计。频谱复振幅乘H后，再经第二次傅里叶变换取模平方；不是把频谱图片裁剪后当输出。居中狭缝为横向低通，居中挡片为横向高通；移动狭缝可选一级。滤波宽度a对应半带宽a/(2λf)，偏心时不称居中截止频率。I/Iin(0)以输入中心为共同基准，滤波前后不可各自归一化，透过率是完整平面总功率比，不是单点光强。通过solve_target调低通、高通、全通或正一级，仅改滤波三项；无条纹不能选一级。默认省略长公式和模型条件，不把高通称为增益。忽略有限口径、像差、离焦；所有滤波方式均可复制当前光源、余弦振幅光栅、两镜、滤波片与输出屏到搭建页；搭建页在等焦距、共轴、f/2f/f间距、束腰在输入面及足够口径时提供相同4f波动输出，其他布局只计算几何光线。'
    if workspace.definition['model']=='fourier-lens':
        base+=' 默认简短回答，概念和调参通常两句话；比较只讲趋势，不复述页面表格。输入是高斯包络乘以余弦振幅条纹，振幅不是光强。输入面和频谱面在透镜前后焦面，透镜对复振幅作傅里叶变换，再取模平方得到频谱光强。条纹周期d越小，空间频率ν₀=1/d越大，一级位置x₁=λf/d越远；增大f或λ按比例放大频谱位置和宽度。输入高斯半径w越大，频谱单分量半径wF=λf/(πw)越小；都为1/e²光强半径，非直径。m是振幅调制度，m=0时无条纹，只剩高斯零级，周期不再影响结果。I/I₀以当前中心归一化，不是总功率。定位正负一级应使用solve_target，仅改observationUm；无条纹时不能制造一级。前后距离随f联动，忽略有限透镜截断、像差、偏振、离焦，无4f滤波。条纹和无条纹均可完整复制当前光源、输入振幅光栅、透镜与屏到搭建页；共轴且输入/输出均位于焦面，束腰在输入面且口径足够时显示相同频谱；偏离这些条件时只显示几何光路。'
    if workspace.definition['model']=='circular-diffraction':
        base+=' 默认简短回答：概念与调参通常两句话，比较只讲趋势，页面已显示表格，不复述整表。单色均匀平行光照亮圆孔，经理想观察透镜在焦平面形成艾里图样。近轴标量衍射：u=πDr/(λf)，I/I₀=[2J₁(u)/u]²，中心极限为1；D是圆孔直径，r是焦平面观察半径，以μm计。r₁=(3.8317059702/π)λf/D，dₐ=2r₁，定义为第一暗环内直径，不是半高宽。孔越小，亮斑越大；增大f使亮斑变大，但角半径不变。观察角θ=atan(r/f)，第一暗环角半径近似1.22λ/D。调到第一暗环用solve_target并仅改半径；不做两点分辨仿真。复制后的搭建页只显示器件和几何光线，不计算艾里圆环。'
    if workspace.definition['model']=='single-slit':
        base+=' 默认简短作答：概念和调参通常各两句话；调参只报改动及必要读数，参数比较只讲趋势，网页已显示比较表，不复述整表。不主动堆叠模型条件或推导，用户要求时再展开。单色均匀平行光正入射长狭缝，采用一维远场衍射；所有参数满足a²/(λL)≤0.1。a是单缝宽度，不是双缝间距。β=πa sinθ/λ，sinθ=y/√(L²+y²)，I/I₀=(sinβ/β)²；中央为1，不代表总功率。第一暗纹a sinθ=λ，宽度w=2y₁，2λL/a只是近轴近似。缝越窄亮纹越宽；旁侧亮纹峰值小于中央。只移动观察点到第一暗纹必须用solve_target。复制后的光路搭建也支持同条件单缝剖面，几何采样功率与衍射相对光强分开。'
    if workspace.definition['model']=='young-double-slit':
        base+=' 当前场景最多三个短段。两束单色光等强、同相、同偏振并完全相干；δ=r₂−r₁按完整几何距离计算，正y在上方。整数δ/λ为亮纹，半整数为暗纹。I/Imax为归一化时间平均光强，最亮为1。λL/d是近轴近似条纹间距，不能说它处处严格相等。理想窄缝模型不含单缝衍射包络或部分相干。装置示意局部放大，只有屏上位置按毫米标尺。调到第一亮纹或暗纹用solve_target，避免近似取整导致偏离。'
    if workspace.definition['model']=='film-interference':
        base+=' 默认简短回答。当前mode=0为薄膜反射，mode=1为牛顿环，不擅自换模式。薄膜入射介质为空气，s偏振，膜内折射角按Snell求得，传播光程差2nt cosθ₂；上下界面反射系数符号决定π相位反转，多次反射按Airy式计算实际反射率。最弱不一定完全消光，基底与膜折射率相等时无膜厚条纹。牛顿环为1.52玻璃间的低折射率薄膜，局部正入射，单次相位反转，完整球面间隙t=t₀+r²/(R+sqrt(R²-r²))，mm转nm乘10^6；观察点相对强度按本模式峰值归一化，接触中心暗，抬起后中心未必暗。一阶暗环严格指δ=λ，t₀>λ/(2n)时不存在。调到亮暗用solve_target并只改相应膜厚或观察半径。没有复制到光路搭建功能，因为缺少薄膜/接触装置。'
    if workspace.definition['model']=='michelson':
        base+=' 默认简短回答；调参通常两句话，说明改动和结果，不重复模型条件。单色扩展光源、等效平行镜、玻璃光程已补偿；选择等臂时本输出端为亮的相位参考。圆环为等倾干涉，δ=2(ΔL₀+s₂−s₁)cosθ，tanθ=r/f；不能用2ΔL/cosθ。图中装置为轴上光路，圆环在理想透镜焦平面。s₂是第二镜mirrorMoveUm，s₁是第一镜mirror1MoveUm。轴上条纹位移N=2(s₂−s₁)/λ是相对于两镜微调均为零的连续位移，不是已计数的条纹整数。离轴变化需乘cosθ。调亮或暗只改mirrorMoveUm并使用solve_target；不可偷改半径或波长。'
    if workspace.definition['model']=='polarization-refraction':
        base+=' 默认两句简短中文，先解释当前模式。mode=0是各向同性无吸收单界面，theta从法线量起，s电场垂直图面、p在图面内；布儒斯特角处只有p不反射，未偏振或s仍能反射。Rs/Rp是功率比例而非振幅，未偏振R=(Rs+Rp)/2，T=1-R；等折射率无特定布儒斯特角，全反射和临界掠射没有法向传播透射功率。mode=1是未偏振平行光正入射单轴晶体平行平板，光轴在图面内，gamma从向右法线逆时针量起；no/ne是主折射率，e有效折射率随角度改变。o光直行，e光能量流在晶体中走离，出射后两束平行，偏振正交；正rho向上，负向下；d=L|tanrho|。不把e能量流当作波矢，不把所有主轴方向都说成空间分束，gamma0或90空间间距为0；ne=no没有双折射。忽略晶体表面反射、色散、相干干涉和功率，不声称分束效率。只调角度目标用solve_target，保留其他参数和模式，不偷换折射率。两个模型独立，不能套用各向同性Brewster公式到晶体。当前搭建器材不支持对应物理效果，不提供复制。'
    if workspace.definition['model']=='waveplate':
        base+=' 默认两句简短中文。线偏振光正入射理想无损波片，532nm为固定设计波长；四分之一波片δ=90°，半波片δ=180°。β是快轴角，α是输入偏振角，均从水平参考轴逆时针量起。半波片输出仍为线偏振，ψ=(2β−α)模180°；四分之一波片相对输入45°时圆偏振，沿快慢轴时线偏振，其他通常椭圆。中间三维图显示波片与空间电场，拖端点改角度、拖空白转视角；右侧正视图显示输出电场端点轨迹，两处同步。空间长度为示意，电场归一化，动画慢放，曲线不是光路；功率改变不改变形状。S3=2Im(Ex Ey共轭)，时间exp(−iωt)，不用左右旋命名；右侧正视图沿传播方向观察S3>0顺时针。短长轴比0为直线，1为圆；圆偏振无唯一长轴角。零功率时没有偏振读数。目标用solve_target只调快轴，禁止偷换器件或源功率。可复制源、当前波片与功率计到搭建；探测器在同一U/V基底下的S1/S2/S3及功率一致。'
    if workspace.definition['model']=='malus':
        base+=' 默认简短回答，不重复模型条件。固定光斑面积的线偏振光正入射单片理想偏振片，Pout=Pin cos²θ，θ为偏振方向与透光轴的较小夹角0–90°，不是入射角。α与β从同一水平参考轴逆时针量起，轴方向相差180°等效。功率比例是电场投影幅度的平方；未偏振光不使用本场景。图中正视偏振片，轴线不是光路传播方向。入射功率为零时输出为零，透过比例仍描述轴夹角，不以0/0计算。目标调参用solve_target，仅改透光轴，保留输入偏振方向和功率。可完整复制线偏振平行光源、偏振片和功率计到搭建页，保留三项参数；器件不截光时功率一致。'
    if workspace.definition['model']=='fiber-coupling':
        base+=' 默认简短回答，不重复模型条件。单模光纤已作为假设，模场半径是当前波长下光强1/e²半径，不是纤芯半径。端面高斯光场重叠、同偏振、曲率匹配；位置偏移和倾角均是一维，角度在空气中量起。不含端面反射、离焦、色散或传播损耗；理想100%不是实际测量效率。功率改变只影响耦合功率，不改变效率。尺寸、位置、角度的三个因子相乘为总效率，不能相加。只对准用align，只匹配大小用match_size，允许调整三项优化才用best_coupling；均保留模场半径、波长和功率。'
    if workspace.definition['model']=='fiber-modes':
        base+=' 默认简短回答。数值孔径和接收角是理想过轴几何光线条件，不代表实际单模耦合效率。模式为横向光场形状，与反弹次数无关。V判据用弱导近似，截止采用2.404825557695773；边界单列，基模不在此消失。折射率固定，不计算模场、精确模式数、材料色散或弯曲损耗。单模判断与当前入射角的导光判断独立。目标调参用solve_target；n₁≤n₂时相关读数不适用，不以零值冒充。'
    capabilities,knowledge=scene_context(workspace.definition,workspace.state)
    context=context_state(workspace.state,[p['key'] for p in capabilities['parameters']])
    messages=[{'role':'system','content':base+'\n当前场景能力：'+json.dumps(capabilities,ensure_ascii=False)+'\n当前页公式依据：'+json.dumps(knowledge,ensure_ascii=False)+'\n当前参数：'+json.dumps(context,ensure_ascii=False)},*history,{'role':'user','content':request.message}]
    if request.recentChange:
        messages[0]['content']+='\n最近一次操作及程序核对的前后结果：'+json.dumps(scene_change_context(request.recentChange),ensure_ascii=False,allow_nan=False)
    trace=[]
    owned=client is None
    client=client or httpx.Client(follow_redirects=False)
    try:
        for _ in range(8):
            message=completion(client,settings,messages,settings.provider_timeout,workspace.tools)
            calls=message.get('tool_calls') or []
            if not isinstance(calls,list) or len(calls)+len(trace)>16: raise AgentError('本轮操作过多，场景未修改。')
            if not calls:
                answer=message.get('content')
                if not isinstance(answer,str) or not answer.strip() or len(answer)>12000: raise AgentError('回答未完整返回，场景未修改。')
                if workspace.definition['model']=='film-interference' and workspace.state!=request.state.model_dump() and not workspace.scans:
                    from .scene_film_interference import film_change_answer
                    answer=film_change_answer(request.state.model_dump(),workspace.state,workspace.definition)
                conflicts=answer_conflicts(answer,workspace.evidence,workspace.scans)
                if conflicts:
                    correction=messages+[assistant_context(message,settings.thinking_enabled),{'role':'system','content':'以下明确读数与已计算结果冲突：'+json.dumps(conflicts,ensure_ascii=False)+'。仅用已有计算依据改正这些冲突，不新增计算或修改。依据：'+json.dumps(workspace.evidence,ensure_ascii=False,allow_nan=False)}]
                    revised=completion(client,settings,correction,settings.provider_timeout,[])
                    content=revised.get('content')
                    if isinstance(content,str) and content.strip() and not revised.get('tool_calls') and not answer_conflicts(content,workspace.evidence,workspace.scans): answer=content
                    else: answer='当前计算结果：'+ '；'.join(f"{m['label']}：{m['value']:.6g} {m['unit']}" if m['value'] is not None else f"{m['label']}：无有限读数" for m in workspace.evidence['metrics'])+'。'+workspace.evidence['scope']
                return {'requestId':request.requestId,'inputSnapshot':request.state.model_dump(),'state':workspace.state,'changed':workspace.state!=request.state.model_dump(),'answer':answer.strip(),'evidence':workspace.evidence,'scans':workspace.scans,'trace':trace}
            messages.append(assistant_context(message,settings.thinking_enabled))
            for call in calls:
                try:
                    name=call['function']['name']; raw=call['function']['arguments']; call_id=call['id']
                    if not isinstance(raw,str) or len(raw)>20000: raise ValueError()
                    args=json.loads(raw)
                    result=workspace.execute(name,args)
                    trace.append({'name':name,'status':'ok'})
                    output={'ok':True,'data':model_tool_result(result)}
                except (ValueError,KeyError,TypeError,OverflowError,ZeroDivisionError) as error:
                    trace.append({'name':call.get('function',{}).get('name','invalid'),'status':'error'})
                    output={'ok':False,'error':str(error) or '工具参数无效。'}
                    call_id=call.get('id','invalid')
                messages.append({'role':'tool','tool_call_id':call_id,'content':json.dumps(output,ensure_ascii=False,allow_nan=False)})
        raise AgentError('本轮未完成，场景未修改。')
    finally:
        if owned: client.close()
