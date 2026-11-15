"""Shared on-demand prompt modules and lazy tool-guidance helpers for optics agents."""
import re

from .profile_lenses import ASPHERIC_KINDS, CYLINDER_KINDS, PHYSICAL_KINDS
from .spherical_lenses import SPHERICAL_KINDS

IMAGING_GUIDANCE = """物体成像与激光光斑是两类计算：凸透镜成像使用object物体、共轴理想薄透镜lens、screen或sensor观察面；不能用laser聚焦光斑代替物体成像。该成像模型暂不支持实体曲面透镜。objectMode默认finite，objectPattern可选F或arrow。有限物体用1/u+1/v=1/f、倍率m=-v/u确定初始位置，物体尺寸和口径保持小角度范围，共轴沿yawDeg=0朝+X（90朝+Z）。
查看物体成像用image_focused=1、image_defocus_mm=0、image_magnification、image_hits（elementId填观察面id，多物体时otherId指定物体id）。可直接读取imaging中的对焦和倍率，普通成像不额外加扫描或功率目标。screen_*仅属激光追迹，成像没有功率读数。解释时只用对焦、离焦、倍率等中文，称为仿真结果而非实测；不支持的成像条件应说明，不能改用激光冒充成像。"""

PROBE_OFFSET_GUIDANCE = """界面“屏上取样点位置”（旧名“观察点位置 x”）对应probeOffsetMm，指屏面横向上相对中心选取光强读数的位置（0为中心），不移动整块屏也不改光路；整块屏的空间坐标才是position[0/1/2]（界面X·前后等）。不要把position[0]当作屏上取样点，也不沿用旧坐标；可调范围为±min(3,屏半径)mm。该取样值仅用于满足条件的傅里叶频谱和4f输出光强，普通激光＋透镜＋屏不使用它。"""

GAUSSIAN_GUIDANCE = """高斯光束beamRadiusMm为束腰1/e²半径，模型假定M²=1，发散角由波长和半径决定（divergenceMrad仅影响parallel几何光线）。理想高斯包络（gaussianRadiusMm，已含理想衍射发散，焦点半径>0且焦平面未必等于束腰）与有限光线采样（footprintRadiusMm几何半径、sampledPowerMw到屏采样功率）分开计算，互不冒充。未截光时缩孔径不改变理想高斯半径；仅在近似准直、未截光、波长和焦距固定时增大入射束宽才减小理想聚焦束腰。遇到截光或近轴警告需说明适用范围；parallel模式无高斯半径。"""

PHYSICAL_LENS_GUIDANCE = """教学镜片预设：list_apparatus的teachingLensPresets提供30种与网页一致的实体镜片，可参考对应形状/口径/曲率/材料填入set_apparatus或add_apparatus；预设id不是器件id，focalMm是只读标称焦距不得写入元素；焦距反算须固定材料、厚度和两面半径比例再求曲率，不得用focalLengthMm控制实体镜片。
实体通光口径：diameterMm为玻璃外形，clearApertureMm（实体柱面用clearWidthMm/clearHeightMm）为有效通光尺寸，不得超过外形，超出部分光线吸收；改外形时同步检查通光尺寸，旧文档默认两者相等。
实体镜片模型（不支持成像及后续高斯包络，无镀膜，含Snell折射/反射损耗/色散/全反射，glass=custom才用折射率与阿贝数）：
- 球面：plano-convex-lens、biconvex-lens、plano-concave-lens、biconcave-lens（前两种会聚，后两种发散；frontRadiusMm/backRadiusMm存正半径且>口径一半，边厚>=0.1mm；平凸/平凹仅调frontRadiusMm）。
- 弯月：positive-meniscus-lens（正弯月会聚，前半径<后半径）、negative-meniscus-lens（负弯月发散，前半径>后半径），两半径沿局部正光轴均取正，须保持有效几何与正负焦距性质。
- 非球面：aspheric-convex-lens / aspheric-concave-lens，前非球面后平面，z=c*r²/(1+sqrt(1-(1+k)c²r²))+A4*r^4+A6*r^6（k=conicConstant默认-1，A4/A6默认0），k=0且A4=A6=0等价球面；k/A4/A6改边缘球差不改顶点近轴焦距，高阶系数须较小并保持边厚>=0.1mm。
- 柱面：理想cylindrical-lens（用focalLengthMm）与实体plano-convex/concave-cylinder-lens（cylinderWidthMm/HeightMm矩形外形，仅局部U聚焦，rollDeg旋转聚焦轴），用screen_radius_u_mm/v_mm和对应方向核对，不可用单向半径冒充二维点聚焦。"""

