import type { EffectId } from './schema';

export const EFFECT_LABELS: Readonly<Record<EffectId, string>> = {
  particles: 'Particle Explosion',
  fire: 'Fire',
  lightning: 'Lightning',
  energy: 'Energy Burst',
  fireworks: 'Fireworks',
  stars: 'Stars',
  minimal: 'Minimal',
};

export const EFFECT_DESCRIPTIONS: Readonly<Record<EffectId, string>> = {
  particles: 'Particles burst out from the cursor.',
  fire: 'Rising, flickering flames and embers.',
  lightning: 'Electric arcs and sparks.',
  energy: 'Expanding glowing energy rings.',
  fireworks: 'Multi-stage firework explosions.',
  stars: 'Twinkling stars and glowing motes.',
  minimal: 'Small, subtle sparks.',
};
