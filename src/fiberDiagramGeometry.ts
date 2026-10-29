export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
export function diagramLayout(width: number, height: number, fiber?: { radiusUm: number; internalDeg: number }) {
  const w = Math.max(360, width), h = Math.max(500, height);
  const left = Math.min(220, Math.max(120, w * .25)), right = w - 62;
  // One scale in both axes: the ray direction and drawn angles agree.
  const baseScale = Math.min((right - left) / 100, (h - 160) / 60);
  const slope = fiber ? Math.tan(fiber.internalDeg * Math.PI / 180) : 0;
  const firstHitUm = fiber && slope > 1e-14 ? fiber.radiusUm / slope : null;
  // Fit the first real intersection at 60% of the window, leaving room for
  // the reflected/refracted ray. Keep one scale for both axes and a readable
  // core: nearly axial rays can still have their first hit outside the view.
  const fittedScale = firstHitUm === null ? baseScale : Math.min(baseScale, (right-left) * .6 / firstHitUm);
  const minHalf = Math.min(18, (right-left) * .03);
  const scale = fiber ? Math.max(fittedScale, Math.min(baseScale, minHalf / fiber.radiusUm)) : baseScale;
  return { w, h, left, right, cy: h * .5, scale, rayLength: Math.min(170, left - 26), viewUm: (right-left)/scale };
}
export function angleFromPoint(px: number, py: number, entryX: number, axisY: number) {
  return Math.round(clamp(Math.atan2(py-axisY, entryX-px)*180/Math.PI, 0, 30)*10)/10;
}
export function arcPath(cx: number, cy: number, r: number, from: number, to: number) {
  const point = (a: number) => `${cx+r*Math.cos(a)},${cy+r*Math.sin(a)}`;
  return `M${point(from)} A${r},${r} 0 ${Math.abs(to-from)>Math.PI?1:0} ${to>=from?1:0} ${point(to)}`;
}
