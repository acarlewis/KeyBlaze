import type { Random } from '../core/random';
import { between, chance, pick } from '../core/random';
import type { Effect } from './Effect';
import { launchAngle, resolveShape } from './Effect';

/**
 * Lightning: jagged, branching bolts crack out of the caret and flicker out, with a white-hot flash
 * at the origin and fast sparks that streak away. Upward variant: bolts fork upward only.
 */
export const LightningEffect: Effect = {
  id: 'lightning',
  naturalShape: 'spark',
  spawn(emitter, params) {
    const { rng } = emitter;
    const f = params.intensityFactor;
    const shape = resolveShape(params.shape, this.naturalShape);
    const bolts = Math.min(5, Math.max(1, Math.round(params.count / 3)));
    const width = Math.max(1.5, params.size * 0.75);
    const lightest = params.colors[params.colors.length - 1] ?? '#ffffff';

    for (let i = 0; i < bolts; i++) {
      const angle = launchAngle(rng, params.variant, Math.PI * 0.38);
      const length = between(rng, 24, 44) * f * Math.sqrt(params.speed);
      const color = pick(rng, params.colors);
      const delay = i * 0.04;
      const points = jaggedPath(rng, 0, 0, angle, length, 6, length * 0.16);
      emitter.bolt({
        points,
        width,
        color,
        glow: params.glow ? 0.9 : 0,
        life: between(rng, 0.35, 0.6),
        delay,
        flicker: 0.55,
      });
      if (chance(rng, 0.6)) {
        // A fork from somewhere along the first half of the main bolt.
        const at = 2 * (1 + Math.floor(rng() * 2));
        const bx = points[at] ?? 0;
        const by = points[at + 1] ?? 0;
        const forkAngle = angle + (chance(rng, 0.5) ? 1 : -1) * between(rng, 0.35, 0.8);
        emitter.bolt({
          points: jaggedPath(rng, bx, by, forkAngle, length * 0.5, 4, length * 0.1),
          width: width * 0.7,
          color,
          glow: params.glow ? 0.6 : 0,
          life: between(rng, 0.25, 0.45),
          delay: delay + 0.05,
          flicker: 0.6,
        });
      }
    }

    emitter.particle({
      vx: 0,
      vy: 0,
      size: params.size * 2.4 * f,
      sizeEnd: 0.4,
      life: 0.25,
      color: lightest,
      shape: 'circle',
      glow: params.glow ? 1 : 0,
    });

    const sparks = Math.max(2, params.count - bolts);
    const sparkSpeed = 240 * params.speed * f;
    for (let i = 0; i < sparks; i++) {
      const angle = launchAngle(rng, params.variant, Math.PI * 0.45);
      const speed = sparkSpeed * between(rng, 0.5, 1);
      emitter.particle({
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        drag: 6,
        size: params.size * between(rng, 0.45, 0.8),
        sizeEnd: 0.2,
        life: between(rng, 0.3, 0.6),
        color: pick(rng, params.colors),
        shape,
        alignToVelocity: shape === 'spark',
        flicker: 0.4,
        glow: params.glow && i % 2 === 0 ? 0.5 : 0,
      });
    }
  },
};

/**
 * A polyline from (x, y) along `angle` for `length` px, split into `segments` with perpendicular jitter
 * that tapers towards the end. Returns flat x,y pairs.
 */
export function jaggedPath(
  rng: Random,
  x: number,
  y: number,
  angle: number,
  length: number,
  segments: number,
  jitter: number,
): number[] {
  const points = [round(x), round(y)];
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const offset = i === segments ? 0 : (rng() * 2 - 1) * jitter * (1 - t * 0.5);
    points.push(round(x + dx * length * t - dy * offset), round(y + dy * length * t + dx * offset));
  }
  return points;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
