import { between, pick } from '../core/random';
import type { Effect } from './Effect';
import { launchAngle, resolveShape } from './Effect';

/**
 * Particle Explosion: particles burst from the caret, then arc under light gravity.
 * Upward variant: a fountain fanned upward with softer gravity, fading before it falls back to the line.
 */
export const ParticleBurst: Effect = {
  id: 'particles',
  naturalShape: 'circle',
  spawn(emitter, params) {
    const { rng } = emitter;
    const upward = params.variant === 'upward';
    const shape = resolveShape(params.shape, this.naturalShape);
    const baseSpeed = 260 * params.speed * params.intensityFactor;
    for (let i = 0; i < params.count; i++) {
      const angle = launchAngle(rng, params.variant);
      const speed = baseSpeed * between(rng, 0.4, 1);
      emitter.particle({
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (upward ? 0 : baseSpeed * 0.15),
        ay: upward ? 160 : 280,
        drag: 4,
        size: params.size * between(rng, 0.7, 1.35),
        sizeEnd: 0.15,
        life: upward ? between(rng, 0.5, 0.85) : between(rng, 0.55, 1),
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
