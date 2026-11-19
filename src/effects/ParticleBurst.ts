import { between, pick } from '../core/random';
import type { Effect } from './Effect';
import { resolveShape } from './Effect';

/** Particles explode outward from the caret in every direction, then arc down under light gravity. */
export const ParticleBurst: Effect = {
  id: 'particles',
  naturalShape: 'circle',
  spawn(emitter, params) {
    const { rng } = emitter;
    const shape = resolveShape(params.shape, this.naturalShape);
    const baseSpeed = 260 * params.speed * params.intensityFactor;
    for (let i = 0; i < params.count; i++) {
      const angle = rng() * Math.PI * 2;
      const speed = baseSpeed * between(rng, 0.4, 1);
      emitter.particle({
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - baseSpeed * 0.15,
        ay: 280,
        drag: 4,
        size: params.size * between(rng, 0.7, 1.35),
        sizeEnd: 0.15,
        life: between(rng, 0.55, 1),
        color: pick(rng, params.colors),
        shape,
        glow: params.glow && i % 3 === 0 ? 0.6 : 0,
        rotation: rng() * 360,
        spin: shape === 'circle' ? 0 : between(rng, -360, 360),
        alignToVelocity: shape === 'spark',
      });
    }
  },
};
