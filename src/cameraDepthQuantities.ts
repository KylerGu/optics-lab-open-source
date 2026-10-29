export const CAMERA_DEPTH_QUANTITIES:Record<string,{label:string;symbol:string;color:string}>={
  focusDistance:{label:'对焦物距',symbol:'u₀',color:'#357fc6'},
  nearDepth:{label:'景深近界',symbol:'Dₙ',color:'#198e98'},
  farDepth:{label:'景深远界',symbol:'D𝒻',color:'#8a5eac'},
  depth:{label:'景深范围',symbol:'ΔD',color:'#26836a'},
  blurDiameter:{label:'当前光斑直径',symbol:'c',color:'#bf5279'},
  coc:{label:'容许光斑直径',symbol:'c₀',color:'#9a7630'},
};
export const CAMERA_DEPTH_ANNOTATIONS=['u','focusDistance','nearDepth','farDepth','depth'];
