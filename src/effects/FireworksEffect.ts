import { between, pick } from '../core/random';
import type { Emitter } from '../core/ParticleEngine';
import type { Effect, EffectParams } from './Effect';
import { resolveShape } from './Effect';

export type FireworkPattern = 'sphere' | 'ring' | 'double' | 'star';
export const FIREWORK_PATTERNS: readonly FireworkPattern[] = ['sphere', 'ring', 'double', 'star'];

/**
 * Fireworks: each keystroke picks an explosion pattern (sphere, ring, double ring or five-point star),
 * with two shell colours, gravity droop, late sparkle and a crackle of delayed micro-sparks.
 * Upward variant: a rocket streaks up from the caret and the shell explodes above the line.
 */
export const FireworksEffect: Effect = {
  id: 'fireworks',
  naturalShape: 'circle',
  spawn(emitter, params) {
    const { rng } = emitter;
    if (params.variant === 'upward') {
      const height = 26 * params.intensityFactor * Math.sqrt(params.speed);
      const delay = 0.22;
      emitter.particle({
        vx: between(rng, -15, 15),
        vy: (-height / (delay * (params.lifetimeMs / 1000))) * 1.6,
        drag: 3,
        size: params.size * 0.8,
        sizeEnd: 0.6,
        life: delay,
        color: params.colors[params.colors.length - 1] ?? '#ffffff',
        shape: 'spark',
        alignToVelocity: true,
        glow: params.glow ? 0.6 : 0,
      });
      shell(emitter, params, 0, -height, delay, 0.7);
    } else {
      shell(emitter, params, 0, 0, 0, 1);
    }
  },
};

function shell(
  e: Emitter,
  params: EffectParams,
  x: number,
  y: number,
  delay: number,
  scale: number,
): void {
  const { rng } = e;
  const shape = resolveShape(params.shape, 'circle');
  const pattern = FIREWORK_PATTERNS[Math.floor(rng() * FIREWORK_PATTERNS.length)] ?? 'sphere';
  const colorA = pick(rng, params.colors);
  const colorB = pick(rng, params.colors);
  const base = 175 * params.speed * params.intensityFactor * scale;
  const n = Math.max(4, params.count);
  const crackles = Math.max(0, Math.round(n * 0.15));
  const primaries = n - crackles;
  const life = Math.max(0.3, 1 - delay);

  for (let i = 0; i < primaries; i++) {
    let angle: number;
    let speed: number;
    switch (pattern) {
      case 'ring':
        angle = (i / primaries) * Math.PI * 2;
        speed = base * between(rng, 0.97, 1.03);
        break;
      case 'double': {
        const inner = i % 2 === 0;
        angle = (i / primaries) * Math.PI * 2 + (inner ? 0.15 : 0);
        speed = base * (inner ? 0.55 : 1) * between(rng, 0.97, 1.03);
        break;
      }
      case 'star': {
        const spoke = i % 5;
        angle = (spoke / 5) * Math.PI * 2 - Math.PI / 2 + between(rng, -0.05, 0.05);
        speed = base * between(rng, 0.3, 1.05);
        break;
      }
      default:
        angle = rng() * Math.PI * 2;
        speed = base * Math.cbrt(between(rng, 0.15, 1));
    }
    e.particle({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      ay: 150,
      drag: 2.6,
      size: params.size * between(rng, 0.6, 1.05),
      sizeEnd: 0.25,
      delay,
      life: life * between(rng, 0.75, 1),
      color: pattern === 'double' && i % 2 === 0 ? colorB : colorA,
      shape,
      glow: params.glow && i % 2 === 0 ? 0.6 : 0,
      flicker: 0.35,
      alignToVelocity: shape === 'spark',
    });
  }
  for (let i = 0; i < crackles; i++) {
    const angle = rng() * Math.PI * 2;
    const r = base * 0.12 * between(rng, 0.5, 1);
    e.particle({
      x: x + Math.cos(angle) * r,
      y: y + Math.sin(angle) * r,
      vx: between(rng, -20, 20),
      vy: between(rng, -20, 20),
      size: params.size * 0.5,
      sizeEnd: 0.5,
      delay: delay + life * between(rng, 0.45, 0.6),
      life: life * 0.3,
      color: params.colors[params.colors.length - 1] ?? '#ffffff',
      shape: 'circle',
      flicker: 0.8,
      glow: params.glow ? 0.8 : 0,
    });
  }
}
