/**
 * Canvas 2D drawing of BurstTrack elements: the Control Panel's equivalent of SvgRenderer.
 * Shapes, glow halos, rings and bolts match the SVG output so the preview is faithful.
 */
import type { BurstElement, BurstTrack, Frame, ShapeKind } from '../core/BurstTrack';
import { sampleFrame } from '../render/frameSampler';

export function drawTrack(
  ctx: CanvasRenderingContext2D,
  track: BurstTrack,
  elapsedMs: number,
  originX: number,
  originY: number,
  glow: boolean,
): void {
  for (const el of track.elements) {
    const f = sampleFrame(el, elapsedMs, track.durationMs);
    if (!f || f.o <= 0.003) continue;
    ctx.save();
    ctx.translate(originX + f.x, originY + f.y);
    drawElement(ctx, el, f, glow && el.glow > 0);
    ctx.restore();
  }
}

function drawElement(
  ctx: CanvasRenderingContext2D,
  el: BurstElement,
  f: Frame,
  glow: boolean,
): void {
  switch (el.kind) {
    case 'particle': {
      const size = el.size * f.s;
      if (size <= 0) return;
      if (glow) {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 2.5);
        g.addColorStop(0, withAlpha(el.color, 0.9));
        g.addColorStop(1, withAlpha(el.color, 0));
        ctx.globalAlpha = f.o * el.glow;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, size * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = f.o;
      ctx.fillStyle = el.color;
      if (el.shape !== 'circle') ctx.rotate((f.r * Math.PI) / 180);
      shapePath(ctx, el.shape, size);
      ctx.fill();
      return;
    }
    case 'ring': {
      if (f.s <= 0) return;
      ctx.globalAlpha = f.o;
      ctx.strokeStyle = el.color;
      if (glow) {
        ctx.lineWidth = el.strokeWidth * 3;
        ctx.globalAlpha = f.o * 0.25 * el.glow;
        ctx.beginPath();
        ctx.arc(0, 0, f.s, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = f.o;
      }
      ctx.lineWidth = el.strokeWidth;
      ctx.beginPath();
      ctx.arc(0, 0, f.s, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
    case 'bolt': {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const stroke = (width: number, color: string, alpha: number): void => {
        ctx.globalAlpha = f.o * alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        for (let i = 0; i + 1 < el.points.length; i += 2) {
          const x = (el.points[i] ?? 0) * f.s;
          const y = (el.points[i + 1] ?? 0) * f.s;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };
      if (glow) stroke(el.width * 3, el.color, 0.3 * el.glow);
      stroke(el.width, el.color, 1);
      if (glow) stroke(el.width * 0.4, '#ffffff', 0.85);
      return;
    }
  }
}

function shapePath(ctx: CanvasRenderingContext2D, shape: ShapeKind, size: number): void {
  ctx.beginPath();
  switch (shape) {
    case 'circle':
      ctx.arc(0, 0, size, 0, Math.PI * 2);
      break;
    case 'square':
      ctx.rect(-0.8 * size, -0.8 * size, 1.6 * size, 1.6 * size);
      break;
    case 'triangle':
      ctx.moveTo(0, -size);
      ctx.lineTo(0.87 * size, 0.5 * size);
      ctx.lineTo(-0.87 * size, 0.5 * size);
      ctx.closePath();
      break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? size : size * 0.4;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      break;
    case 'spark':
      ctx.rect(-1.6 * size, -0.25 * size, 3.2 * size, 0.5 * size);
      break;
  }
}

/** `#rgb` / `#rrggbb` → `rgba()` with alpha. */
export function withAlpha(hex: string, alpha: number): string {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = Number.parseInt(h, 16);
  if (Number.isNaN(n)) return `rgba(255,255,255,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
