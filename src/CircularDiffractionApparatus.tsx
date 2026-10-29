import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { CircularParameters } from './circularDiffraction';
import { youngLightColor } from './youngDoubleSlit';

/** Side view; transverse sizes and observation angles are enlarged for visibility. */
type DragField = 'apertureDiameterMm' | 'focalLengthMm';
type Props = { p: CircularParameters; annotations: string[]; viewRadius: number; onStart: () => void; onChange: (field: keyof CircularParameters, value: number) => void; onFinish: () => void };
const limits = { apertureDiameterMm: [1, 8, .05], focalLengthMm: [80, 250, 1] } as const;
const bounded = (field: DragField, value: number) => Number(Math.max(limits[field][0], Math.min(limits[field][1], value)).toFixed(5));
export default function CircularDiffractionApparatus({ p, annotations, viewRadius, onStart, onChange, onFinish }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 760, height: 560 });
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(svg.current!); return () => observer.disconnect();
  }, []);
  const { width: w, height: h } = size, y = h / 2;
  const left = w * .08, aperture = w * .31, lens = w * .52;
  const axialScale = w * .38 / 250, screen = lens + p.focalLengthMm * axialScale;
  const halfHeight = Math.min(h * .29, 180), opening = halfHeight * p.apertureDiameterMm / 10;
  const observationY = y - Math.min(p.observationRadiusUm / viewRadius, 1) * halfHeight * .8;
  const color = `rgb(${youngLightColor(p.wavelengthNm).join(',')})`;
  const marked = (key: string) => annotations.includes(key);
  const drag = useRef<{ id: number; field: DragField; origin: number; value: number; scale: number } | null>(null);
  const point = (clientX: number, clientY: number) => new DOMPoint(clientX, clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());
  const begin = (event: PointerEvent<SVGGElement>, field: DragField, direction = 1) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.currentTarget.focus(); onStart();
    const q = point(event.clientX, event.clientY);
    drag.current = { id: event.pointerId, field, origin: field === 'focalLengthMm' ? q.x : q.y, value: p[field], scale: field === 'focalLengthMm' ? 1 / axialScale : direction * 10 / halfHeight };
    svg.current!.setPointerCapture(event.pointerId);
  };
  const end = () => { if (drag.current) { drag.current = null; onFinish(); } };
  const keyboard = (field: DragField) => ({
    role: 'slider', tabIndex: 0, 'aria-valuemin': limits[field][0], 'aria-valuemax': limits[field][1], 'aria-valuenow': p[field],
    onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); onStart();
      const value = event.key === 'Home' ? limits[field][0] : event.key === 'End' ? limits[field][1] : p[field] + (['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : -1) * limits[field][2] * (event.shiftKey ? 10 : 1);
      onChange(field, bounded(field, value));
    },
    onKeyUp: onFinish, onBlur: () => { end(); onFinish(); },
  });
  return <svg ref={svg} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="圆孔衍射二维光路，可拖动圆孔边缘改变孔径、拖动焦平面改变焦距" data-testid="circular-apparatus"
    onPointerMove={event => { const d = drag.current; if (!d || d.id !== event.pointerId) return; const q = point(event.clientX, event.clientY); onChange(d.field, bounded(d.field, d.value + ((d.field === 'focalLengthMm' ? q.x : q.y) - d.origin) * d.scale)); }}
    onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
    <line className="gs-axis" x1={left - 12} x2={w - 20} y1={y} y2={y}/>
    {[-1, -.5, 0, .5, 1].map(t => <path key={t} d={`M${left} ${y + t * opening}H${lens}L${screen} ${y}`} fill="none" stroke={color} strokeOpacity=".65" strokeWidth="1.6"/>)}
    {[-1, 1].map(t => <path key={t} d={`M${left + 25} ${y + t * opening - 4}l7 4-7 4`} fill="none" stroke={color} strokeWidth="1.5"/>)}
    <path d={`M${aperture} ${y - halfHeight}V${y - opening}M${aperture} ${y + opening}V${y + halfHeight}`} stroke="#61768e" strokeWidth="7"/>
    {[-1, 1].map(direction => <g key={direction} {...keyboard('apertureDiameterMm')} aria-label={direction < 0 ? '拖动圆孔上边缘调孔径' : '拖动圆孔下边缘调孔径'} className="circular-aperture-handle" data-testid={direction < 0 ? 'circular-aperture-top' : 'circular-aperture-bottom'} onPointerDown={event => begin(event, 'apertureDiameterMm', direction)}>
      <circle cx={aperture} cy={y + direction * opening} r="13" fill="transparent"/><circle cx={aperture} cy={y + direction * opening} r="4.5" fill="#fff" stroke="#61768e" strokeWidth="1.8"/>
    </g>)}
    <path d={`M${lens} ${y - halfHeight}Q${lens + 24} ${y} ${lens} ${y + halfHeight}Q${lens - 24} ${y} ${lens} ${y - halfHeight}Z`} fill="#d8e8f7" fillOpacity=".55" stroke="#357fc6" strokeWidth="1.8"/>
    <g {...keyboard('focalLengthMm')} aria-label="拖动焦平面调焦距" className="circular-focus-handle" data-testid="circular-focus-handle" onPointerDown={event => begin(event, 'focalLengthMm')}>
      <rect x={screen - 13} y={y - halfHeight} width="26" height={halfHeight * 2} fill="transparent"/>
      <line x1={screen} x2={screen} y1={y - halfHeight} y2={y + halfHeight} stroke="#26836a" strokeWidth="2"/>
      <circle cx={screen} cy={y} r="4.5" fill="#fff" stroke="#26836a" strokeWidth="1.8"/>
    </g>
    <text className="circular-title" x={left + 20} y={y - halfHeight - 25} textAnchor="middle">平行光</text>
    <text className="circular-title" x={aperture} y={y - halfHeight - 25} textAnchor="middle">圆孔（侧视）</text>
    <text className="circular-title" x={lens} y={y - halfHeight - 25} textAnchor="middle">观察透镜</text>
    <text className="circular-title" x={screen} y={y - halfHeight - 25} textAnchor="middle">焦平面</text>
    {marked('wavelengthNm') && <text data-testid="circular-annotation-wavelengthNm" className="circular-symbol" x={left + 20} y={y - opening - 15}>λ</text>}
    {marked('apertureDiameterMm') && <g data-testid="circular-annotation-apertureDiameterMm" className="circular-dimension">
      <path d={`M${aperture - 22} ${y - opening}V${y + opening}M${aperture - 27} ${y - opening}h10M${aperture - 27} ${y + opening}h10`}/><text className="circular-symbol" x={aperture - 32} y={y + 5} textAnchor="end">D</text>
    </g>}
    {marked('focalLengthMm') && <g data-testid="circular-annotation-focalLengthMm" className="circular-dimension">
      <path d={`M${lens} ${y + halfHeight + 30}H${screen}M${lens} ${y + halfHeight + 25}v10M${screen} ${y + halfHeight + 25}v10`}/><text className="circular-symbol" x={(lens + screen) / 2} y={y + halfHeight + 53} textAnchor="middle">f</text>
    </g>}
    {marked('theta') && <g data-testid="circular-annotation-theta">
      <line x1={lens} x2={screen} y1={y} y2={observationY} stroke="#8a5eac" strokeWidth="1.5" strokeDasharray="5 4"/>
      <text className="circular-symbol" x={lens + 30} y={y - 12} style={{fill:'#8a5eac'}}>θ</text>
    </g>}
  </svg>;
}