POLARIZATION_GUIDANCE = """偏振与波片：激光默认linear（polarizationDeg为局部截面偏振角，可设unpolarized）。偏振片polarizer（rollDeg为透光轴，transmission为轴向透过率，90度交叉消光时勿要求屏命中>0）。半波片half-wave-plate（rollDeg快轴，designWavelengthNm默认532，延迟pi*(designWavelengthNm/波长)，设计波长下线偏振角变为2*快轴-输入角）与四分之一波片quarter-wave-plate（延迟pi/2，快轴与线偏振成45度转圆偏振；0度线偏振经+45度快轴得S3=+1）。偏振分光镜polarizing-splitter（默认yawDeg=-45，pTransmission=1，sTransmission=0；aim_apparatus须给incomingFrom，透射沿原方向、反射按法线、无吸收）。波片与PBS保留复电场相位，用探测器polarization_s1/s2/s3核对归一化斯托克斯参数（|s3|=1为圆偏振，平方和0为未偏振，无光为null）；零功率支路hits可为0，不用单偏振片冒充分辨圆偏振与未偏振。"""

WAVE_FOURIER_GUIDANCE = PROBE_OFFSET_GUIDANCE + """
单缝与一维光栅：狭缝slit（slitWidthMm 0.001–20mm，slitHeightMm 0.01–200mm，rollDeg转缝宽方向）在均匀平行光正入射、宽光束窄长缝、无遮挡正对且a²/(lambda*L)<=0.1时给出远场归一化条纹diffraction（diffraction_first_minimum_mm / diffraction_width_mm），不与几何采样功率混为一谈。一维矩形振幅光栅amplitude-grating（gratingProfile=binary，gratingPeriodUm周期与gratingSlitUm缝宽用μm，刻线密度G=1000/periodUm）给传播级次gratingOrders及无遮挡均匀正入射一维菲涅耳剖面。
傅里叶频谱与4f滤波（使用gratingProfile=sinusoidal余弦光栅，period 80–400μm，波长380–780nm，光源waistOffsetMm至输入光栅，w 0.5–2mm，理想薄透镜口径>=12w，不满足条件则结果为空）：
- 傅里叶频谱：光栅到透镜f、透镜到屏f（f 80–250mm），trace_light返回fourier（orderPositionUm、spotRadiusUm、pointIntensity=I/I0、capturedPowerMw），核对用fourier_*，屏上取样用probeOffsetMm。
- 4f相干滤波：等焦距f/2f/f（f 80–130mm），共焦面可放pass/stop狭缝（宽度0.01–5mm、偏移±2.2mm、roll同光栅），返回fourF，核对用four_f_transmission / four_f_intensity / four_f_power_mw，不得用几何覆盖半径或功率替代波动读数。"""

PRISM_GUIDANCE = """棱镜：position为三角柱重心，diameterMm为截面边长，prismHeightMm为柱体厚度，法线局部X，rollDeg绕局部X转截面。right-prism默认X入射全反射向-U折转；dispersion-prism支持apexAngleDeg与多单色光（<=3源）比较色散（不得冒充连续白光）。BK7按波长算折射率，改refractiveIndex需先改glass='custom'。根据真实主光线出口放置观察屏，不把棱镜当薄片用aim_apparatus指定出射；核对折转角用deflection_deg（elementId填棱镜）。"""

