import { makeTemplate, parseExperiment, type Experiment } from './model';
import { experimentKey, validateResult, type SimulationResult } from './simulation';
import { validateFocusDesign, type FocusDesign } from './research';
import { validateStabilityStudy, type StabilityStudy } from './tolerance';

export const COURSE_ID = 'gaussian-lens';
export const LEARNING_KEY = 'optics-lab-learning-v1';
export const LESSON_IDS = ['propagation', 'focus', 'screen', 'design', 'tolerance'] as const;
export type LessonId = typeof LESSON_IDS[number];
export interface LearningContext {courseId: typeof COURSE_ID; lessonId: LessonId; prediction: string}
export const REFERENCES = [
  {title:'MIT：高斯光束与透镜传播（2.6.1节）', url:'https://ocw.mit.edu/courses/6-974-fundamentals-of-photonics-quantum-electronics-spring-2006/e9852c138493233bc2813f683da5b199_gaussian_bem_res.pdf'},
  {title:'MIT：几何光学与薄透镜', url:'https://ocw.mit.edu/courses/2-71-optics-spring-2014/04d4bff4ff4a9ae5e2c8ba7500905557_MIT2_71S14_lec4_notes.pdf'},
];
export const DIRECTIONS = [
  {id:'geometry', title:'几何光学', description:'光线如何反射、折射和成像', courses:['反射与折射','透镜成像'], available:false},
  {id:'wave', title:'波动光学', description:'干涉与衍射如何改变光的分布', courses:['干涉现象','衍射与分辨率'], available:false},
  {id:'laser', title:'激光与光束', description:'光束传播、聚焦与参数设计', courses:['高斯光束与透镜系统'], available:true},
  {id:'polarization', title:'偏振光学', description:'光的振动方向与偏振器', courses:['偏振态与偏振器'], available:false},
];
export const LESSONS: {id:LessonId; title:string; question:string; goal:string; options:string[]; instructions:string; formula:string; symbols:string; explanation:string; prompt:string}[] = [
  {id:'propagation',title:'01 · 观察自由传播',question:'将观察屏从140 mm移到350 mm，光束半径会怎样变化？',goal:'理解束腰（光束最细的位置）与自由传播的关系。',options:['变大','变小','基本不变'],instructions:'选中观察屏，把位置从140 mm改到350 mm，看光束边界和屏上半径怎样变化。输入束腰半径为0.05 mm。',formula:'w(d) = w₀ √[1 + (d / zR)²]；zR = πw₀² / λ',symbols:'w₀：输入束腰半径；w(d)：距束腰d处的半径；λ：波长；zR：衡量光束扩展快慢的特征距离。公式中长度统一用mm，波长nm需乘10⁻⁶。',explanation:'本节没有透镜。光源平面设为束腰，往右传播时光束逐渐变宽。几何光线初始平行，高斯光束仍有扩展，两者在图中含义不同。',prompt:'请结合当前装置和真实计算解释自由传播。先说明束腰与观察屏的距离，再解释屏移动后半径的变化；不要修改装置。'},
  {id:'focus',title:'02 · 透镜怎样聚焦',question:'屏固定在350 mm，把焦距从100 mm改到80 mm，屏上光斑一定更小吗？',goal:'区分焦距、最细位置和固定屏上的半径。',options:['一定更小','不一定，要看屏的位置','一定不变'],instructions:'选中透镜，把焦距从100 mm改到80 mm。屏固定在350 mm，比较最细位置与屏上半径的变化。',formula:'1/q出 = 1/q入 − 1/f',symbols:'f：透镜焦距；q：同时描述光束粗细和波前弯曲的复数参数。计算程序使用它传播高斯光束，学生不需要手动计算复数。',explanation:'透镜改变后续传播中的最细位置。焦距变短不等于某个固定屏上的光斑必然更小；要同时看屏与最细位置的关系。当前计算包括高斯光束扩展，最细位置不必恰好在几何焦点。',prompt:'请根据当前装置与真实结果解释：为什么焦距较短不一定使固定屏光斑更小？区分最细位置和屏上半径，给我一个可以继续验证的问题，不要修改装置。'},
  {id:'screen',title:'03 · 找到合适的观察平面',question:'只移动观察屏，透镜形成的光束最细位置会改变吗？',goal:'理解观察屏读数与光束传播本身的区别。',options:['会跟着屏一起移动','最细位置不变，屏读数可能变','光斑半径始终不变'],instructions:'透镜焦距为80 mm，把屏从350 mm移到330 mm附近。看屏上半径变了多少，以及光束最细位置是否改变。',formula:'q(d) = q起 + d；I(r)/I峰值 = exp(−2r²/w²)',symbols:'d：两平面之间的传播距离；r：距光轴的横向距离；w：该平面的1/e²光强半径，即光强降到峰值约13.5%时的距离。',explanation:'当前观察屏是读数平面，不阻挡后续光束。移动它不改变光束本身，只改变观察的位置。屏在最细位置附近时光斑较小，判断时请看实际数值。',prompt:'请用当前装置解释移动观察屏时会发生什么。说明屏在模型中是否阻挡传播，并区分光束最细位置与屏坐标；不要修改装置。'},
  {id:'design',title:'04 · 为固定屏设计方案',question:'位置和焦距同时变化时，只试一个参数就足够找到较好方案吗？',goal:'把观察现象转为有明确目标和范围的参数比较。',options:['足够，焦距越小总是越好','需要同时比较位置与焦距','所有组合效果相同'],instructions:'打开实验设计，固定屏在350 mm，让程序比较透镜位置200–300 mm、焦距80–160 mm的组合，再载入推荐观察光路。',formula:'比较目标：指定屏上的 w屏(p, f)',symbols:'p：透镜在实验台上的绝对位置；f：焦距。距离需要用坐标相减；设计目标是屏上的半径，而非任意位置的最小半径。',explanation:'搜索程序实际比较范围内的参数组合，并重新计算推荐。有限网格中较好的方案不等于连续范围内的全局最优；遇到模型警告的组合不参与推荐。',prompt:'观察屏固定在350 mm，透镜位置可在200–300 mm之间，焦距可在80–160 mm之间。请调用自动设计工具，解释为什么要联合比较，先比较不要载入。'},
  {id:'tolerance',title:'05 · 检查安装偏差',question:'无偏差时光斑较小的方案，出现偏差后一定也最好吗？',goal:'理解设计效果与对安装偏差的敏感性。',options:['一定也最好','需要按允许偏差重新比较','偏差不会影响光斑'],instructions:'当前透镜位置270 mm、焦距80 mm。打开误差分析，设置位置±1 mm、焦距±1%，看看屏上半径对偏差有多敏感。',formula:'p实际 = p + Δp；f实际 = f × (1 + ε/100)',symbols:'Δp：位置偏差，单位mm；ε：焦距偏差，单位%。标称参数是没有偏差时的设定；0表示该项固定。',explanation:'两个偏差同时组合计算。最大采样半径只代表已计算组合，没有假设发生概率，也不能保证连续误差范围中的严格最坏值。分析属于理想模型中的重复计算，不是实验测量。',prompt:'分析当前方案：位置允许偏差±1 mm，焦距允许偏差±1%，屏固定在当前位置。请调用误差分析工具，只分析不要修改装置。'},
];

