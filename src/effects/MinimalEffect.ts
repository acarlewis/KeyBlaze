import { between, pick } from '../core/random';
import type { Effect } from './Effect';
import { launchAngle, resolveShape } from './Effect';

/** Most particles Minimal ever draws, whatever the particle count, to keep distraction low. */
export const MINIMAL_MAX_PARTICLES = 6;

/**
 * Minimal: a handful of tiny sparks that travel a few pixels and are gone. There's no glow and no
 * gravity theatrics. Upward variant: the same sparks fanned upward.
 */
export const MinimalEffect: Effect = {
  id: 'minimal',
  naturalShape: 'circle',
  spawn(emitter, params) {
    const { rng } = emitter;
    const shape = resolveShape(params.shape, this.naturalShape);
    const count = Math.min(MINIMAL_MAX_PARTICLES, Math.max(1, params.count));
    const speed = 90 * params.speed * Math.sqrt(params.intensityFactor);
    for (let i = 0; i < count; i++) {
      const angle = launchAngle(rng, params.variant, Math.PI * 0.4);
      const v = speed * between(rng, 0.5, 1);
      emitter.particle({
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        drag: 5,
        size: params.size * between(rng, 0.8, 1.1),
        sizeEnd: 0.3,
        life: between(rng, 0.5, 0.9),
        color: pick(rng, params.colors),
        shape,
        alignToVelocity: shape === 'spark',
      });
    }
  },
};
