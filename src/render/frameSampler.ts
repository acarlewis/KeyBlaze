/**
 * Samples a burst element at an arbitrary time by interpolating its evenly spaced keyframes linearly,
 * which is exactly how the SVG renderer's SMIL `values` lists animate (calcMode="linear", no keyTimes).
 * The Canvas preview uses this, so the preview and the editor show the same motion. Pure.
 */
import type { BurstElement, Frame } from '../core/BurstTrack';

export function sampleFrame(
  element: BurstElement,
  elapsedMs: number,
  durationMs: number,
): Frame | undefined {
  const frames = element.frames;
  const n = frames.length;
  if (n === 0) return undefined;
  if (elapsedMs >= durationMs) return frames[n - 1]; // fill="freeze": hold the last frame
  const t = Math.max(0, elapsedMs) / Math.max(1, durationMs);
  const position = t * (n - 1);
  const i = Math.min(n - 2, Math.floor(position));
  const a = frames[i];
  const b = frames[i + 1];
  if (!a || !b) return frames[0];
  const u = position - i;
  return {
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    s: a.s + (b.s - a.s) * u,
    o: a.o + (b.o - a.o) * u,
    r: a.r + (b.r - a.r) * u,
  };
}