COMPARISON_GUIDANCE = """参数比较与趋势判据：compare_parameter每轮最多3组、3至21点扫描，基于当前装置副本计算，不改原方案且不证明连续全局最优（如只测360/380/400mm只能说这三个位置中380mm最小，不能断言精确束腰在380mm）。比较目标的elementId必须填观察屏id（不是被扫描器件id），comparisonId填扫描记录id。验证单调不增须用comparison_nonincreasing=1，不可用comparison_nondecreasing=0冒充下降；验证确实改变用comparison_span。比较孔径截光时几何采样可选较高光线数（如201）；不同单位参数比较须明确各自范围或归一化尺度。示范实验可在模型内选合理范围并标为示范条件；涉及用户真实装置误差/定量评估且缺少关键范围时，只问一个必要问题。"""

MODELS_SCENE_GUIDANCE = """场景复用模型（run_model_experiment）：可直接复用独立双缝、波叠加、迈克耳孙、薄膜干涉以及显微镜instruments-0（study=0成像/1分辨率/2视场/3景深；比较NA对分辨率和景深影响须同波长同介质同NA分别算study=1和3）、望远镜instruments-1、相机instruments-2（相机/望远镜aperture均为直径mm，缩光圈即减小直径）。模型与三维光路独立，归一化条纹或局部光场不得冒充三维相干/mW功率/全局验证，参数缺省为示范默认条件。"""

VISUAL_ACTION_GUIDANCE = """画面操作入口（offer_visual_action）：需要指出画面位置、用户问在哪里调或希望对照操作时可生成按钮（仅支持已有薄透镜lens和观察屏screen的位置及焦距、或高斯光斑对照）。locate仅定位，adjust打开参数面板，compare并排对照，均不自动修改页面；按钮尚未点击，没有记录前不得声称已高亮、播放或改动界面，且仍须写明关键真实读数与原因，不以“点按钮自己看”敷衍。问候、纯概念问答或只要数值时不附按钮。"""

PLAN_METHOD_GUIDANCE = """计划与方法工具：set_research_plan / update_research_step仅在用户要求制定计划或多轮探究需跨轮跟进时使用，步骤更新必须引用真实计算recordReference；assess_research_method仅在需要明确模型能力边界与原问题差距时使用，不是每次计算的前置手续；set_research_title仅在titleNeeded为真且已有非寒暄探究问题时提炼标题，不覆盖手动标题。"""

CORE_TOPICS = {"imaging", "gaussian_beam", "physical_lens", "polarization", "wave_fourier", "prism", "comparison_metric"}

TOPIC_PATTERNS = {
    "imaging": re.compile(r"成像|虚像|实像|放大|倍率|像距|物距|聚焦|离焦|目镜|物镜|显微镜|望远镜|相机|照相机|景深|视场|分辨率|sensor|eye|object|image_", re.I),
    "physical_lens": re.compile(r"球面|平凸|双凸|平凹|双凹|弯月|非球面|柱面|曲率|中心厚|口径|通光|阿贝|球差|教学镜片|预设镜片|焦距设计|meniscus|aspheric|cylinder|cylindrical|bk7|n-bk7|clearaperture", re.I),
    "polarization": re.compile(r"偏振|波片|半波|四分之一波|圆偏振|椭圆偏振|线偏振|未偏振|斯托克斯|消光|马吕斯|分束|pbs|polariz|stokes|waveplate", re.I),
    "wave_fourier": re.compile(r"衍射|干涉|狭缝|单缝|双缝|光栅|4f|傅里叶|频谱|空间滤波|菲涅耳|迈克耳孙|薄膜|余弦|条纹|采样点|取样点|观察点|probeoffset|fourier|fourf|grating|slit", re.I),
    "prism": re.compile(r"棱镜|直角棱镜|三棱镜|顶角|偏转角|色散|prism|deflection", re.I),
    "comparison_metric": re.compile(r"扫描|比较|对照|对比|变化|趋势|单调|公差|误差|稳健|优化|判据|指标|compare|scan|tolerance|robust|nondecreasing|nonincreasing", re.I),
    "gaussian_beam": re.compile(r"高斯|束腰|瑞利|发散角|waist|gaussian|rayleigh|m\^?2", re.I),
    "models_scene": re.compile(r"双缝|迈克耳孙|薄膜|显微镜|望远镜|相机|照相机|干涉|叠加|光圈|na|数值孔径|分辨率|景深|视场|场景库|模型实验", re.I),
    "visual_action": re.compile(r"定位|高亮|哪里调|怎么调|自己调|按钮|对照|界面|打开", re.I),
    "plan_method": re.compile(r"计划|步骤|规划|方法|适用|极限|边界|能不能算|不支持|命名|标题|plan", re.I),
}

