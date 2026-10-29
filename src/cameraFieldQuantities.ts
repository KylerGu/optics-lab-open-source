// Shared symbols and colors keep controls, readouts and dimensions in agreement.
export const CAMERA_FIELD_QUANTITIES:Record<string,{label:string;symbol:string;color:string}>={
  fieldWidth:{label:'物方取景宽度',symbol:'W',color:'#26836a'},
  fieldHeight:{label:'物方取景高度',symbol:'H',color:'#198e98'},
  sensorW:{label:'感光面宽度',symbol:'Wₛ',color:'#8a5eac'},
  sensorH:{label:'感光面高度',symbol:'Hₛ',color:'#9a7630'},
};
export const CAMERA_FIELD_ANNOTATIONS=['fieldWidth','fieldHeight','sensorW','sensorH','h'];
