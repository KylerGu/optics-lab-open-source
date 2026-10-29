export const CAMERA_PIXEL_QUANTITIES:Record<string,{label:string;symbol:string;color:string}>={
  airyDiameter:{label:'衍射光斑直径',symbol:'dₐ',color:'#357fc6'},
  pixel:{label:'像素尺寸',symbol:'p',color:'#c16b37'},
  diffractionCutoff:{label:'衍射截止频率',symbol:'νc',color:'#8a5eac'},
  nyquist:{label:'像素采样上限',symbol:'νN',color:'#26836a'},
};
export const CAMERA_PIXEL_ANNOTATIONS=['airyDiameter','pixel'];
