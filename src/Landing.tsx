import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { ArrowRight, Box, FlaskConical, Github, LayoutGrid, Sigma } from 'lucide-react';
import '@fontsource/noto-serif-sc/600.css';
import './landing.css';
import { isLandingHash, markLandingSeen, readLandingSeen, shouldShowLanding, slopeAfterLens, thinLensImage } from './landingModel';

/** 开场动画总时长（ms）：光点 → 光束射入 → 聚焦 → 标题显现 */
const INTRO_MS = 2200;
const FOCUS_AT_MS = 1450;
const LEAVE_MS = 450;
/** 主按钮进入的场景：杨氏双缝 */
const PRIMARY_TARGET = '#/scene/interference-0';
const FOCAL_MM = 100;
const RAY_COUNT = 13;
/** 激光颜色（RGB），与 CSS 变量 --laser 保持一致 */
const LASER: [number, number, number] = [255, 190, 96];

type Stage = 'intro' | 'focus' | 'ready' | 'leaving';

const ENTRIES = [
  { hash: '#/scenes', label: '仿真场景', desc: '成像 · 干涉 · 衍射 · 偏振', Icon: LayoutGrid },
  { hash: '#/formulas', label: '公式查询', desc: '公式与参数含义', Icon: Sigma },
  { hash: '#/builder', label: '光路搭建', desc: '三维自由搭建', Icon: Box },
  { hash: '#/research', label: 'AI 探究', desc: '用自然语言做实验', Icon: FlaskConical },
];

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const rgba = (a: number, [r, g, b] = LASER) => `rgba(${r},${g},${b},${a})`;

function geometry(w: number, h: number) {
  const narrow = w < 720;
  const axis = h * (narrow ? 0.3 : 0.36);
  const x0 = w * (narrow ? 0.08 : 0.15);
  const f = Math.max(56, Math.min(w * (narrow ? 0.19 : 0.12), 170));
  const A = Math.max(44, Math.min(h * 0.12, 96));
  const rest = x0 + 2 * f;
  return { narrow, axis, x0, f, A, rest, minLens: x0 + f * 0.45, maxLens: Math.min(w * 0.82, x0 + f * 4.2) };
}

