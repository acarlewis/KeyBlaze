import { between } from '../core/random';
import type { Effect } from './Effect';
import { paletteColor, resolveShape } from './Effect';

/**
 * Fire: buoyant flame tongues that swell in, sway and shrink as they rise, plus flickering embers that
 * shoot higher. Fire rises naturally, so both variants rise. The full variant starts a little lower,
 * around the caret, while the upward variant starts at the baseline.
 * Palette order is treated as hot → cool: flames favour the first colours, embers the last ones.
 */
export const FireEffect: Effect = {
  id: 'fire',
  naturalShape: 'circle',
  spawn(emitter, params) {
    const { rng } = emitter;
    const shape = resolveShape(params.shape, this.naturalShape);
    const f = params.intensityFactor;
    const lift = 110 * params.speed * f;
    const flames = Math.max(1, Math.round(params.count * 0.7));
    const embers = Math.max(0, params.count - flames);
    const spread = 5 * f;
    const startY = params.variant === 'full' ? 4 : 0;

    for (let i = 0; i < flames; i++) {
      emitter.particle({
        x: between(rng, -spread, spread),
        y: startY + between(rng, -2, 2),
        vx: between(rng, -22, 22) * params.speed,
        vy: -lift * between(rng, 0.5, 1),
        ay: -lift * 1.8,
        drag: 1.6,
        size: params.size * between(rng, 0.9, 1.6),
        sizeEnd: 0.1,
        life: between(rng, 0.45, 0.95),
        color: paletteColor(rng, params.colors, 1.6),
        shape,
        glow: params.glow && i % 2 === 0 ? 0.55 : 0,
        fadeIn: true,
        sway: 5 * f,
        flicker: 0.2,
      });
    }
    for (let i = 0; i < embers; i++) {
      const angle = -Math.PI / 2 + between(rng, -0.6, 0.6);
      const speed = lift * between(rng, 1.4, 2.4);
      emitter.particle({
        x: between(rng, -spread, spread) * 0.6,
        y: startY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        ay: -40,
        drag: 2.2,
        size: params.size * between(rng, 0.35, 0.6),
        sizeEnd: 0.3,
        life: between(rng, 0.6, 1),
        color: paletteColor(rng, [...params.colors].reverse(), 1.4),
        shape: shape === 'circle' ? 'circle' : shape,
        glow: params.glow ? 0.5 : 0,
        flicker: 0.6,
        alignToVelocity: shape === 'spark',
      });
    }
  },
};
