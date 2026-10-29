import {telescopeOptics} from './telescopeModel';
export const TELESCOPE_EYE_QUANTITIES:Record<string,{label:string;symbol:string;color:string}>={
  pupilDiameter:{label:'出瞳直径',symbol:'Dₚ',color:'#26836a'},
  pupilPosition:{label:'出瞳距目镜',symbol:'zₚ',color:'#8a5eac'},
  acceptedLight:{label:'入眼光束比例',symbol:'η',color:'#9a7630'},
  visibleField:{label:'模型内可见角宽',symbol:'βᵥ',color:'#357fc6'},
  eyeDistance:{label:'眼睛距目镜',symbol:'z',color:'#c16b37'},
  eyeOffset:{label:'眼睛偏心量',symbol:'hₑ',color:'#bf5279'},
  eyeDiameter:{label:'眼瞳直径',symbol:'Dᵢ',color:'#147f96'},
};
export function telescopeEyeCanMark(p:Record<string,number>,key:string){
 const o=telescopeOptics(p),px=o.pupilPosition===null?null:270+o.pupilPosition*3;
 const pupilFits=px!==null&&px>=90&&px<=680;
 if(key==='pupilPosition')return pupilFits&&Math.abs(o.pupilPosition!*3)>=18;
 if(key==='pupilDiameter')return pupilFits&&o.pupilDiameter!==null&&o.pupilDiameter*12>=18&&o.pupilDiameter*6<=165;
 if(key==='eyeDistance')return p.eyeDistance*3>=18;
 if(key==='eyeOffset')return Math.abs(p.eyeOffset)*12>=18;
 if(key==='eyeDiameter')return p.eyeDiameter*12>=18;
 return false;
}
