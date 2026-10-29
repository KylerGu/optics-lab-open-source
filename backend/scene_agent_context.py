"""On-demand context for the simulation-scene assistant only."""
from .scene_physics import FORMULAS
from .scene_microscope_focus import focus_distance


MICROSCOPE_PAGES={0:'成像光路',1:'分辨率',2:'视场',3:'景深'}


def microscope_context(parameters):
    study=parameters.get('study',0)
    camera=parameters.get('mode',0)==1
    keys={'study','mode'}
    if study==1:
        return keys|{'NA','wavelength','medium','separation'},['microscope-resolution'],'瑞利判据；等强、非相干点源，理想圆孔径。'
    if study==3:
        keys|={'NA','wavelength','medium','u','defocus','depthCriterion'}
        if camera and parameters.get('depthCriterion',0)==1:
            keys|={'pixel','f1','tubeF','adapter'}
        return keys,['microscope-depth'],'物方全景深估计；非相干成像，使用当前所选清晰度判据。'
    if camera:
        keys|={'f1','u','h','d','tubeF','adapter','sensorW','sensorH','displayWidth'}
        formulas=['microscope-camera-magnification','microscope-camera-field']
        scope='无穷远物镜、管镜与理想转接镜；物体位于物镜前焦面时合焦，倍率和视场按合焦配置定义。'
    else:
        keys|={'f1','f2','d','u','h','near','fieldNumber'}
        formulas=['thin-lens','microscope-angular','microscope-eye-field']
        scope='同轴理想薄透镜、近轴目视显微镜，眼在目镜附近；视场数是中间像面上的可见直径。'
    return keys,formulas,scope


def context_state(state,parameter_keys):
    return {**state,'parameters':{key:value for key,value in state['parameters'].items() if key in parameter_keys}}


def scene_context(definition,state=None,formula_ids=None,include_presets=False):
    """Catalog entries remain discoverable; detailed physics is loaded by page or ID."""
    parameter_keys=('key','label','unit','min','max','options')
    capabilities={key:definition[key] for key in ('title','model','scope')}
    fields=definition['parameters']
    selected=definition['formulas']
    if state is not None and definition['model']=='microscope':
        keys,selected,capabilities['scope']=microscope_context(state['parameters'])
        fields=[p for p in fields if p['key'] in keys]
        capabilities['page']=MICROSCOPE_PAGES[state['parameters'].get('study',0)]
        capabilities['availablePages']=MICROSCOPE_PAGES
    if formula_ids is not None:
        if not isinstance(formula_ids,list) or any(not isinstance(f,str) or f not in definition['formulas'] for f in formula_ids):
            raise ValueError('请选择本场景公式目录中的公式。')
        selected=formula_ids
    capabilities['parameters']=[{key:p[key] for key in parameter_keys if key in p} for p in fields]
    capabilities['formulaCatalog']=[{'id':f['id'],'title':f['title']} for f in FORMULAS if f['id'] in definition['formulas']]
    if include_presets: capabilities['presets']=definition.get('presets',[])
    knowledge=[]
    for formula in FORMULAS:
        if formula['id'] not in selected: continue
        item={key:formula[key] for key in ('id','title','latex','meaning','conditions') if key in formula}
        item['fields']=[{key:field[key] for key in ('key','label','unit') if key in field} for field in formula.get('fields',[])]
        if definition['model']=='microscope' and formula['id']=='microscope-angular':
            item['notation']='m_o、M 是有符号放大率，负号表示倒像；物镜放大倍数为 |m_o|，目视放大倍数为 |M|。'
            item['magnitudeLatex']=r'|M|=|m_o|\frac{D}{f_e}\quad(\text{final image at infinity})'
        # The default depth page uses only the diffraction term. Full formula
        # remains available through an explicit formula request or sampling mode.
        if formula['id']=='microscope-depth' and state is not None and formula_ids is None and (state['parameters'].get('mode',0)==0 or state['parameters'].get('depthCriterion',0)==0):
            item.update(latex=r'D=\frac{n\lambda}{\mathrm{NA}^2}',meaning='D 为物方全景深，上下范围各为 D/2；当前仅衍射判据。边界是清晰度估计，不是突然模糊的界线。',conditions='非相干成像的衍射景深估计，λ 和 D 使用 µm；不包含眼睛调焦、像差和照明条件。')
            item['fields']=[f for f in item['fields'] if f['key'] not in ('e','M')]
        knowledge.append(item)
    return capabilities,knowledge


def calculation_context(result):
    """Report what was actually evaluated, independently of what was asked."""
    context={'evaluatedQuantities':[m['label'] for m in result['metrics']]}
    if result['input']['sceneId']=='instruments-0':
        p=result['input']['parameters']
        study=p.get('study',0)
        context['page']=MICROSCOPE_PAGES[study]
        if study in (0,2) and p.get('mode',0)==0:
            # Magnitudes are derived from the actual signed results, including
            # finite-image configurations; undefined results stay undefined.
            symbols={'objectiveM':('m_o','物镜横向放大率','物镜放大倍数'),
                     'angularM':('M','目视角放大率','目视放大倍数')}
            context['magnifications']=[{
                'metricKey':m['key'],
                'signed':{'symbol':symbols[m['key']][0],'label':'有符号'+symbols[m['key']][1],'value':m['value']},
                'magnitude':{'symbol':'|'+symbols[m['key']][0]+'|','label':symbols[m['key']][2],'value':abs(m['value']) if m['value'] is not None else None},
            } for m in result['metrics'] if m['key'] in symbols]
        if study==1:
            context.update(dependsOn=['NA','wavelength','separation'],notEvaluated=['成像倍率','对焦状态','视场','景深'])
        elif study==3:
            context['dependsOn']=['NA','wavelength','medium','depthCriterion']
            sampling=p.get('mode',0)==1 and p.get('depthCriterion',0)==1
            if sampling:context['dependsOn']+=['pixel','f1','tubeF','adapter']
            context['dependsOn']+=['mode','u','defocus','f1']+(['d','f2'] if p.get('mode',0)==0 else [])
            context['criterion']='衍射＋相机采样' if sampling else '仅衍射'
            context['focusReference']={'objectDistanceMm':focus_distance(p),'reference':'对焦到感光面' if p.get('mode',0)==1 else '放松眼观察','relation':'z = (u - u0) × 1000 µm；正值表示物距增大'}
    return context


def model_tool_result(value):
    """Hide unrelated input settings from the model, retaining full UI evidence."""
    if isinstance(value,list):return [model_tool_result(v) for v in value]
    if not isinstance(value,dict):return value
    if value.get('sceneId')=='instruments-0' and isinstance(value.get('parameters'),dict):
        keys,_,_=microscope_context(value['parameters'])
        return context_state(value,keys)
    output={key:model_tool_result(item) for key,item in value.items()}
    if 'metrics' in value and value.get('input',{}).get('sceneId')=='instruments-0':
        _,_,output['scope']=microscope_context(value['input']['parameters'])
        signed_labels={m['metricKey']:m['signed']['label']+' '+m['signed']['symbol'] for m in value.get('calculation',{}).get('magnifications',[])}
        for metric in output['metrics']:
            if metric['key'] in signed_labels:metric['label']=signed_labels[metric['key']]
    return output
