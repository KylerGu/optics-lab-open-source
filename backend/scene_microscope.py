"""Infinity-objective camera microscope, with a fixed tube-lens image plane.

The adapter is an ideal image relay. The diagram uses pre-relay coordinates;
the sensor height is referred back through its magnification to this plane.
"""
import math
from .scene_geometrical import double_image


def calculate_camera_microscope(state, definition, revision):
    p=state['parameters']; f=p['f1']; ft=p['tubeF']; u=p['u']; h=p['h']; d=p['d']; relay=p['adapter']
    conjugate=double_image(f,ft,d,u); v=conjugate['v']; focused=abs(u-f)<=1e-9*max(1,f)
    magnification=-ft/f*relay; fw=p['sensorW']/abs(magnification); fh=p['sensorH']/abs(magnification)
    sensor_x=d+ft; sensor_half=p['sensorH']/relay/2
    xmin=-max(30,u*1.2); xmax=sensor_x+max(30,ft*.15)
    segments=[]; y2s=[]; angles=[]
    for y1 in (h,0):
        t1=(y1-h)/u-y1/f; y2=y1+d*t1; t2=t1-y2/ft
        y2s.append(y2); angles.extend((abs((y1-h)/u),abs(t1),abs(t2)))
        for start,end,role in [([-u,h],[0,y1],'incident'),([0,y1],[d,y2],'internal'),([d,y2],[sensor_x,y2+ft*t2],'transmitted')]:
            segments.append(dict(start=start,end=end,role=role,dashed=False,power=1))
    ymax=max(.5,h*2.5,sensor_half*1.2,abs(ft/f*h)*1.3,max(abs(y) for y in y2s)*1.5)
    warnings=[]
    if not focused:warnings.append('当前未对焦：物体需位于物镜前焦面。')
    if max(angles)>.15:warnings.append('光线倾角较大，真实系统可能超出近轴近似。')
    metrics=[]
    def metric(key,label,value,unit='',note=''):metrics.append(dict(key=key,label=label,value=value,unit=unit,note=note))
    metric('cameraM','相机光学放大率',magnification,'倍','对焦时的尺寸放大率；负号表示倒像')
    metric('fieldWidth','水平视场',fw,'mm','对焦时对应的样品范围')
    metric('fieldHeight','垂直视场',fh,'mm')
    metric('fieldDiagonal','对角线视场',math.hypot(fw,fh),'mm')
    metric('objectiveM','物镜与管镜放大率',-ft/f)
    metric('v','最佳像面距管镜',v,'mm','像面在无穷远' if v is None else '相机固定在管镜后焦面；转接倍率只缩放像面')
    metric('focusOffset','物体离焦量',u-f,'mm')
    markers=[dict(x=-u,y=h,label='物体',role='object')]
    if focused:markers.append(dict(x=sensor_x,y=-ft/f*h,label='管镜像',role='image'))
    return dict(revision=revision,input=state,modelVersion='scene-physics-2',model='microscope',scope=definition['scope'],
                status='相机成像：倒像，已对焦' if focused else '相机成像：未对焦',warnings=warnings,metrics=metrics,
                segments=segments,markers=markers,regions=[],bounds=[xmin,xmax,-ymax,ymax],imagePreview=None,
                devices=[dict(kind='lens',x=0,height=ymax*.65,label='物镜',sign=1),dict(kind='lens',x=d,height=ymax*.65,label='管镜',sign=1),dict(kind='screen',x=sensor_x,height=sensor_half,label='管镜像面（转接前）',sign=1)],
                curve=[dict(x=.25+j*1.75/140,y=p['sensorW']/(ft/f*(.25+j*1.75/140))) for j in range(141)],
                chart=dict(xLabel='相机转接倍率 / 倍',yLabel='水平视场 / mm',currentX=relay,currentY=fw))