function formatMm(px: number, f: number) {
  if (!Number.isFinite(px)) return '∞';
  return `${Math.round((px * FOCAL_MM) / f)}`;
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function Landing({ playIntro, onEnter }: { playIntro: boolean; onEnter: (hash: string) => void }) {
  const reduced = useRef(prefersReducedMotion()).current;
  const skipIntro = !playIntro || reduced;
  const [stage, setStage] = useState<Stage>(skipIntro ? 'ready' : 'intro');
  const [interacted, setInteracted] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const startRef = useRef(0);
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const pointer = useRef({ x: 0, y: 0, active: false, last: 0 });

  const skip = useCallback(() => {
    if (stageRef.current !== 'intro' && stageRef.current !== 'focus') return;
    startRef.current = performance.now() - INTRO_MS;
    setStage('ready');
  }, []);

  const leave = useCallback((hash: string) => {
    if (stageRef.current === 'leaving') return;
    setStage('leaving');
    window.setTimeout(() => onEnter(hash), reduced ? 0 : LEAVE_MS);
  }, [onEnter, reduced]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (stageRef.current === 'intro' || stageRef.current === 'focus') { e.preventDefault(); skip(); }
    };
    const onMove = (e: PointerEvent) => {
      if (stageRef.current !== 'ready') return;
      pointer.current = { x: e.clientX, y: e.clientY, active: true, last: performance.now() };
      setInteracted(true);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onMove, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onMove);
    };
  }, [skip]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let w = 0, h = 0, dpr = 1;
    let g = geometry(1, 1);
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      g = geometry(w, h);
    };
    resize();
    window.addEventListener('resize', resize);

    const sim = { lensX: g.rest, s: 0, bloom: 0, focusFired: false };
    let readoutText = '';
    startRef.current = performance.now() - (skipIntro ? INTRO_MS : 0);
    let prev = performance.now();
    let raf = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) { prev = now; return; }
      const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
      const elapsed = now - startRef.current;
      const t = now / 1000;
      const introDone = elapsed >= INTRO_MS;

      if (!sim.focusFired && elapsed >= FOCUS_AT_MS) {
        sim.focusFired = true;
        sim.bloom = skipIntro ? 0 : 1;
        if (stageRef.current === 'intro') setStage('focus');
      }
      if (elapsed >= INTRO_MS && stageRef.current === 'focus') setStage('ready');

      // —— 目标位置：跟随指针；空闲时缓慢摆动，暗示可以交互 ——
      let targetLens = g.rest, targetS = 0;
      const p = pointer.current;
      const idle = !p.active || now - p.last > 4500;
      if (introDone) {
        if (!idle) {
          targetLens = clamp(p.x, g.minLens, g.maxLens);
          targetS = clamp((p.y - g.axis) / (h * 0.45), -1, 1) * g.A * 0.5;
        } else if (!reduced) {
          const k = clamp((elapsed - INTRO_MS) / 1500);
          targetLens = g.rest + Math.sin((elapsed - INTRO_MS) / 1000 * 0.55) * g.f * 0.7 * k;
          targetS = Math.sin((elapsed - INTRO_MS) / 1000 * 0.37) * g.A * 0.22 * k;
        }
      }
      const ease = 1 - Math.exp(-dt * (idle ? 3 : 9));
      sim.lensX += (targetLens - sim.lensX) * ease;
      sim.s += (targetS - sim.s) * ease;
      sim.bloom *= Math.exp(-dt * 1.6);

      const { axis, x0, f, A } = g;
      const lensX = sim.lensX, s = sim.s;
      const u = lensX - x0;
      const img = thinLensImage(u, f);
      const xEnd = w + 40;
      const front = introDone ? xEnd : x0 + (xEnd - x0) * easeInOut(clamp((elapsed - 350) / 1150));
      const sourceAlpha = clamp(elapsed / 400);
      const lensAlpha = clamp((elapsed - 200) / 500);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // 光轴
      ctx.globalCompositeOperation = 'source-over';
      ctx.setLineDash([3, 7]);
      ctx.strokeStyle = `rgba(170,190,225,${0.16 * lensAlpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, axis); ctx.lineTo(w, axis); ctx.stroke();
      ctx.setLineDash([]);

      // 焦点标记
      ctx.fillStyle = `rgba(190,205,235,${0.42 * lensAlpha})`;
      ctx.font = '11px "Hanken Grotesk Variable", sans-serif';
      ctx.textAlign = 'center';
      for (const [fx, label] of [[lensX - f, 'F'], [lensX + f, 'F′']] as const) {
        ctx.fillRect(fx - 0.5, axis - 4, 1, 8);
        ctx.fillText(label, fx, axis + 18);
      }

      // —— 光线 ——
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, front, h); ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      const rays: Array<[number, number, number, number, number, number, number]> = [];
      for (let i = 0; i < RAY_COUNT; i++) {
        const hh = -A + (2 * A * i) / (RAY_COUNT - 1);
        const slope = slopeAfterLens(s, u, hh, f);
        const y1 = axis + hh;
        const y2 = y1 + slope * (xEnd - lensX);
        const weight = 0.35 + 0.65 * (1 - Math.abs(hh) / A) ** 0.7;
        rays.push([x0, axis + s, lensX, y1, xEnd, y2, weight]);
      }
      const passes: Array<[number, number, [number, number, number]]> = [
        [7, 0.045, LASER], [2.4, 0.16, LASER], [0.9, 0.75, [255, 236, 200]],
      ];
      for (const [lw, alpha, color] of passes) {
        ctx.lineWidth = lw;
        for (const [ax, ay, bx, by, cx, cy, wgt] of rays) {
          ctx.strokeStyle = rgba(alpha * wgt * sourceAlpha, color);
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.stroke();
        }
      }

      // 光子粒子沿光路流动
      if (!reduced) {
        for (let i = 0; i < rays.length; i++) {
          const [ax, ay, bx, by, cx, cy, wgt] = rays[i];
          const l1 = Math.hypot(bx - ax, by - ay), l2 = Math.hypot(cx - bx, cy - by);
          for (let k = 0; k < 2; k++) {
            const d = ((t * 230 + i * 97 + k * (l1 + l2) / 2) % (l1 + l2));
            const [px, py] = d < l1
              ? [ax + (bx - ax) * d / l1, ay + (by - ay) * d / l1]
              : [bx + (cx - bx) * (d - l1) / l2, by + (cy - by) * (d - l1) / l2];
            const r = 7;
            const grad = ctx.createRadialGradient(px, py, 0, px, py, r);
            grad.addColorStop(0, rgba(0.9 * wgt, [255, 244, 220]));
            grad.addColorStop(1, rgba(0));
            ctx.fillStyle = grad;
            ctx.fillRect(px - r, py - r, r * 2, r * 2);
          }
        }
      }
      ctx.restore();

      // 光源与像点辉光
      ctx.globalCompositeOperation = 'lighter';
      const glow = (x: number, y: number, r: number, a: number) => {
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, rgba(a, [255, 248, 230]));
        grad.addColorStop(0.18, rgba(a * 0.65));
        grad.addColorStop(1, rgba(0));
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      };
      const pulse = reduced ? 1 : 1 + Math.sin(t * 2.4) * 0.08;
      glow(x0, axis + s, 34 * pulse, 0.9 * sourceAlpha);
      if (img.kind === 'real') {
        const ix = lensX + img.v, iy = axis + s * img.magnification;
        if (ix < w + 60 && front >= ix) {
          const sharp = clamp(1.6 - img.v / (f * 6), 0.35, 1);
          glow(ix, iy, (38 + 90 * sim.bloom) * pulse, (0.75 * sharp + 0.6 * sim.bloom));
        }
      }

      // 透镜
      ctx.globalCompositeOperation = 'source-over';
      const L = A * 1.18, bulge = Math.max(12, f * 0.13);
      const lensGrad = ctx.createLinearGradient(lensX - bulge, 0, lensX + bulge, 0);
      lensGrad.addColorStop(0, `rgba(150,190,255,${0.04 * lensAlpha})`);
      lensGrad.addColorStop(0.5, `rgba(190,215,255,${0.2 * lensAlpha})`);
      lensGrad.addColorStop(1, `rgba(150,190,255,${0.04 * lensAlpha})`);
      ctx.beginPath();
      ctx.moveTo(lensX, axis - L);
      ctx.quadraticCurveTo(lensX + bulge, axis, lensX, axis + L);
      ctx.quadraticCurveTo(lensX - bulge, axis, lensX, axis - L);
      ctx.fillStyle = lensGrad; ctx.fill();
      ctx.strokeStyle = `rgba(200,222,255,${0.55 * lensAlpha})`; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = `rgba(200,222,255,${0.5 * lensAlpha})`;
      ctx.fillRect(lensX - 7, axis - L - 4, 14, 1.5);
      ctx.fillRect(lensX - 7, axis + L + 2.5, 14, 1.5);

      // 实时读数（真实薄透镜计算）
      const kindLabel = img.kind === 'real' ? '倒立实像' : img.kind === 'virtual' ? '正立虚像' : '不成像';
      const m = Number.isFinite(img.magnification) ? `${img.magnification > 0 ? '+' : '−'}${Math.abs(img.magnification).toFixed(2)}×` : '∞';
      const text = `f ${FOCAL_MM} mm · u ${formatMm(u, f)} mm · v ${formatMm(img.v, f)} mm · β ${m} · ${kindLabel}`;
      if (text !== readoutText && readoutRef.current) { readoutText = text; readoutRef.current.textContent = text; }
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [reduced, skipIntro]);

  const go = (hash: string) => (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); leave(hash); };

  return (
    <div className="landing" data-stage={stage} onClick={skip}>
      <canvas ref={canvasRef} className="landing__canvas" aria-hidden="true" />
      <header className="landing__top">
        <div className="landing__brand"><span className="landing__brand-mark" />光学智研<span className="landing__brand-en">Optics Lab</span></div>
        {stage === 'intro' || stage === 'focus'
          ? <button type="button" className="landing__skip" onClick={e => { e.stopPropagation(); skip(); }}>跳过动画</button>
          : <a className="landing__github" href="https://github.com/KylerGu/optics-lab-open-source" target="_blank" rel="noreferrer"><Github size={15} />开源代码</a>}
      </header>

      <main className="landing__main">
        <h1 className="landing__title">光学智研</h1>
        <p className="landing__subtitle">看见光的每一次折射 —— 调参数、搭光路、问 AI，在浏览器里完成光学实验</p>
        <div className="landing__actions">
          <a className="landing__cta" href={PRIMARY_TARGET} onClick={go(PRIMARY_TARGET)}>开始实验<ArrowRight size={18} /></a>
          <a className="landing__ghost" href="#/scenes" onClick={go('#/scenes')}>随便看看</a>
        </div>
        <nav className="landing__entries" aria-label="功能入口">
          {ENTRIES.map(({ hash, label, desc, Icon }) => (
            <a key={hash} href={hash} onClick={go(hash)} className="landing__entry">
              <Icon size={16} /><span className="landing__entry-label">{label}</span><span className="landing__entry-desc">{desc}</span>
            </a>
          ))}
        </nav>
      </main>

      <div className={`landing__hint${interacted ? ' is-hidden' : ''}`}>移动鼠标或拖动画面：左右改变物距，上下改变物高</div>
      <div className="landing__readout" ref={readoutRef} aria-live="off" />
    </div>
  );
}

/** 根据地址与访问记录决定显示引导页还是主应用。 */
export function LandingGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState(() => {
    const seen = readLandingSeen();
    return { show: shouldShowLanding(window.location.hash, seen), intro: !seen, key: 0 };
  });

  useEffect(() => {
    const onHash = () => {
      if (isLandingHash(window.location.hash)) setState(prev => prev.show ? prev : { show: true, intro: false, key: prev.key + 1 });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const enter = useCallback((hash: string) => {
    markLandingSeen();
    if (isLandingHash(window.location.hash)) window.location.hash = hash;
    else window.history.replaceState(null, '', hash);
    setState(prev => ({ ...prev, show: false }));
  }, []);

  return state.show ? <Landing key={state.key} playIntro={state.intro} onEnter={enter} /> : <>{children}</>;
}
