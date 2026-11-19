import { between, pick } from '../core/random';
import type { Effect } from './Effect';
import { launchAngle, resolveShape } from './Effect';

/**
 * Energy Burst: a bright core flash, staggered shockwave rings expanding outward with a smooth
 * ease-out fade, and charged motes riding the first wave.
 * Upward variant: compact rings that rise from the caret like pulses of energy, plus an upward fan of motes.
 */
export const EnergyBurst: Effect = {
  id: 'energy',
  naturalShape: 'circle',
  spawn(emitter, params) {
    const { rng } = emitter;
    const f = params.intensityFactor;
    const shape = resolveShape(params.shape, this.naturalShape);
    const upward = params.variant === 'upward';
    const rings = params.intensity >= 7 ? 3 : 2;
    const stroke = Math.max(1, params.size * 0.6);
    const reach = 26 * f * Math.sqrt(params.speed);

    emitter.particle({
      vx: 0,
      vy: upward ? -30 : 0,
      size: params.size * 1.2,
      sizeEnd: 2.2,
      life: 0.18,
      color: params.colors[0] ?? '#ffffff',
      shape: 'circle',
      glow: params.glow ? 0.5 : 0,
    });

    for (let i = 0; i < rings; i++) {
      emitter.ring({
        radiusFrom: 2,
        radiusTo: upward ? (7 + i * 3) * f : reach * (0.75 + i * 0.3),
        vy: upward ? -(45 + i * 22) * params.speed : 0,
        strokeWidth: stroke * (1 - i * 0.2),
        color: params.colors[i % params.colors.length] ?? '#ffffff',
        glow: params.glow ? 0.8 : 0,
        delay: i * 0.13,
        life: 0.75,
      });
    }

    const motes = Math.max(2, params.count - rings - 1);
    const moteSpeed = reach * 4.2;
    for (let i = 0; i < motes; i++) {
      const angle = upward
        ? launchAngle(rng, 'upward', Math.PI * 0.35)
        : (i / motes) * Math.PI * 2 + between(rng, -0.2, 0.2);
      const speed = moteSpeed * between(rng, 0.75, 1);
      emitter.particle({
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        drag: 5,
        size: params.size * between(rng, 0.5, 0.9),
        sizeEnd: 0.2,
        life: between(rng, 0.45, 0.75),
        color: pick(rng, params.colors),
        shape,
        alignToVelocity: shape === 'spark',
        glow: params.glow && i % 2 === 0 ? 0.7 : 0,
      });
    }
  },
};