export interface Observation {id:string; kind:'initial'|'observed'; capturedAt:string; prediction:string; note:string; result:SimulationResult; design:FocusDesign|null; study:StabilityStudy|null}
export interface LessonRecord {prediction:string; reflection:string; observations:Observation[]}
export interface LearningSession {schemaVersion:1; courseId:typeof COURSE_ID; startedAt:string; lessonId:LessonId; records:Record<LessonId,LessonRecord>}
export function newLearning():LearningSession {
  const records={} as LearningSession['records'];
  for(const id of LESSON_IDS)records[id]={prediction:'',reflection:'',observations:[]};
  return {schemaVersion:1,courseId:COURSE_ID,startedAt:new Date().toISOString(),lessonId:'propagation',records};
}
export function lessonExperiment(id:LessonId):Experiment {
  const experiment=makeTemplate('focus');experiment.name=`实验示例 · ${LESSONS.find(item=>item.id===id)!.title.slice(5)}`;
  if(id==='propagation'){experiment.elements=experiment.elements.filter(item=>item.kind!=='lens');for(const item of experiment.elements){if(item.kind==='laser')item.waistMm=0.05;if(item.kind==='screen')item.positionMm=140;}}
  for(const item of experiment.elements){if(item.kind==='lens'){if(id==='screen')item.focalLengthMm=80;if(id==='tolerance'){item.positionMm=270;item.focalLengthMm=80;}}}
  return experiment;
}
export function relevantDesign(design:FocusDesign|null,experiment:Experiment) {return !!design && [design.inputSnapshot,design.recommendation?.experiment].some(item=>item && experimentKey(item)===experimentKey(experiment));}
export function relevantStudy(study:StabilityStudy|null,experiment:Experiment) {return !!study && [study.inputSnapshot,study.recommendation?.experiment].some(item=>item && experimentKey(item)===experimentKey(experiment));}
export function capture(session:LearningSession,experiment:Experiment,result:SimulationResult|null,kind:Observation['kind'],design:FocusDesign|null,study:StabilityStudy|null):LearningSession {
  if(!result || experimentKey(result.inputSnapshot)!==experimentKey(experiment))throw Error('请等待当前装置计算完成再记录。');
  const lesson=LESSONS.find(item=>item.id===session.lessonId)!,record=session.records[lesson.id];
  if(!record.prediction)throw Error('请先选择你的预测，再记录结果。');
  if(kind==='observed'&&!record.observations.some(item=>item.kind==='initial'))throw Error('请先记录初始结果，再改变条件记录观察结果。');
  if(record.observations.length>=8)throw Error('本节已记录8条。请先导出备份，或删除不需要的记录后继续。');
  if(!result.screens.length || experiment.elements.filter(item=>item.kind==='laser').length!==1 || experiment.elements.filter(item=>item.kind==='lens').length!==(lesson.id==='propagation'?0:1))throw Error('当前装置与本节实验结构不同，请载入本节装置后再探索。');
  const observation:Observation={id:crypto.randomUUID(),kind,capturedAt:new Date().toISOString(),prediction:record.prediction,note:record.reflection,result,design:relevantDesign(design,experiment)?design:null,study:relevantStudy(study,experiment)?study:null};
  return {...session,records:{...session.records,[lesson.id]:{...record,observations:[...record.observations,observation]}}};
}
export function lessonComplete(record:LessonRecord,id:LessonId):boolean {
  const physicalKey=(experiment:Experiment)=>JSON.stringify(experiment.elements.map(element=>{
    const {id:_id,name:_name,...parameters}=element;return parameters;
  }));
  const initialIndex=record.observations.findIndex(item=>item.kind==='initial' && item.result.quality==='within-model');
  const initial=record.observations[initialIndex],later=record.observations.slice(initialIndex+1);
  const observed=later.find(item=>item.kind==='observed' && item.result.quality==='within-model' && initial && physicalKey(item.result.inputSnapshot)!==physicalKey(initial.result.inputSnapshot));
  const study=later.some(item=>item.kind==='observed' && item.study && item.study.baseline.eligible);
  const design=later.some(item=>item.kind==='observed' && item.design?.recommendation);
  return !!initial && !!record.reflection.trim() && (id==='tolerance'?study:id==='design'?!!observed&&design:!!observed);
}
export function parseLearning(value:unknown):LearningSession {
  const fail=():never=>{throw Error('课程记录格式无效，请使用本网站导出的学习记录。');};
  if(!value || typeof value!=='object')fail();const raw=value as LearningSession;
  if(raw.schemaVersion!==1 || raw.courseId!==COURSE_ID || !LESSON_IDS.includes(raw.lessonId) || typeof raw.startedAt!=='string' || !Number.isFinite(Date.parse(raw.startedAt)) || !raw.records || typeof raw.records!=='object')fail();
  const session=newLearning();session.startedAt=raw.startedAt;session.lessonId=raw.lessonId;
  for(const lesson of LESSONS){const row=raw.records[lesson.id];if(!row || typeof row.prediction!=='string' || (row.prediction!==''&&!lesson.options.includes(row.prediction)) || typeof row.reflection!=='string' || row.reflection.length>2000 || !Array.isArray(row.observations) || row.observations.length>8)fail();
    const ids=new Set<string>();
    const observations=row.observations.map(point=>{if(!point || typeof point.id!=='string' || !point.id || ids.has(point.id) || !['initial','observed'].includes(point.kind) || typeof point.capturedAt!=='string' || !Number.isFinite(Date.parse(point.capturedAt)) || !lesson.options.includes(point.prediction) || typeof point.note!=='string' || point.note.length>2000 || !point.result || !Number.isInteger(point.result.revision) || point.result.revision<0)fail();ids.add(point.id);
      const experiment=parseExperiment(point.result?.inputSnapshot),result=validateResult(point.result,point.result.revision,experimentKey(experiment));
      if(!result.screens.length || experiment.elements.filter(item=>item.kind==='lens').length!==(lesson.id==='propagation'?0:1))fail();
      const design=point.design===null?null:validateFocusDesign(point.design),study=point.study===null?null:validateStabilityStudy(point.study);
      if(design&&!relevantDesign(design,experiment)||study&&!relevantStudy(study,experiment))fail();
      return {id:point.id,kind:point.kind,capturedAt:point.capturedAt,prediction:point.prediction,note:point.note,result,design,study};
    });session.records[lesson.id]={prediction:row.prediction,reflection:row.reflection,observations};
  }return session;
}