SPATIAL_MODULE_MAP = {
    "imaging": IMAGING_GUIDANCE,
    "gaussian_beam": GAUSSIAN_GUIDANCE,
    "physical_lens": PHYSICAL_LENS_GUIDANCE,
    "polarization": POLARIZATION_GUIDANCE,
    "wave_fourier": WAVE_FOURIER_GUIDANCE,
    "prism": PRISM_GUIDANCE,
    "comparison_metric": COMPARISON_GUIDANCE,
}

RESEARCH_MODULE_MAP = {
    **SPATIAL_MODULE_MAP,
    "models_scene": MODELS_SCENE_GUIDANCE,
    "visual_action": VISUAL_ACTION_GUIDANCE,
    "plan_method": PLAN_METHOD_GUIDANCE,
}

SPATIAL_CORE_ORDER = ["imaging", "gaussian_beam", "physical_lens", "polarization", "wave_fourier", "prism", "comparison_metric"]
RESEARCH_CORE_ORDER = [*SPATIAL_CORE_ORDER, "models_scene", "visual_action", "plan_method"]


def _kinds_topics(elements, model_experiments=None):
    topics = set()
    for element in elements or ():
        kind = getattr(element, "kind", None) if not isinstance(element, dict) else element.get("kind")
        beam_model = getattr(element, "beamModel", None) if not isinstance(element, dict) else element.get("beamModel")
        if kind in {"object", "eye", "sensor"}:
            topics.add("imaging")
        if kind in PHYSICAL_KINDS | {"cylindrical-lens"}:
            topics.add("physical_lens")
        if kind in {"polarizer", "polarizing-splitter", "half-wave-plate", "quarter-wave-plate"}:
            topics.add("polarization")
        if kind in {"slit", "amplitude-grating"}:
            topics.add("wave_fourier")
        if kind in {"right-prism", "dispersion-prism"}:
            topics.add("prism")
        if kind == "laser" and beam_model == "gaussian":
            topics.add("gaussian_beam")
    if model_experiments:
        topics.add("models_scene")
        for item in model_experiments:
            scene_id = item.get("sceneId") if isinstance(item, dict) else getattr(item, "sceneId", "")
            if isinstance(scene_id, str) and scene_id.startswith("instruments-"):
                topics.add("imaging")
            elif isinstance(scene_id, str):
                topics.add("wave_fourier")
    return topics


def detect_topics(
    texts,
    elements=None,
    model_experiments=None,
    *,
    has_plan=False,
    has_visual_actions=False,
    has_criteria=False,
    has_comparisons=False,
    needs_title=False,
):
    """Identify which specialized optics prompt modules apply to this turn."""
    topics = _kinds_topics(elements, model_experiments)
    if has_plan or needs_title:
        topics.add("plan_method")
    if has_visual_actions:
        topics.add("visual_action")
    if has_criteria or has_comparisons:
        topics.add("comparison_metric")
    combined = "\n".join(t for t in texts if isinstance(t, str) and t.strip())
    if combined:
        for topic, pattern in TOPIC_PATTERNS.items():
            if pattern.search(combined):
                topics.add(topic)
    return topics


def render_topics(topics, module_map, order):
    sections = [module_map[name] for name in order if name in topics and name in module_map]
    return "\n\n".join(sections)


def lazy_guidance_for_elements(elements, injected_topics, module_map):
    """Return un-injected topic guidance triggered when new optics are added or read mid-turn."""
    discovered = _kinds_topics(elements) - injected_topics
    if not discovered:
        return None
    injected_topics.update(discovered)
    return render_topics(discovered, module_map, [k for k in RESEARCH_CORE_ORDER if k in discovered]) or None
