import { between, pick } from '../core/random';
import type { Effect } from './Effect';
import { resolveShape } from './Effect';

/**
 * Stars: a scatter of slowly spinning stars that twinkle in one after another around the caret, with
 * tiny glowing motes. In the full variant they drift gently down like falling stars. In the upward
 * variant they float up.
 */
export const StarEffect: Effect = {
  id: 'stars',
  naturalShape: 'star',
  spawn(emitter, params) {
    const { rng } = emitter;
    const f = params.intensityFactor;
    const upward = params.variant === 'upward';
    const shape = resolveShape(params.shape, this.naturalShape);
    const stars = Math.max(2, Math.round(params.count * 0.6));
    const motes = Math.max(1, params.count - stars);
    const radius = 16 * f;
    const drift = 28 * params.speed;

    for (let i = 0; i < stars; i++) {
      const angle = rng() * Math.PI * 2;
      const r = radius * Math.sqrt(rng());
      emitter.particle({
        x: Math.cos(angle) * r,
        y: upward ? -Math.abs(Math.sin(angle) * r) : Math.sin(angle) * r,
        vx: between(rng, -0.5, 0.5) * drift,
        vy: upward ? -drift * between(rng, 0.6, 1.2) : drift * between(rng, 0.2, 0.8),
        ay: upward ? -15 : 25,
        size: params.size * between(rng, 1, 1.8),
        sizeEnd: 0.3,
        delay: between(rng, 0, 0.3),
        life: between(rng, 0.5, 0.7),
        color: pick(rng, params.colors),
        shape,
        rotation: rng() * 72,
        spin: between(rng, -90, 90),
        fadeIn: true,
        flicker: 0.45,
        glow: params.glow && i % 2 === 0 ? 0.4 : 0,
      });
    }
    for (let i = 0; i < motes; i++) {
      const angle = upward ? -Math.PI / 2 + between(rng, -1, 1) : rng() * Math.PI * 2;
      const speed = drift * between(rng, 1, 2);
      emitter.particle({
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        drag: 1.5,
        size: params.size * between(rng, 0.3, 0.5),
        sizeEnd: 0.5,
        delay: between(rng, 0, 0.2),
        life: between(rng, 0.5, 0.8),
        color: pick(rng, params.colors),
        shape: 'circle',
        fadeIn: true,
        flicker: 0.7,
        glow: 0,
      });
    }
  },
};
